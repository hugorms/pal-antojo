// Entrada a la app de Pa'l Antojo: nadie la usa sin entrar con su correo y contraseña (Supabase Auth).
// Pueden entrar los correos de public.administradores y public.personal (función puede_entrar).
// Otra app puede pedir otro permiso con data-permiso (la de repartidores usa es_repartidor) y otro texto con data-texto.
// La sesión queda guardada en el equipo: sin internet sigue abierta; con internet se renueva sola.
// Es la misma sesión del panel del menú (pa.admin.ses), así que se entra una sola vez.
(function () {
  const BASE = document.currentScript ? document.currentScript.src : location.href;
  const DS = (document.currentScript && document.currentScript.dataset) || {};
  const PERMISO = /^[a-z_]+$/.test(DS.permiso || "") ? DS.permiso : "puede_entrar";
  const TEXTO = DS.texto || "Solo para el equipo de la tienda. Entra con tu correo y contraseña.";
  // data-registro="1": la pantalla trae "Crear mi cuenta" (la usa la app de repartidores; la cuenta nueva queda esperando que el dueño la apruebe)
  const REGISTRO = DS.registro === "1";
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
    #acceso .err { color: #B3261E; font-weight: 700; }
    #acceso .otro { background: none; color: #1A1A1A; text-decoration: underline; font-weight: 700; padding: 4px; }`;
  document.head.appendChild(estilo);

  async function token(tipo, cuerpo) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${tipo}`, { method: "POST", headers: { apikey: CLAVE, "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error_code === "invalid_credentials" || d.error === "invalid_grant" ? "Correo o contraseña incorrectos." : (d.msg || d.error_description || "No se pudo entrar.")); e.rechazo = true; throw e; }
    const s = { access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000, email: d.user && d.user.email };
    guardar(s); return s;
  }
  async function puedeEntrar(s) {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${PERMISO}`, { method: "POST", headers: { apikey: CLAVE, authorization: "Bearer " + s.access_token, "content-type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error("No se pudo revisar el permiso (" + r.status + ").");
    return (await r.json()) === true;
  }

  async function crearCuenta(datos) {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, { method: "POST", headers: { apikey: CLAVE, "content-type": "application/json" },
      body: JSON.stringify({ email: datos.email, password: datos.clave, data: { nombre: datos.nombre, telefono: datos.telefono } }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (d.msg || d.error_description || d.message || "") + " " + (d.error_code || "");
      throw new Error(/already|registered|exists/i.test(m) ? "Ese correo ya tiene cuenta. Toca \"Ya tengo cuenta\" y entra con tu contraseña."
        : /signup.*disabled|not allowed/i.test(m) ? "La tienda todavía no abrió los registros. Avísale a la tienda."
        : /password/i.test(m) ? "La contraseña debe tener al menos 6 letras o números."
        : /equipo de la tienda|Database error/i.test(m) ? "Ese correo no se puede usar aquí. Usa otro."
        : "No se pudo crear la cuenta. " + m.trim());
    }
    if (!d.access_token) return null; // la tienda pide confirmar el correo
    const s = { access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000, email: d.user && d.user.email };
    guardar(s); return s;
  }

  function bloquear(error, modo) {
    if (modo === "crear") return pantallaCrear(error);
    document.documentElement.classList.add("bloqueado");
    let el = document.getElementById("acceso");
    if (!el) { el = document.createElement("div"); el.id = "acceso"; document.body.appendChild(el); }
    const correo = (leer() || {}).email || localStorage.getItem("pa.admin.correo")?.replace(/"/g, "") || "";
    el.innerHTML = `<form id="accForm">
      <div class="m"><img src="${new URL("icono-192.png", BASE).href}" alt="" onerror="this.remove()">Pa'l Antojo</div>
      <p>${esc(TEXTO)}</p>
      <label>Correo<input type="email" id="accCorreo" autocomplete="username" required value="${esc(correo)}"></label>
      <label>Contraseña<input type="password" id="accClave" autocomplete="current-password" required></label>
      <button id="accBtn">Entrar</button>
      <p class="err" id="accErr">${esc(error || "")}</p>
      ${REGISTRO ? `<button type="button" class="otro" id="accCrear">¿Eres nuevo? Crea tu cuenta</button>` : ""}
    </form>`;
    if (REGISTRO) el.querySelector("#accCrear").addEventListener("click", () => pantallaCrear());
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
  function pantallaCrear(error) {
    const el = document.getElementById("acceso");
    el.innerHTML = `<form id="accForm">
      <div class="m"><img src="${new URL("icono-192.png", BASE).href}" alt="" onerror="this.remove()">Crear mi cuenta</div>
      <p>Llena tus datos. La tienda revisa tu solicitud y te aprueba para empezar a recibir pedidos.</p>
      <label>Nombre y apellido<input id="accNombre" autocomplete="name" required maxlength="60"></label>
      <label>Teléfono (WhatsApp)<input id="accTel" type="tel" inputmode="tel" autocomplete="tel" required placeholder="0412-1234567"></label>
      <label>Correo<input type="email" id="accCorreo" autocomplete="username" required></label>
      <label>Contraseña (mínimo 6)<input type="password" id="accClave" autocomplete="new-password" required minlength="6"></label>
      <button id="accBtn">Crear mi cuenta</button>
      <p class="err" id="accErr">${esc(error || "")}</p>
      <button type="button" class="otro" id="accVolver">Ya tengo cuenta</button>
    </form>`;
    el.querySelector("#accVolver").addEventListener("click", () => bloquear());
    el.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("accBtn"), err = document.getElementById("accErr");
      const datos = { nombre: document.getElementById("accNombre").value.trim(), telefono: document.getElementById("accTel").value.trim(), email: document.getElementById("accCorreo").value.trim(), clave: document.getElementById("accClave").value };
      if ((datos.telefono.match(/\d/g) || []).length < 7) { err.textContent = "Pon tu teléfono completo."; return; }
      btn.disabled = true; err.textContent = "";
      try {
        // El perfil (nombre y teléfono) lo manda la app apenas entra
        try { localStorage.setItem("dlv.registro", JSON.stringify({ nombre: datos.nombre, telefono: datos.telefono })); localStorage.setItem("pa.admin.correo", JSON.stringify(datos.email)); } catch (_) {}
        const s = await crearCuenta(datos);
        if (!s) { bloquear("Te llegó un correo para confirmar tu cuenta. Confírmalo y después entra aquí."); return; }
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
