(function () {
  var form = document.getElementById("auth-form");
  var msg = document.getElementById("msg");
  var mode = form.getAttribute("data-mode");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.textContent = "";
    msg.className = "msg";
    var btn = form.querySelector("button");
    btn.disabled = true;
    try {
      var data = await Api.req("/api/auth/" + mode, {
        method: "POST",
        body: { email: form.email.value, password: form.password.value }
      });
      Api.setToken(data.token);
      window.location.href = "deposit.html";
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "msg error";
      btn.disabled = false;
    }
  });
})();
