"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const Database = require("better-sqlite3");

const env = process.env;
function need(name) {
  if (!env[name]) { console.error("Missing required setting: " + name); process.exit(1); }
  return env[name];
}
const PORT = Number(env.PORT || 3000);
const FRONTEND_URL = need("FRONTEND_URL").replace(/\/$/, "");
const JWT_SECRET = need("JWT_SECRET");
const PAYSTACK_KEY = need("PAYSTACK_SECRET_KEY");
const MIN_KOBO = Number(env.MIN_DEPOSIT_NGN || 500) * 100;
const MAX_KOBO = Number(env.MAX_DEPOSIT_NGN || 500000) * 100;

// ---------- database ----------
const dbPath = env.DB_PATH || "./data/nuvora.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  balance_kobo INTEGER NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reference TEXT NOT NULL UNIQUE,
  amount_kobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  country TEXT NOT NULL,
  service TEXT NOT NULL,
  price_kobo INTEGER NOT NULL,
  usd_price TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'purchasing',
  supplier_order TEXT,
  phone TEXT,
  code TEXT,
  full_sms TEXT,
  expires_at INTEGER,
  refunded INTEGER NOT NULL DEFAULT 0,
  last_check INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  deposit_id INTEGER REFERENCES deposits(id),
  amount_kobo INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// ---------- email (Gmail SMTP) ----------
const mailer = env.GMAIL_USER && env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD }
    })
  : null;
async function sendMail(to, subject, text) {
  if (!mailer) { console.warn("Email not configured, skipped: " + subject); return; }
  try {
    await mailer.sendMail({
      from: '"' + (env.MAIL_FROM_NAME || "Nuvora SMS") + '" <' + env.GMAIL_USER + ">",
      to, subject, text
    });
  } catch (e) { console.error("Email failed:", e.message); }
}
const naira = (kobo) => "NGN " + (kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });

// ---------- helpers ----------
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: new URL(FRONTEND_URL).origin }));

function sign(user) { return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: "7d" }); }
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Please sign in." });
  try { req.uid = jwt.verify(h.slice(7), JWT_SECRET).uid; next(); }
  catch (e) { res.status(401).json({ error: "Session expired. Please sign in again." }); }
}

// Credits a deposit exactly once. Safe to call from the webhook and the verify route.
const creditDeposit = db.transaction((reference, paidKobo) => {
  const d = db.prepare("SELECT * FROM deposits WHERE reference = ?").get(reference);
  if (!d) return { result: "unknown" };
  if (d.status === "success") return { result: "already", deposit: d };
  if (paidKobo !== d.amount_kobo) {
    db.prepare("UPDATE deposits SET status = 'mismatch' WHERE id = ?").run(d.id);
    return { result: "mismatch", deposit: d };
  }
  db.prepare("UPDATE deposits SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(d.id);
  db.prepare("UPDATE users SET balance_kobo = balance_kobo + ? WHERE id = ?").run(d.amount_kobo, d.user_id);
  db.prepare("INSERT INTO ledger (user_id, deposit_id, amount_kobo, note) VALUES (?, ?, ?, ?)")
    .run(d.user_id, d.id, d.amount_kobo, "Wallet deposit " + reference);
  return { result: "credited", deposit: d };
});
function afterCredit(out) {
  if (out.result !== "credited") return;
  const u = db.prepare("SELECT email, balance_kobo FROM users WHERE id = ?").get(out.deposit.user_id);
  sendMail(u.email, "Deposit received",
    "Your deposit of " + naira(out.deposit.amount_kobo) + " was received.\nReference: " +
    out.deposit.reference + "\nNew balance: " + naira(u.balance_kobo) + "\n\nNuvora SMS, a service of Nuvora Tech");
}

// ---------- Paystack webhook (raw body needed for the signature) ----------
app.post("/api/webhooks/paystack", express.raw({ type: "application/json" }), (req, res) => {
  const sig = String(req.headers["x-paystack-signature"] || "");
  const expected = crypto.createHmac("sha512", PAYSTACK_KEY).update(req.body).digest("hex");
  const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch (e) { return res.sendStatus(400); }
  if (event.event === "charge.success" && event.data && event.data.currency === "NGN") {
    afterCredit(creditDeposit(event.data.reference, event.data.amount));
  }
  res.sendStatus(200);
});

app.use(express.json({ limit: "20kb" }));

// ---------- auth ----------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const emailOk = (s) => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  if (!emailOk(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email))
    return res.status(409).json({ error: "An account with this email already exists." });
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
  sendMail(email, "Welcome to Nuvora SMS", "Your account is ready. Sign in and add funds to your wallet to get started.\n\nNuvora SMS, a service of Nuvora Tech");
  res.status(201).json({ token: sign({ id: info.lastInsertRowid }) });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  const ok = u ? await bcrypt.compare(password, u.password_hash) : false;
  if (!ok) return res.status(401).json({ error: "Email or password is incorrect." });
  res.json({ token: sign(u) });
});

