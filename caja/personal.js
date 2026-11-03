// Personal y sueldos: empleados, turnos trabajados y pagos (en $ o Bs con la tasa del día).
// Se carga ANTES del script principal de caja/index.html: aquí solo se declaran funciones y datos;
// las utilidades de la caja ($, esc, num, fmt, LS, cola, sincronizar...) se usan cuando ya existen.
//
// Registros en la nube (tabla registros, se unen por rev como el resto):
//   "personal"            → { empleados: [...], quitados: {} }
//   "per:trn:AAAA-MM-DD"   → { fecha, marcas: { "<idEmpleado>:Día": 1, "<idEmpleado>:Noche": 0 } }
//   "per:pag:<id>"        → un pago (Sueldo, Adelanto o Bono); se anula con motivo, no se borra
"use strict";
const PER_TURNOS = { "Día": "6:00 am a 3:00 pm", "Noche": "3:00 pm a 12:00 am (jue a dom)" };
const PER_TIPOS = ["Sueldo", "Adelanto", "Bono"];
const PER_FORMAS = ["Efectivo $", "Efectivo Bs", "Pago móvil"];
const perLeer = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
let per = Object.assign({ empleados: [], quitados: {}, rev: 0 }, perLeer("pa.per", {}));
let perTrn = perLeer("pa.perTrn", {});   // fecha → { fecha, marcas, rev }
let perPag = perLeer("pa.perPag", {});   // id → pago
let perVista = perLeer("pa.perVista", "semana"), perSemana = "", perFecha = "", perPagar = null, perTimer = 0;

