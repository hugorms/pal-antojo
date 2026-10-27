// Entrada a la app de Pa'l Antojo: nadie la usa sin entrar con su correo y contraseña (Supabase Auth).
// Pueden entrar los correos de public.administradores y public.personal (función puede_entrar).
// La sesión queda guardada en el equipo: sin internet sigue abierta; con internet se renueva sola.
// Es la misma sesión del panel del menú (pa.admin.ses), así que se entra una sola vez.
(function () {
  const BASE = document.currentScript ? document.currentScript.src : location.href;
  const SB_URL = "https://ymzwomnzjfxznmpdouad.supabase.co";
  const CLAVE = "sb_publishable_DMUusZtVlluniqfi0nrVxQ_pljUvIk5";
  const KEY = "pa.admin.ses";
  const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } };
  const guardar = s => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (_) {} };
  const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Mientras no haya sesión, la app no se ve
  const estilo = document.createElement("style");
  estilo.textContent = `html.bloqueado body > :not(#acceso) { display: none !important; }
    #acceso { position: fixed; inset: 0; z-index: 99; display: grid; place-items: center; padding: 16px; background: #1A1A1A; font-family: "Nunito", "Segoe UI", system-ui, sans-serif; }
    #acceso form { width: 100%; max-width: 360px; background: #FBF8EF; color: #1A1A1A; border-radius: 18px; padding: 22px; display: grid; gap: 12px; }
    #acceso .m { display: flex; align-items: center; gap: 10px; font: 700 1.3rem "Fredoka", system-ui, sans-serif; }
    #acceso img { width: 44px; height: 44px; border-radius: 50%; }
    #acceso label { display: grid; gap: 4px; font-weight: 800; font-size: .85rem; }
    #acceso input { font: 600 1rem inherit; padding: 10px; border: 1.5px solid #E6E0CF; border-radius: 10px; background: #fff; color: #1A1A1A; }
    #acceso button { font: 800 1rem inherit; padding: 12px; border: 0; border-radius: 12px; background: #F2B705; color: #1A1A1A; cursor: pointer; }
    #acceso button:disabled { opacity: .5; }
    #acceso p { margin: 0; font-size: .88rem; color: #6B6B6B; }
    #acceso .err { color: #B3261E; font-weight: 700; }`;
  document.head.appendChild(estilo);

  async function token(tipo, cuerpo) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${tipo}`, { method: "POST", headers: { apikey: CLAVE, "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error_code === "invalid_credentials" || d.error === "invalid_grant" ? "Correo o contraseña incorrectos." : (d.msg || d.error_description || "No se pudo entrar.")); e.rechazo = true; throw e; }
    const s = { access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000, email: d.user && d.user.email };
    guardar(s); return s;
  }
  async function puedeEntrar(s) {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/puede_entrar`, { method: "POST", headers: { apikey: CLAVE, authorization: "Bearer " + s.access_token, "content-type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error("No se pudo revisar el permiso (" + r.status + ").");
    return (await r.json()) === true;
  }

  function bloquear(error) {
    document.documentElement.classList.add("bloqueado");
    let el = document.getElementById("acceso");
    if (!el) { el = document.createElement("div"); el.id = "acceso"; document.body.appendChild(el); }
    const correo = (leer() || {}).email || localStorage.getItem("pa.admin.correo")?.replace(/"/g, "") || "";
    el.innerHTML = `<form id="accForm">
      <div class="m"><img src="${new URL("icono-192.png", BASE).href}" alt="" onerror="this.remove()">Pa'l Antojo</div>
      <p>Solo para el equipo de la tienda. Entra con tu correo y contraseña.</p>
      <label>Correo<input type="email" id="accCorreo" autocomplete="username" required value="${esc(correo)}"></label>
      <label>Contraseña<input type="password" id="accClave" autocomplete="current-password" required></label>
      <button id="accBtn">Entrar</button>
      <p class="err" id="accErr">${esc(error || "")}</p>
    </form>`;
    el.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("accBtn"), err = document.getElementById("accErr");
      btn.disabled = true; err.textContent = "";
      try {
        const s = await token("password", { email: document.getElementById("accCorreo").value.trim(), password: document.getElementById("accClave").value });
        try { localStorage.setItem("pa.admin.correo", JSON.stringify(s.email || "")); } catch (_) {}
        if (!await puedeEntrar(s)) { guardar(null); throw new Error(`${s.email} no tiene permiso para entrar a la app.`); }
        abrir();
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    });
  }
  function abrir() {
    document.documentElement.classList.remove("bloqueado");
    const el = document.getElementById("acceso"); if (el) el.remove();
  }

  // Revisa la sesión guardada: sin internet se respeta; con internet se renueva y se confirma el permiso
  async function revisar() {
    let s = leer();
    if (!s || !s.refresh_token) return bloquear();
    if (!navigator.onLine) return abrir();
    try {
      if (Date.now() > (s.expira || 0) - 120000) s = await token("refresh_token", { refresh_token: s.refresh_token });
      if (!await puedeEntrar(s)) { guardar(null); return bloquear("Este usuario ya no tiene permiso para entrar."); }
      abrir();
    } catch (x) {
      // Sesión cerrada o vencida en el servidor: hay que volver a entrar. Si solo falló la red, se deja seguir.
      if (x.rechazo) { guardar(null); bloquear("La sesión venció. Vuelve a entrar."); } else abrir();
    }
  }
  window.salirApp = () => { guardar(null); bloquear(); };
  document.documentElement.classList.add("bloqueado");
  const inicio = () => { if (leer()) abrir(); revisar(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inicio); else inicio();
  setInterval(revisar, 30 * 60 * 1000);
  window.addEventListener("online", revisar);
})();