app.get("/api/me", auth, (req, res) => {
  const u = db.prepare("SELECT email, balance_kobo FROM users WHERE id = ?").get(req.uid);
  if (!u) return res.status(401).json({ error: "Please sign in." });
  res.json({ email: u.email, balance_kobo: u.balance_kobo, min_kobo: MIN_KOBO, max_kobo: MAX_KOBO });
});

// ---------- deposits ----------
app.post("/api/deposits", auth, rateLimit({ windowMs: 60 * 1000, limit: 10 }), async (req, res) => {
  const naira_amount = Number((req.body || {}).amount);
  if (!Number.isInteger(naira_amount)) return res.status(400).json({ error: "Enter a whole number of naira." });
  const kobo = naira_amount * 100;
  if (kobo < MIN_KOBO || kobo > MAX_KOBO)
    return res.status(400).json({ error: "Amount must be between " + MIN_KOBO / 100 + " and " + MAX_KOBO / 100 + " naira." });
  const u = db.prepare("SELECT email FROM users WHERE id = ?").get(req.uid);
  const reference = "NSMS_" + crypto.randomBytes(12).toString("hex");
  db.prepare("INSERT INTO deposits (user_id, reference, amount_kobo) VALUES (?, ?, ?)").run(req.uid, reference, kobo);
  try {
    const r = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: "Bearer " + PAYSTACK_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email, amount: kobo, currency: "NGN", reference, callback_url: FRONTEND_URL + "/deposit.html" })
    });
    const j = await r.json();
    if (!r.ok || !j.status) throw new Error(j.message || "Paystack error");
    res.json({ authorization_url: j.data.authorization_url, reference });
  } catch (e) {
    console.error("Paystack initialize failed:", e.message);
    db.prepare("UPDATE deposits SET status = 'failed' WHERE reference = ?").run(reference);
    res.status(502).json({ error: "Could not start the payment. Please try again." });
  }
});

app.get("/api/deposits/verify/:reference", auth, async (req, res) => {
  const d = db.prepare("SELECT * FROM deposits WHERE reference = ? AND user_id = ?").get(req.params.reference, req.uid);
  if (!d) return res.status(404).json({ error: "Deposit not found." });
  if (d.status === "success") return res.json({ status: "success" });
  try {
    const r = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(d.reference), {
      headers: { Authorization: "Bearer " + PAYSTACK_KEY }
    });
    const j = await r.json();
    if (r.ok && j.status && j.data.status === "success" && j.data.currency === "NGN") {
      const out = creditDeposit(d.reference, j.data.amount);
      afterCredit(out);
      return res.json({ status: out.result === "mismatch" ? "mismatch" : "success" });
    }
    res.json({ status: (j.data && j.data.status) || "pending" });
  } catch (e) {
    res.status(502).json({ error: "Could not check the payment. It will update automatically if it succeeded." });
  }
});

app.get("/api/deposits", auth, (req, res) => {
  const rows = db.prepare("SELECT reference, amount_kobo, status, created_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.uid);
  res.json({ deposits: rows });
});


// ---------- SMSPool numbers ----------
const SMSPOOL_KEY = env.SMSPOOL_API_KEY || "";
const USD_NGN = Number(env.USD_NGN_RATE || 0);
const MARKUP = Number(env.MARKUP_PERCENT || 0);
const stripHtml = (t) => String(t || "").replace(/<[^>]*>/g, "").trim();
const isId = (v) => typeof v === "string" && /^\d{1,6}$/.test(v);

async function pool(p, opts) {
  opts = opts || {};
  if (!SMSPOOL_KEY) { const e = new Error("SMSPool is not configured."); e.notConfigured = true; throw e; }
  const init = { method: opts.method || "POST", headers: { Authorization: "Bearer " + SMSPOOL_KEY }, signal: AbortSignal.timeout(20000) };
  if (opts.form) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(opts.form).toString();
  }
  const r = await fetch("https://api.smspool.net" + p, init);
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body };
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}
function unavailable(res, e) {
  if (e && e.notConfigured) return res.status(503).json({ error: "Numbers are not available yet." });
  console.error("SMSPool error:", e && e.message);
  return res.status(502).json({ error: "The number supplier did not answer. Please try again." });
}

