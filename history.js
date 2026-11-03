(function () {
  if (!Api.token()) { window.location.href = "login.html"; return; }
  var money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
  var labels = { active: "Waiting for SMS", completed: "SMS received", refunded: "Refunded", cancelled: "Cancelled and refunded", failed: "Failed, not charged", review: "Needs review", purchasing: "Starting", success: "Paid", pending: "Pending", mismatch: "Amount mismatch" };
  function fill(id, rows, cols) {
    var body = document.getElementById(id);
    body.textContent = "";
    if (!rows.length) {
      var tr0 = document.createElement("tr"), td0 = document.createElement("td");
      td0.colSpan = cols; td0.textContent = "Nothing here yet."; tr0.appendChild(td0); body.appendChild(tr0); return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      r.forEach(function (t) { var td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }
  var when = function (s) { return s.slice(0, 16).replace("T", " "); };
  (async function () {
    try {
      var me = await Api.req("/api/me");
      document.getElementById("balance").textContent = money.format(me.balance_kobo / 100);
      var o = await Api.req("/api/orders");
      fill("orders", o.orders.map(function (x) { return [when(x.created_at), x.phone || "-", x.code || "-", money.format(x.price_kobo / 100), labels[x.status] || x.status]; }), 5);
      var d = await Api.req("/api/deposits");
      fill("deposits", d.deposits.map(function (x) { return [when(x.created_at), money.format(x.amount_kobo / 100), labels[x.status] || x.status]; }), 3);
    } catch (err) {
      if (err.status === 401) { Api.clear(); window.location.href = "login.html"; return; }
      var m = document.getElementById("msg"); m.textContent = err.message; m.className = "msg error";
    }
  })();
})();
