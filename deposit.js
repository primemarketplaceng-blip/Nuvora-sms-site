(function () {
  if (!Api.token()) { window.location.href = "login.html"; return; }
  var money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
  var msg = document.getElementById("msg");
  var bal = document.getElementById("balance");
  var form = document.getElementById("deposit-form");
  var body = document.getElementById("history");

  function say(text, kind) { msg.textContent = text; msg.className = "msg" + (kind ? " " + kind : ""); }
  function toLogin() { Api.clear(); window.location.href = "login.html"; }

  async function loadMe() {
    var me = await Api.req("/api/me");
    bal.textContent = money.format(me.balance_kobo / 100);
    document.getElementById("who").textContent = me.email;
    form.amount.min = String(me.min_kobo / 100);
    form.amount.max = String(me.max_kobo / 100);
  }
  async function loadHistory() {
    var d = await Api.req("/api/deposits");
    body.textContent = "";
    if (!d.deposits.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 3; td0.textContent = "No deposits yet.";
      tr0.appendChild(td0); body.appendChild(tr0);
      return;
    }
    d.deposits.forEach(function (x) {
      var tr = document.createElement("tr");
      [x.created_at.slice(0, 16).replace("T", " "), money.format(x.amount_kobo / 100), x.status].forEach(function (t) {
        var td = document.createElement("td"); td.textContent = t; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }
  async function refresh() { await loadMe(); await loadHistory(); }

  async function checkReturn() {
    var ref = new URLSearchParams(window.location.search).get("reference");
    if (!ref) return;
    say("Checking your payment...");
    try {
      var r = await Api.req("/api/deposits/verify/" + encodeURIComponent(ref));
      if (r.status === "success") say("Payment received. Your wallet has been credited.", "ok");
      else if (r.status === "mismatch") say("The amount paid did not match the order. Contact support with reference " + ref + ".", "error");
      else say("Payment is " + r.status + ". If you were charged, your balance will update shortly.");
    } catch (err) { say(err.message, "error"); }
    history.replaceState(null, "", "deposit.html");
  }

  document.querySelectorAll("[data-amt]").forEach(function (b) {
    b.addEventListener("click", function () { form.amount.value = b.getAttribute("data-amt"); });
  });
  document.getElementById("signout").addEventListener("click", toLogin);

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    say("");
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      var r = await Api.req("/api/deposits", { method: "POST", body: { amount: Number(form.amount.value) } });
      window.location.href = r.authorization_url;
    } catch (err) {
      if (err.status === 401) { toLogin(); return; }
      say(err.message, "error");
      btn.disabled = false;
    }
  });

  (async function () {
    try { await refresh(); await checkReturn(); await refresh(); }
    catch (err) { if (err.status === 401) { toLogin(); } else { say(err.message, "error"); } }
  })();
})();