async function quote(country, service) {
  if (!(USD_NGN > 0)) { const e = new Error("USD_NGN_RATE missing"); e.notConfigured = true; throw e; }
  const r = await pool("/request/price", { form: { country, service } });
  const usd = Number(r.body && r.body.price);
  if (r.status !== 200 || !isFinite(usd) || usd <= 0) return null;
  const kobo = Math.ceil(usd * USD_NGN * (1 + MARKUP / 100) * 100);
  return { usd: String(r.body.price), kobo };
}

app.get("/api/catalog/countries", auth, async (req, res) => {
  try {
    const list = await cached("countries", 3600000, async () => {
      const r = await pool("/country/retrieve_all", { method: "GET" });
      if (r.status !== 200 || !Array.isArray(r.body)) throw new Error("bad country list");
      return r.body.map((c) => ({ id: String(c.ID), name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
    });
    res.json({ countries: list });
  } catch (e) { unavailable(res, e); }
});

app.get("/api/catalog/services", auth, async (req, res) => {
  const country = String(req.query.country || "");
  if (!isId(country)) return res.status(400).json({ error: "Choose a country." });
  try {
    const list = await cached("services:" + country, 1800000, async () => {
      const r = await pool("/service/retrieve_all?country=" + country, { method: "GET" });
      if (r.status !== 200 || !Array.isArray(r.body)) throw new Error("bad service list");
      return r.body.map((x) => ({ id: String(x.ID), name: x.name }));
    });
    res.json({ services: list });
  } catch (e) { unavailable(res, e); }
});

app.get("/api/catalog/price", auth, async (req, res) => {
  const country = String(req.query.country || ""), service = String(req.query.service || "");
  if (!isId(country) || !isId(service)) return res.status(400).json({ error: "Choose a country and a service." });
  try {
    const q = await quote(country, service);
    if (!q) return res.status(404).json({ error: "No price available for this choice." });
    res.json({ price_kobo: q.kobo });
  } catch (e) { unavailable(res, e); }
});

// Returns the order's money to the wallet exactly once.
const refundOrder = db.transaction((orderId, newStatus) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!o || o.refunded) return false;
  db.prepare("UPDATE orders SET status = ?, refunded = 1 WHERE id = ?").run(newStatus, o.id);
  db.prepare("UPDATE users SET balance_kobo = balance_kobo + ? WHERE id = ?").run(o.price_kobo, o.user_id);
  db.prepare("INSERT INTO ledger (user_id, amount_kobo, note) VALUES (?, ?, ?)").run(o.user_id, o.price_kobo, "Refund for number order " + o.id);
  return true;
});

const takePayment = db.transaction((userId, country, service, q) => {
  const u = db.prepare("SELECT balance_kobo FROM users WHERE id = ?").get(userId);
  if (!u || u.balance_kobo < q.kobo) return null;
  db.prepare("UPDATE users SET balance_kobo = balance_kobo - ? WHERE id = ?").run(q.kobo, userId);
  const info = db.prepare("INSERT INTO orders (user_id, country, service, price_kobo, usd_price) VALUES (?, ?, ?, ?, ?)")
    .run(userId, country, service, q.kobo, q.usd);
  db.prepare("INSERT INTO ledger (user_id, amount_kobo, note) VALUES (?, ?, ?)")
    .run(userId, -q.kobo, "Number order " + info.lastInsertRowid);
  return Number(info.lastInsertRowid);
});

app.post("/api/orders", auth, rateLimit({ windowMs: 60 * 1000, limit: 10 }), async (req, res) => {
  const country = String((req.body || {}).country || ""), service = String((req.body || {}).service || "");
  if (!isId(country) || !isId(service)) return res.status(400).json({ error: "Choose a country and a service." });
  let q;
  try { q = await quote(country, service); } catch (e) { return unavailable(res, e); }
  if (!q) return res.status(404).json({ error: "No price available for this choice." });
  const orderId = takePayment(req.uid, country, service, q);
  if (!orderId) return res.status(402).json({ error: "Your balance is too low. Please deposit first." });
  try {
    const r = await pool("/purchase/sms", { form: { country, service, max_price: q.usd } });
    const b = r.body || {};
    if (r.status === 200 && b.success === 1 && b.order_id) {
      const phone = b.number ? "+" + b.number : "+" + (b.cc || "") + (b.phonenumber || "");
      db.prepare("UPDATE orders SET status = 'active', supplier_order = ?, phone = ?, expires_at = ? WHERE id = ?")
        .run(String(b.order_id), phone, Number(b.expiration) || Math.floor(Date.now() / 1000) + 600, orderId);
      return res.status(201).json({ id: orderId });
    }
    refundOrder(orderId, "failed");
    console.error("Purchase refused:", r.status, JSON.stringify(b).slice(0, 500));
    let msg = "No number is available right now. You were not charged.";
    if (b.type === "PRICE_NOT_FOUND") msg = "The price changed. Please try again. You were not charged.";
    if (b.type === "BALANCE_ERROR") msg = "This service is temporarily unavailable. You were not charged.";
    return res.status(409).json({ error: msg });
  } catch (e) {
    // The outcome is unknown, so keep the money held and flag the order for a person to check.
    db.prepare("UPDATE orders SET status = 'review' WHERE id = ?").run(orderId);
    console.error("Purchase outcome unknown for order " + orderId + ":", e.message);
    return res.status(502).json({ error: "We could not confirm your order. Contact support with reference " + orderId + "." });
  }
});

async function refreshOrder(o) {
  if (o.status !== "active") return o;
  const now = Date.now();
  if (now - o.last_check < 4000) return o;
  db.prepare("UPDATE orders SET last_check = ? WHERE id = ?").run(now, o.id);
  try {
    const r = await pool("/sms/check", { form: { orderid: o.supplier_order } });
    const b = r.body || {};
    if (r.status === 200 && b.status === 3 && b.sms) {
      db.prepare("UPDATE orders SET status = 'completed', code = ?, full_sms = ? WHERE id = ? AND status = 'active'")
        .run(String(b.sms), stripHtml(b.full_sms), o.id);
    } else if (r.status === 200 && b.status === 6) {
      refundOrder(o.id, "refunded");
    } else if (r.status === 200 && o.expires_at && Date.now() / 1000 > o.expires_at + 5) {
      const c = await pool("/sms/cancel", { form: { orderid: o.supplier_order } });
      if (c.body && c.body.success === 1) refundOrder(o.id, "cancelled");
    }
  } catch (e) { console.error("Order refresh failed:", e.message); }
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id);
}
const publicOrder = (o) => ({
  id: o.id, status: o.status, phone: o.phone, code: o.code, full_sms: o.full_sms,
  expires_at: o.expires_at, price_kobo: o.price_kobo, created_at: o.created_at
});

app.get("/api/orders", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 30").all(req.uid);
  res.json({ orders: rows.map(publicOrder) });
});

app.get("/api/orders/:id", auth, async (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.uid);
  if (!o) return res.status(404).json({ error: "Order not found." });
  res.json({ order: publicOrder(await refreshOrder(o)) });
});

app.post("/api/orders/:id/cancel", auth, async (req, res) => {
  let o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.uid);
  if (!o) return res.status(404).json({ error: "Order not found." });
  o = await refreshOrder(o);
  if (o.status !== "active") return res.json({ order: publicOrder(o) });
  try {
    const c = await pool("/sms/cancel", { form: { orderid: o.supplier_order } });
    if (c.body && c.body.success === 1) {
      refundOrder(o.id, "cancelled");
    } else {
      return res.status(409).json({ error: stripHtml(c.body && c.body.message) || "This order cannot be cancelled yet. Try again shortly." });
    }
  } catch (e) { return unavailable(res, e); }
  res.json({ order: publicOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id)) });
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.listen(PORT, () => console.log("Nuvora SMS API listening on " + PORT));