// ---------- fechas (todas en hora de Venezuela, como texto AAAA-MM-DD) ----------
const perD = f => new Date(f + "T12:00:00Z");
const perMas = (f, n) => { const d = perD(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const perLunes = f => perMas(f, -((perD(f).getUTCDay() + 6) % 7));
const perDiaCorto = f => perD(f).toLocaleDateString("es-VE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
const perHoy = () => ahoraCaracas().fecha;
const perSemanaDe = () => perSemana || perLunes(perHoy());

// ---------- cuentas ----------
const perEmp = id => per.empleados.find(e => e.id === id);
const perActivos = () => per.empleados.filter(e => e.activo !== false);
const perDiasSemana = e => num(e.dias) || (e.turno === "Noche" ? 4 : 7);
const perPorDia = e => num(e.sueldo) / perDiasSemana(e);
// Días que le tocan normalmente (lunes = 0): Día todos los días, Noche jueves a domingo
const perDiasNormales = e => e.turno === "Noche" ? [3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
const perMarcado = (f, id, t) => !!((perTrn[f] || {}).marcas || {})[id + ":" + t];
function perTrabajados(e, lunes) {
  let n = 0;
  for (let i = 0; i < 7; i++) { const f = perMas(lunes, i); ["Día", "Noche"].forEach(t => { if (perMarcado(f, e.id, t)) n++; }); }
  return n;
}
const perPagosVivos = () => Object.values(perPag).filter(p => !p.anulado);
function perCuenta(e, lunes) {
  const dias = perTrabajados(e, lunes), debe = Math.round(perPorDia(e) * dias * 100) / 100;
  const deEl = perPagosVivos().filter(p => p.emp === e.id && p.semana === lunes);
  const pagado = deEl.filter(p => p.tipo !== "Bono").reduce((a, p) => a + (p.usd || 0), 0);
  const bonos = deEl.filter(p => p.tipo === "Bono").reduce((a, p) => a + (p.usd || 0), 0);
  return { dias, debe, pagado, bonos, falta: Math.round((debe - pagado) * 100) / 100 };
}
const perDec = n => String(Math.round(n * 100) / 100).replace(".", ",");

// ---------- guardar y enviar a la nube ----------
function perGuardar() {
  try { localStorage.setItem("pa.per", JSON.stringify(per)); localStorage.setItem("pa.perTrn", JSON.stringify(perTrn)); localStorage.setItem("pa.perPag", JSON.stringify(perPag)); }
  catch (_) { toast("No se pudo guardar en este equipo. Revisa el espacio."); }
}
function perTocar(id, suave) {
  const d = perDato(id); if (!d) return;
  d.rev = (d.rev || 0) + 1; d.actualizado = Date.now();
  cola.push(id); LS.set("pa.cola", cola); perGuardar();
  clearTimeout(perTimer);
  if (suave) perTimer = setTimeout(() => sincronizar(), 800); else sincronizar();
}
function perDato(id) {
  if (id === "personal") return per;
  if (id.startsWith("per:trn:")) return perTrn[id.slice(8)];
  if (id.startsWith("per:pag:")) return perPag[id.slice(8)];
}
// La caja (index.html) usa esto para traer, guardar y unir estos registros con los de otros equipos
(window.PA_EXTRA = window.PA_EXTRA || []).push({
  nombre: "personal",
  es: id => id === "personal" || id.startsWith("per:"),
  fija: id => id === "personal",
  todos: "id.eq.personal,id.like.per:*",
  dato: perDato,
  poner(id, d) {
    if (id === "personal") per = Object.assign({ empleados: [], quitados: {} }, d);
    else if (id.startsWith("per:trn:")) perTrn[id.slice(8)] = Object.assign({ marcas: {} }, d);
    else if (id.startsWith("per:pag:")) perPag[id.slice(8)] = d;
    perGuardar();
  },
  unir(id, u, l, r, o, ganaL) {
    if (id === "personal") {
      u.quitados = { ...(r.quitados || {}), ...(l.quitados || {}) };
      u.empleados = unirLista(l.empleados, r.empleados, o.empleados, u.quitados, ganaL);
    } else if (id.startsWith("per:trn:")) u.marcas = unir3(o.marcas, l.marcas, r.marcas, ganaL);
    else if (l.anulado || r.anulado) { const x = l.anulado ? l : r; Object.assign(u, { anulado: true, motivo: x.motivo, anuladoPor: x.anuladoPor, anuladoT: x.anuladoT }); }
  },
  respaldo: () => ({ per, perTrn, perPag }),
});

// ---------- pantallas ----------
function pPersonal() {
  const vistas = [["semana", "Semana"], ["turnos", "Turnos"], ["pagos", "Pagos"], ["empleados", "Empleados"]];
  if (!vistas.some(v => v[0] === perVista)) perVista = "semana";
  const cab = `<div class="chips seg">${vistas.map(([k, t]) => `<button data-ps="vista" data-k="${k}"${k === perVista ? ` aria-pressed="true"` : ""}>${t}</button>`).join("")}</div>`;
  if (!per.empleados.length && perVista !== "empleados")
    return cab + `<section class="card"><p>Primero anota a la gente que trabaja: nombre, turno y cuánto gana por semana. Después marcas los turnos que trabajó cada uno y la caja calcula lo que se le debe.</p>
      <div class="acts"><button class="btn brand" data-ps="vista" data-k="empleados">Anotar empleados</button></div></section>`;
  return cab + { semana: perVSemana, turnos: perVTurnos, pagos: perVPagos, empleados: perVEmpleados }[perVista]();
}
function perBarraSemana(lunes) {
  const hoy = perLunes(perHoy());
  const txt = lunes === hoy ? "Esta semana" : lunes === perMas(hoy, -7) ? "Semana pasada" : "Semana";
  return `<div class="psembar"><button class="btn ghost" data-ps="sem" data-k="-7" data-ayuda="Ver la semana anterior.">‹</button>
    <div><b>${txt}</b><span class="meta">${esc(perDiaCorto(lunes))} a ${esc(perDiaCorto(perMas(lunes, 6)))}</span></div>
    <button class="btn ghost" data-ps="sem" data-k="7" data-ayuda="Ver la semana siguiente."${lunes >= hoy ? " disabled" : ""}>›</button></div>`;
}
function perVSemana() {
  const lunes = perSemanaDe(), filas = per.empleados.map(e => ({ e, c: perCuenta(e, lunes) })).filter(r => r.e.activo !== false || r.c.dias || r.c.pagado || r.c.bonos);
  const S = k => filas.reduce((a, r) => a + r.c[k], 0), t = tasaHoy();
  const sinMarcas = filas.every(r => !r.c.dias);
  return perPagarHTML() + perBarraSemana(lunes) + `
    <div class="kpis k3">
      <div class="kpi main"><small>Se debe por la semana</small><b>${fmt(S("debe"))}</b>${t ? `<span class="meta">${fbs(S("debe") * t)}</span>` : ""}</div>
      <div class="kpi"><small>Ya pagado</small><b>${fmt(S("pagado"))}</b>${S("bonos") ? `<span class="meta">+ ${fmt(S("bonos"))} en bonos</span>` : ""}</div>
      <div class="kpi"><small>Falta pagar</small><b${S("falta") > 0.009 ? ` class="low"` : ""}>${fmt(Math.max(0, S("falta")))}</b></div>
    </div>
    ${sinMarcas ? `<p class="msg w">Esta semana no hay turnos marcados. Lo que se debe sale de los turnos trabajados: márcalos en Turnos.</p>` : ""}
    <section class="card"><div class="tbl apilar"><table><thead><tr><th>Empleado</th><th class="n">Turnos</th><th class="n">Se le debe</th><th class="n">Pagado</th><th class="n">Falta</th><th></th></tr></thead><tbody>
      ${filas.map(({ e, c }) => `<tr><td class="tpri">${esc(e.n || "Sin nombre")}<br><span class="meta">${e.cargo && e.cargo !== e.turno ? esc(e.cargo) + " · " : ""}${esc(e.turno)} · ${fmt(num(e.sueldo))}/sem</span></td>
        <td class="n" data-l="Turnos">${c.dias} de ${perDiasSemana(e)}</td>
        <td class="n" data-l="Se le debe">${fmt(c.debe)}</td>
        <td class="n" data-l="Pagado">${fmt(c.pagado)}${c.bonos ? `<br><span class="meta">+${fmt(c.bonos)} bono</span>` : ""}</td>
        <td class="n${c.falta > 0.009 ? " low" : ""}" data-l="Falta">${c.falta < -0.009 ? `<span class="meta">Pagó ${fmt(-c.falta)} de más</span>` : fmt(Math.max(0, c.falta))}</td>
        <td class="tact"><button class="btn${c.falta > 0.009 ? " brand" : " ghost"}" data-ps="pagar" data-k="${e.id}" data-ayuda="Anotar un pago a esta persona (sueldo, adelanto o bono).">Pagar</button></td></tr>`).join("")}
    </tbody></table></div>
    <p class="hint">Se le debe = sueldo de la semana ÷ días que trabaja × turnos marcados. Los adelantos se restan; los bonos van aparte.</p></section>`;
}
function perPagarHTML() {
  const f = perPagar; if (!f) return "";
  const e = perEmp(f.emp); if (!e) { perPagar = null; return ""; }
  const t = tasaHoy(), m = num(f.monto), usd = f.mon === "Bs" ? (t ? m / t : 0) : m, bs = f.mon === "Bs" ? m : m * t;
  return `<section class="card velegir" id="perPagar"><div class="oh"><h3>Pagar a ${esc(e.n || "Sin nombre")}</h3><span class="meta">Semana del ${esc(perDiaCorto(f.semana))}</span></div>
    <div class="fields">
      <label>Qué es<select data-pp="tipo">${PER_TIPOS.map(x => `<option${x === f.tipo ? " selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Cómo<select data-pp="forma">${PER_FORMAS.map(x => `<option${x === f.forma ? " selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Monto<input data-pp="monto" inputmode="decimal" value="${esc(f.monto)}" placeholder="Ej. 45"></label>
      <label>En<select data-pp="mon">${["$", "Bs"].map(x => `<option${x === f.mon ? " selected" : ""}>${x}</option>`).join("")}</select></label>
      <label class="ancho">Nota<input data-pp="nota" value="${esc(f.nota)}" placeholder="Opcional"></label>
    </div>
    <p class="meta" id="perEquiv">${m ? (t ? `${fmt(usd)} = ${fbs(bs)} a ${perDec(t)} Bs/$` : f.mon === "Bs" || f.forma !== "Efectivo $" ? `<span class="bad">Falta la tasa del día arriba para pasar a Bs.</span>` : fmt(usd)) : ""}</p>
    <label class="chk"><input type="checkbox" data-pp="gasto"${f.gasto ? " checked" : ""}> Anotarlo también como gasto de hoy en Cierre</label>
    <div class="acts"><button class="btn brand" data-ps="guardarPago">Guardar pago</button><button class="btn ghost" data-ps="cancelarPago">Cancelar</button></div></section>`;
}
function perVTurnos() {
  const f = perFecha || perHoy(), lunes = perLunes(f), act = perActivos(), hoy = perHoy();
  const semana = Array.from({ length: 7 }, (_, i) => perMas(lunes, i));
  const cuenta = d => act.reduce((a, e) => a + (perMarcado(d, e.id, "Día") ? 1 : 0) + (perMarcado(d, e.id, "Noche") ? 1 : 0), 0);
  const lista = t => {
    const orden = act.slice().sort((a, b) => (a.turno === t ? 0 : 1) - (b.turno === t ? 0 : 1));
    return orden.map(e => `<label class="chk pmarca${e.turno !== t ? " otro" : ""}"><input type="checkbox" data-pm="${e.id}" data-t="${t}"${perMarcado(f, e.id, t) ? " checked" : ""}${f > hoy ? " disabled" : ""}>
      <span>${esc(e.n || "Sin nombre")}${e.turno !== t ? `<small>de ${esc(e.turno)}</small>` : e.cargo ? `<small>${esc(e.cargo)}</small>` : ""}</span></label>`).join("");
  };
  return perBarraSemana(lunes) + `
    <div class="psem">${semana.map(d => `<button data-ps="dia" data-k="${d}"${d === f ? ` aria-pressed="true"` : ""}${d > hoy ? " disabled" : ""}><span>${esc(perDiaCorto(d).split(" ")[0])}</span><b>${perD(d).getUTCDate()}</b><small>${cuenta(d) || "·"}</small></button>`).join("")}</div>
    ${f > hoy ? `<p class="msg w">Ese día todavía no llega.</p>` : ""}
    ${["Día", "Noche"].map(t => `<section class="card"><div class="oh"><h3>${t}</h3><span class="meta">${PER_TURNOS[t]}</span></div>
      <div class="pmarcas">${lista(t)}</div>
      ${f <= hoy ? `<div class="acts"><button class="btn ghost" data-ps="todos" data-k="${t}" data-ayuda="Marca a todos los que son de este turno como que trabajaron este día.">Marcar a los de ${t.toLowerCase()}</button></div>` : ""}</section>`).join("")}
    <section class="card"><p class="hint">Si la semana fue normal, llénala de una vez: a cada uno se le marcan sus días (Día todos los días, Noche jueves a domingo) hasta hoy. Después quitas las faltas.</p>
      <div class="acts"><button class="btn ghost" data-ps="llenar" data-ayuda="Marca a cada empleado sus días normales de esta semana, hasta hoy.">Llenar la semana normal</button></div></section>`;
}
function perVPagos() {
  const lista = Object.values(perPag).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 80);
  if (!lista.length) return `<p class="empty">Todavía no hay pagos. Se anotan desde Semana con el botón Pagar.</p>`;
  return `<section class="card"><div>${lista.map(p => { const e = perEmp(p.emp); return `<div class="mov${p.anulado ? " fuera" : ""}">
      <div><b>${esc(p.tipo)}</b> · ${esc(e ? e.n : "?")}<br><span class="meta">${esc(perDiaCorto(p.fecha))}, ${esc(h12(p.hora))} · ${esc(p.forma)}${p.nota ? ` · ${esc(p.nota)}` : ""}${p.quien ? ` · ${esc(p.quien)}` : ""}${p.anulado && p.motivo ? `<br>Anulado: ${esc(p.motivo)}` : ""}</span></div>
      <div class="mq"><span>${fmt(p.usd || 0)}</span>${p.bs ? `<span class="meta">${fbs(p.bs)}</span>` : ""}${p.anulado ? `<span class="meta">Anulado</span>` : `<button class="x" style="padding:4px 0;font-size:.9rem" data-ps="anular" data-k="${p.id}" data-ayuda="Anula este pago. Queda escrito con el motivo.">Anular</button>`}</div></div>`; }).join("")}</div></section>`;
}
function perVEmpleados() {
  const fila = (e, k) => `<div class="card pemp${e.activo === false ? " fuera" : ""}">
    <div class="fields">
      <label class="ancho">Nombre<input data-pe="n" data-k="${k}" value="${esc(e.n)}" placeholder="Ej. María"></label>
      <label>Puesto<input data-pe="cargo" data-k="${k}" value="${esc(e.cargo)}" placeholder="Ej. Cocinera"></label>
      <label>Turno<select data-pe="turno" data-k="${k}">${["Día", "Noche"].map(t => `<option${t === e.turno ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Sueldo por semana ($)<input data-pe="sueldo" data-k="${k}" inputmode="decimal" value="${esc(e.sueldo)}" placeholder="Ej. 45"></label>
      <label>Días por semana<input data-pe="dias" data-k="${k}" inputmode="numeric" value="${esc(e.dias)}" placeholder="${e.turno === "Noche" ? 4 : 7}"></label>
      <label>Teléfono<input data-pe="tel" data-k="${k}" inputmode="tel" value="${esc(e.tel)}" placeholder="Opcional"></label>
    </div>
    <span class="meta" id="perDia-${k}">${num(e.sueldo) ? `${fmt(perPorDia(e))} por turno · ${PER_TURNOS[e.turno]}` : PER_TURNOS[e.turno]}</span>
    <div class="acts">${e.activo === false
      ? `<button class="btn ghost" data-ps="activar" data-k="${k}" data-ayuda="Vuelve a ponerlo en la lista de turnos y de la semana.">Volver a activar</button>`
      : `<button class="btn ghost" data-ps="baja" data-k="${k}" data-ayuda="Ya no trabaja aquí. Sale de los turnos, pero sus pagos quedan guardados.">Ya no trabaja</button>`}
      ${perPagosVivos().some(p => p.emp === e.id) ? "" : `<button class="x" data-ps="quitar" data-k="${k}" data-ayuda="Borra a esta persona. Solo se puede si no tiene pagos.">× Quitar</button>`}</div></div>`;
  const orden = per.empleados.map((e, k) => [e, k]).sort((a, b) => (a[0].activo === false) - (b[0].activo === false));
  return `<div class="pila">${orden.map(([e, k]) => fila(e, k)).join("") || `<p class="note">Sin empleados.</p>`}
    <div class="acts"><button class="btn brand" data-ps="nuevo" data-ayuda="Anota a una persona nueva.">+ Agregar empleado</button>
    ${per.empleados.length ? "" : `<button class="btn ghost" data-ps="puestos" data-ayuda="Crea los puestos de siempre con su sueldo (atiende 45 $, cocinera 50 $, encargado 60 $, noche 30 $). Solo falta poner los nombres.">Cargar los puestos de siempre</button>`}</div>
    <p class="hint">Los sueldos los ve cualquiera que entre a la app con usuario de la tienda.</p></div>`;
}

// ---------- acciones ----------
function perNuevoEmp(o) { return Object.assign({ id: "e" + uid() + uid(), n: "", cargo: "", turno: "Día", sueldo: "", dias: "", tel: "", activo: true, desde: perHoy() }, o); }
function perAbrirPago(id) {
  const e = perEmp(id), lunes = perSemanaDe(), c = perCuenta(e, lunes);
  perPagar = { emp: id, semana: lunes, tipo: "Sueldo", forma: "Efectivo $", monto: c.falta > 0.009 ? perDec(c.falta) : "", mon: "$", nota: "", gasto: true };
}
function perGuardarPago() {
  const f = perPagar, e = f && perEmp(f.emp); if (!e) return;
  const t = tasaHoy(), m = num(f.monto);
  if (!(m > 0)) { toast("Pon el monto."); return; }
  if ((f.mon === "Bs" || f.forma !== "Efectivo $") && !t) { toast("Pon la tasa del día arriba."); return; }
  const usd = f.mon === "Bs" ? m / t : m, ah = ahoraCaracas();
  const p = { id: uid() + uid(), emp: e.id, semana: f.semana, tipo: f.tipo, forma: f.forma, usd: Math.round(usd * 100) / 100,
    bs: f.forma === "Efectivo $" && f.mon === "$" ? 0 : Math.round((f.mon === "Bs" ? m : m * t) * 100) / 100, tasa: t,
    nota: f.nota.trim(), fecha: ah.fecha, hora: ah.hora, t: Date.now(), quien: cfg.equipo || "", rev: 0 };
  // Como gasto del día: en Bs si se pagó en Bs, si no en $ (así cuadra la gaveta en Cierre)
  if (f.gasto) {
    const d = diaDe(ah.fecha), enBs = f.forma !== "Efectivo $" || f.mon === "Bs";
    d.gastos.push({ id: "s" + p.id, c: `${p.tipo} ${e.n || "empleado"}`, m: perDec(enBs ? p.bs : p.usd), mon: enBs ? "Bs" : "$", pago: f.forma === "Pago móvil" ? "Pago móvil" : "Efectivo" });
    p.gasto = "s" + p.id; tocarDia(ah.fecha);
  }
  perPag[p.id] = p; perPagar = null; perTocar("per:pag:" + p.id);
  toast(`Pago de ${fmt(p.usd)} anotado.`);
}
function perAnular(id) {
  const p = perPag[id]; if (!p || p.anulado) return;
  const motivo = (prompt("¿Por qué lo anulas? Ej. se anotó dos veces") || "").trim();
  if (!motivo) { toast("Para anular escribe el motivo."); return; }
  Object.assign(p, { anulado: true, motivo, anuladoPor: cfg.equipo || "", anuladoT: Date.now() });
  if (p.gasto && dias[p.fecha]) {
    const d = diaDe(p.fecha), k = d.gastos.findIndex(g => g.id === p.gasto);
    if (k >= 0) { d.gastos.splice(k, 1); (d.quitados = d.quitados || {})[p.gasto] = Date.now(); tocarDia(p.fecha); }
  }
  perTocar("per:pag:" + id); toast("Anulado.");
}
function perMarcar(f, id, t, si) {
  const d = perTrn[f] || (perTrn[f] = { fecha: f, marcas: {}, rev: 0 });
  d.marcas[id + ":" + t] = si ? 1 : 0;
}
document.addEventListener("click", e => {
  const b = e.target.closest("#main [data-ps]"); if (!b || typeof tab === "undefined" || tab !== "personal") return;
  const a = b.dataset.ps, k = b.dataset.k, hoy = perHoy();
  if (a === "vista") { perVista = k; perPagar = null; LS.set("pa.perVista", k); }
  if (a === "sem") { const l = perMas(perSemanaDe(), +k); perSemana = l > perLunes(hoy) ? "" : l; perFecha = perSemana ? perMas(perSemana, 6) : hoy; perPagar = null; }
  if (a === "dia") perFecha = k;
  if (a === "todos") {
    const f = perFecha || hoy; perActivos().filter(x => x.turno === k).forEach(x => perMarcar(f, x.id, k, true)); perTocar("per:trn:" + f);
  }
  if (a === "llenar") {
    const lunes = perLunes(perFecha || hoy), tocados = new Set();
    perActivos().forEach(x => perDiasNormales(x).forEach(i => { const f = perMas(lunes, i); if (f <= hoy) { perMarcar(f, x.id, x.turno, true); tocados.add(f); } }));
    tocados.forEach(f => perTocar("per:trn:" + f, true)); toast("Semana llenada. Quita a quien faltó.");
  }
  if (a === "pagar") { perAbrirPago(k); pintar(); $("#perPagar")?.scrollIntoView({ block: "start" }); $("#perPagar input[data-pp='monto']")?.focus(); return; }
  if (a === "cancelarPago") perPagar = null;
  if (a === "guardarPago") { perGuardarPago(); if (perPagar) return; }
  if (a === "anular") perAnular(k);
  if (a === "nuevo") { per.empleados.push(perNuevoEmp()); perTocar("personal"); pintar(); const ins = document.querySelectorAll("#main input[data-pe='n']"); ins[ins.length - 1]?.focus(); return; }
  if (a === "puestos") {
    [["Atiende", "Día", "45"], ["Cocinera", "Día", "50"], ["Encargado", "Día", "60"], ["Noche", "Noche", "30"]].forEach(([c, t, s]) => per.empleados.push(perNuevoEmp({ cargo: c, turno: t, sueldo: s })));
    perTocar("personal"); toast("Listo. Ahora pon el nombre de cada uno.");
  }
  if (a === "baja" || a === "activar") { const x = per.empleados[+k]; if (x) { x.activo = a === "activar"; perTocar("personal"); } }
  if (a === "quitar") {
    const x = per.empleados[+k];
    if (x && confirm(`¿Quitar a ${x.n || "esta persona"}?`)) { per.empleados.splice(+k, 1); (per.quitados = per.quitados || {})[x.id] = Date.now(); perTocar("personal"); }
  }
  pintar();
});
document.addEventListener("input", e => {
  const el = e.target; if (!el.closest || !el.closest("#main") || typeof tab === "undefined" || tab !== "personal") return;
  if (el.dataset.pe) {
    const k = +el.dataset.k, x = per.empleados[k]; if (!x) return;
    x[el.dataset.pe] = el.value; perTocar("personal", true);
    if (el.dataset.pe === "turno") { pintar(); return; }
    const m = $("#perDia-" + k); if (m) m.textContent = num(x.sueldo) ? `${fmt(perPorDia(x))} por turno · ${PER_TURNOS[x.turno]}` : PER_TURNOS[x.turno];
  } else if (el.dataset.pp && perPagar) {
    const k = el.dataset.pp; perPagar[k] = el.type === "checkbox" ? el.checked : el.value;
    if (k === "forma") { perPagar.mon = el.value === "Efectivo $" ? "$" : perPagar.mon; perPagar.gasto = true; }
    if (k === "monto") { const p = $("#perEquiv"), t = tasaHoy(), m = num(el.value), usd = perPagar.mon === "Bs" ? (t ? m / t : 0) : m; if (p) p.innerHTML = m && t ? `${fmt(usd)} = ${fbs(perPagar.mon === "Bs" ? m : m * t)} a ${perDec(t)} Bs/$` : ""; return; }
    if (el.type !== "checkbox") pintar();
  } else if (el.dataset.pm) {
    const f = perFecha || perHoy(); perMarcar(f, el.dataset.pm, el.dataset.t, el.checked); perTocar("per:trn:" + f, true);
    const n = document.querySelector(`#main .psem button[data-k="${f}"] small`);
    if (n) { const act = perActivos(); n.textContent = act.reduce((a, x) => a + (perMarcado(f, x.id, "Día") ? 1 : 0) + (perMarcado(f, x.id, "Noche") ? 1 : 0), 0) || "·"; }
  }
});
document.addEventListener("change", e => { const el = e.target; if (el.matches && el.matches("#main select[data-pp], #main select[data-pe]")) el.dispatchEvent(new Event("input", { bubbles: true })); });

// Estilos propios del módulo
document.head.insertAdjacentHTML("beforeend", `<style>
.psembar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.psembar > div { display: grid; text-align: center; } .psembar b { font: 700 1.05rem var(--display); }
.psembar .btn { padding: 8px 16px; font-size: 1.1rem; }
.psem { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.psem button { display: grid; gap: 0; justify-items: center; border: 0; border-radius: 12px; padding: 6px 2px; background: var(--line); color: var(--fg); font: 700 .75rem var(--body); cursor: pointer; }
.psem button b { font: 700 1.1rem var(--display); } .psem button small { color: var(--muted); font-size: .72rem; }
.psem button[aria-pressed="true"] { background: var(--fg); color: var(--surface); } .psem button[aria-pressed="true"] small { color: inherit; opacity: .8; }
.psem button:disabled { opacity: .35; cursor: default; }
.pmarcas { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr)); }
.pmarca { background: var(--bg); border-radius: 10px; padding: 10px; cursor: pointer; }
.pmarca span { display: grid; } .pmarca small { color: var(--muted); font-weight: 600; font-size: .78rem; }
.pmarca.otro { opacity: .75; }
.fuera { opacity: .55; }
</style>`);
