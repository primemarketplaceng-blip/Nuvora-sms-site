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

app.get("/health", (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.listen(PORT, () => console.log("Nuvora SMS API listening on " + PORT));
