var Api = (function () {
  var base = window.NUVORA_API || "";
  function token() { try { return sessionStorage.getItem("nv_token"); } catch (e) { return null; } }
  function setToken(t) { try { sessionStorage.setItem("nv_token", t); } catch (e) {} }
  function clear() { try { sessionStorage.removeItem("nv_token"); } catch (e) {} }
  async function req(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    if (token()) { headers.Authorization = "Bearer " + token(); }
    var r;
    try {
      r = await fetch(base + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    var data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) {
      var err = new Error(data.error || "Something went wrong.");
      err.status = r.status;
      throw err;
    }
    return data;
  }
  return { req: req, token: token, setToken: setToken, clear: clear };
})();
