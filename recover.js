(function () {
  var msg = document.getElementById("msg");
  function say(t, k) { msg.textContent = t; msg.className = "msg" + (k ? " " + k : ""); }
  var f = document.getElementById("forgot-form");
  if (f) {
    f.addEventListener("submit", async function (e) {
      e.preventDefault(); say("");
      var b = f.querySelector("button"); b.disabled = true;
      try {
        await Api.req("/api/auth/forgot", { method: "POST", body: { email: f.email.value } });
        say("If an account exists for that email, a reset link is on its way. Check your spam folder too.", "ok");
      } catch (err) { say(err.message, "error"); }
      b.disabled = false;
    });
  }
  var r = document.getElementById("reset-form");
  if (r) {
    var token = new URLSearchParams(window.location.search).get("token") || "";
    r.addEventListener("submit", async function (e) {
      e.preventDefault(); say("");
      var b = r.querySelector("button"); b.disabled = true;
      try {
        await Api.req("/api/auth/reset", { method: "POST", body: { token: token, password: r.password.value } });
        say("Password changed. You can now sign in.", "ok");
        setTimeout(function () { window.location.href = "login.html"; }, 1500);
      } catch (err) { say(err.message, "error"); b.disabled = false; }
    });
  }
})();
