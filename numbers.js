(function () {
  if (!Api.token()) { window.location.href = "login.html"; return; }
  var money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
  var form = document.getElementById("buy-form");
  var msg = document.getElementById("msg");
  var countrySel = document.getElementById("country");
  var serviceInp = document.getElementById("service");
  var serviceList = document.getElementById("service-list");
  var priceBox = document.getElementById("price");
  var buyBtn = document.getElementById("buy");
  var panel = document.getElementById("order-panel");
  var hist = document.getElementById("history");
  var services = [];
  var quoteOk = false;
  var pollTimer = null, tickTimer = null, current = null;

  function say(t, kind) { msg.textContent = t; msg.className = "msg" + (kind ? " " + kind : ""); }
  function toLogin() { Api.clear(); window.location.href = "login.html"; }
  function fail(err) { if (err.status === 401) { toLogin(); } else { say(err.message, "error"); } }
  function serviceId() {
    var v = serviceInp.value.trim().toLowerCase();
    for (var i = 0; i < services.length; i++) { if (services[i].name.toLowerCase() === v) { return services[i].id; } }
    return null;
  }

  async function loadBalance() {
    var me = await Api.req("/api/me");
    document.getElementById("balance").textContent = money.format(me.balance_kobo / 100);
    document.getElementById("who").textContent = me.email;
  }
  async function loadCountries() {
    var d = await Api.req("/api/catalog/countries");
    d.countries.forEach(function (c) {
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; countrySel.appendChild(o);
    });
  }
  async function loadServices() {
    services = []; serviceList.textContent = ""; serviceInp.value = ""; setQuote(false, "");
    if (!countrySel.value) { return; }
    var d = await Api.req("/api/catalog/services?country=" + encodeURIComponent(countrySel.value));
    services = d.services;
    d.services.forEach(function (s) {
      var o = document.createElement("option"); o.value = s.name; serviceList.appendChild(o);
    });
  }
  function setQuote(ok, text) { quoteOk = ok; priceBox.textContent = text; buyBtn.disabled = !ok; }
  async function loadPrice() {
    var id = serviceId();
    if (!countrySel.value || !id) { setQuote(false, ""); return; }
    setQuote(false, "Checking price...");
    try {
      var p = await Api.req("/api/catalog/price?country=" + encodeURIComponent(countrySel.value) + "&service=" + encodeURIComponent(id));
      setQuote(true, "Price: " + money.format(p.price_kobo / 100));
    } catch (err) { setQuote(false, ""); fail(err); }
  }

  function stopTimers() { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }
  function line(parent, cls, text) { var p = document.createElement("p"); if (cls) { p.className = cls; } p.textContent = text; parent.appendChild(p); return p; }
  var labels = { active: "Waiting for SMS", completed: "SMS received", refunded: "Refunded", cancelled: "Cancelled and refunded", failed: "Failed, not charged", review: "Needs review, contact support", purchasing: "Starting" };

  function render(o) {
    panel.textContent = "";
    panel.className = "order";
    line(panel, "", "Order " + o.id + " : " + (labels[o.status] || o.status));
    if (o.phone) { line(panel, "num", o.phone); }
    if (o.status === "completed") {
      line(panel, "code", o.code);
      if (o.full_sms) { line(panel, "", o.full_sms); }
    }
    if (o.status === "active") {
      var t = line(panel, "", "");
      t.id = "left";
      var b = document.createElement("button");
      b.className = "btn alt"; b.type = "button"; b.textContent = "Cancel and refund";
      b.addEventListener("click", cancel);
      panel.appendChild(b);
      tick(o.expires_at);
    }
    if (o.status === "cancelled" || o.status === "refunded") { line(panel, "", "Your wallet was refunded " + money.format(o.price_kobo / 100) + "."); }
  }
  function tick(exp) {
    clearInterval(tickTimer);
    function f() {
      var el = document.getElementById("left"); if (!el) { return; }
      var s = Math.max(0, Math.floor(exp - Date.now() / 1000));
      el.textContent = "Time left: " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    f(); tickTimer = setInterval(f, 1000);
  }
  async function poll() {
    if (!current) { return; }
    try {
      var d = await Api.req("/api/orders/" + current);
      render(d.order);
      if (d.order.status !== "active") { stopTimers(); await loadBalance(); await loadOrders(); }
    } catch (err) { fail(err); }
  }
  function track(id) { stopTimers(); current = id; poll(); pollTimer = setInterval(poll, 5000); }
  async function cancel() {
    say("");
    try {
      var d = await Api.req("/api/orders/" + current + "/cancel", { method: "POST" });
      render(d.order); stopTimers(); await loadBalance(); await loadOrders();
    } catch (err) { fail(err); }
  }

  async function loadOrders() {
    var d = await Api.req("/api/orders");
    hist.textContent = "";
    if (!d.orders.length) {
      var r0 = document.createElement("tr"), c0 = document.createElement("td"); c0.colSpan = 4; c0.textContent = "No orders yet."; r0.appendChild(c0); hist.appendChild(r0); return;
    }
    d.orders.forEach(function (o) {
      var tr = document.createElement("tr");
      [o.created_at.slice(0, 16).replace("T", " "), o.phone || "-", money.format(o.price_kobo / 100), labels[o.status] || o.status].forEach(function (t) {
        var td = document.createElement("td"); td.textContent = t; tr.appendChild(td);
      });
      hist.appendChild(tr);
    });
    for (var i = 0; i < d.orders.length; i++) { if (d.orders[i].status === "active" && !current) { track(d.orders[i].id); break; } }
  }

  countrySel.addEventListener("change", function () { loadServices().catch(fail); });
  serviceInp.addEventListener("input", loadPrice);
  serviceInp.addEventListener("change", loadPrice);
  document.getElementById("signout").addEventListener("click", toLogin);
  form.addEventListener("submit", async function (e) {
    e.preventDefault(); say("");
    var id = serviceId();
    if (!quoteOk || !id) { say("Choose a country and a service from the list.", "error"); return; }
    buyBtn.disabled = true;
    try {
      var r = await Api.req("/api/orders", { method: "POST", body: { country: countrySel.value, service: id } });
      await loadBalance(); await loadOrders(); track(r.id);
    } catch (err) { fail(err); }
    buyBtn.disabled = !quoteOk;
  });

  (async function () {
    try { await loadBalance(); await loadCountries(); await loadOrders(); }
    catch (err) { fail(err); }
  })();
})();
