/*
 * DawaNetwork survey — Supabase wrapper.
 *
 * Exposes window.DawaNetworkBackend (and alias window.DawaLinkBackend) with:
 *   .isConfigured   true once config.js has a real URL + anon key
 *   .submit(answers) resolves {ok:true} or {ok:false, error}
 */
(function () {
  let client = null;

  function getConfig() {
    return window.SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const cfg = getConfig();
    return Boolean(cfg.url && cfg.anonKey);
  }

  function getClient() {
    if (client) return client;
    const cfg = getConfig();
    if (isConfigured() && window.supabase && typeof window.supabase.createClient === "function") {
      try {
        client = window.supabase.createClient(cfg.url, cfg.anonKey);
      } catch (e) {
        console.warn("Could not initialize Supabase client:", e);
      }
    }
    return client;
  }

  // Pre-initialize if available
  getClient();

  async function submit(answers) {
    const cfg = getConfig();
    if (!isConfigured()) {
      return { ok: false, error: "not_configured" };
    }

    const sb = getClient();
    if (sb) {
      try {
        const { error } = await sb.from("survey_responses").insert({
          answers,
          user_agent: navigator.userAgent
        });
        if (!error) {
          return { ok: true };
        }
        console.warn("Supabase client insert failed, trying direct REST API fallback:", error);
      } catch (err) {
        console.warn("Supabase client threw error, trying direct REST API fallback:", err);
      }
    }

    // Direct REST API fallback (works even if CDN script fails to load or is blocked)
    try {
      const endpoint = cfg.url.replace(/\/+$/, "") + "/rest/v1/survey_responses";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + cfg.anonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answers,
          user_agent: navigator.userAgent
        })
      });

      if (res.ok || res.status === 201) {
        return { ok: true };
      }
      const errText = await res.text();
      console.error("Supabase REST fallback failed:", res.status, errText);
      return { ok: false, error: errText || "http_" + res.status };
    } catch (fetchErr) {
      console.error("Supabase submission error:", fetchErr);
      return { ok: false, error: fetchErr && fetchErr.message ? fetchErr.message : "network_error" };
    }
  }

  const backendObj = {
    get isConfigured() {
      return isConfigured();
    },
    submit
  };

  window.DawaNetworkBackend = backendObj;
  window.DawaLinkBackend = backendObj; // Backward compatibility alias
})();


