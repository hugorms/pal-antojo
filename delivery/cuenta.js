let seccion = "pedidos", billetera = null, editandoPago = false, guardandoPago = false, falloPago = "", filtroHist = "Todos";
const fechaDlv = (valor, opciones) => new Date(valor).toLocaleString("es-VE", {timeZone:"America/Caracas", ...opciones});
let ultimaConsultaPago = 0;
function abrirSeccion(destino) {
  seccion = destino;
  pintar(); scrollTo(0,0);
  if (destino === "dinero") operarBilletera("ver");
}
async function operarBilletera(accion, p = {}) {
  if (guardandoPago) return;
  guardandoPago = true; falloPago = ""; pintar();
  try {
    billetera = await rpc("dlv_billetera", {accion, p});
    ultimaConsultaPago = Date.now();
    if (accion === "guardar") { editandoPago = false; toast("Datos de pago guardados."); }
    if (accion === "solicitar") toast("Caja recibió tu solicitud.");
  } catch(e) { falloPago = e.message; toast(e.message); }
  finally { guardandoPago = false; pintar(); }
}
function iniciarFicha() { editandoPago = true; pintar(); }
function campoPago(nombre, etiqueta, atributos) {
  return `<label>${etiqueta}<input name="${nombre}" required ${atributos} value="${esc(billetera.ficha?.[nombre] || "")}"></label>`;
}
function miDinero() {
  const retiros = billetera?.retiros || [], pendiente = retiros.find(r => !r.pagado), ficha = billetera?.ficha;
  return `<h2>Mi dinero</h2><section class="saldo"><span>Pa’l Antojo te debe</span><strong>${fmt(datos.por_cobrar)}</strong><small>Por tus envíos entregados</small></section>
  ${falloPago ? '<p class="msg bad">'+esc(falloPago)+'</p>' : ""}
  ${!billetera ? '<button class="btn ghost" onclick="operarBilletera(\'ver\')">'+(guardandoPago?"Cargando…":"Volver a cargar")+'</button>' :
    `<section class="card"><h3>Pago Móvil</h3>${editandoPago ? `<form id="fichaPago" class="ficha">
    ${campoPago("titular","Titular",'maxlength="80" minlength="2"')}
    ${campoPago("banco","Banco",'maxlength="80" minlength="2" placeholder="Nombre o código del banco"')}
    ${campoPago("cedula","Cédula o RIF",'maxlength="12" placeholder="V12345678"')}
    ${campoPago("telefono","Teléfono de Pago Móvil",'type="tel" pattern="04[0-9]{9}" maxlength="11" placeholder="04121234567"')}
    <div class="fila"><button class="btn brand">Guardar datos</button><button type="button" class="btn ghost" onclick="editandoPago=false;pintar()">Cancelar</button></div></form>` :
    `<p>${ficha ? '<b>'+esc(ficha.titular)+'</b><br>'+esc(ficha.banco)+' · '+esc(ficha.cedula)+'<br>'+esc(ficha.telefono) : "Agrega la cuenta donde quieres recibir tus envíos."}</p>
    <button class="btn ghost" onclick="iniciarFicha()">${ficha?"Editar":"Agregar"} datos de pago</button>`}</section>
    <section class="card"><h3>Retirar dinero</h3><p>${pendiente ? "Caja tiene tu solicitud por "+fmt(pendiente.monto)+" pendiente de pago." : "Caja revisa tu solicitud y realiza el pago."}</p>
    <button class="btn brand" ${!ficha || pendiente || guardandoPago || editandoPago || !(datos.por_cobrar>0) ? "disabled" : ""} onclick="operarBilletera('solicitar')">Solicitar retiro</button></section>
    ${retiros.length ? `<section class="card"><h3>Mis retiros</h3>${retiros.map(r=>`<div class="mov"><div><b>${fmt(r.monto)}</b><small>${fechaDlv(r.creado,{day:"numeric",month:"short",year:"numeric"})}</small></div><span class="pill ${r.pagado?"g":"w"}">${r.pagado?"Pagado":"Solicitado"}</span></div>`).join("")}</section>` : ""}`}`;
}
function historialDelivery() {
  const lista = datos.historial.filter(h=>filtroHist==="Todos" || Boolean(h.pagado)===(filtroHist==="Pagados"));
  return `<h2>Historial de entregas</h2><div class="filtros">${["Todos","Por cobrar","Pagados"].map(f=>`<button aria-pressed="${f===filtroHist}" onclick="filtroHist=this.textContent;pintar()">${f}</button>`).join("")}</div>
    <section class="card">${lista.map(h=>`<div class="mov"><div><b>${esc(h.cliente || "Cliente")}</b><small>${fechaDlv(h.entregado,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</small></div><div><b>${fmt(h.envio)}</b><small>${h.pagado?"Pagado":"Por cobrar"}</small></div></div>`).join("") || "<p>Todavía no hay entregas en esta vista.</p>"}</section>`;
}
function activarGpsAjustes() {
  if (!navigator.geolocation) { toast("Este teléfono no ofrece ubicación."); return; }
  navigator.geolocation.getCurrentPosition(() => { permisoGps="granted"; actualizarGps(); pintar(); toast("Ubicación habilitada."); },
    e=>{ if(e.code===1) permisoGps="denied"; pintar(); toast(e.code===1?"Habilita Ubicación en los permisos del teléfono.":"No se pudo obtener tu ubicación."); },
    {enableHighAccuracy:true,timeout:20000});
}
function ajustesDelivery() {
  return `<h2>Ajustes</h2><section class="card"><h3>Mis datos</h3><b>${esc(cuenta.nombre)}</b><p>${esc(cuenta.email)}<br>${esc(cuenta.telefono || "")}</p></section>
    <section class="card"><h3>Ubicación GPS</h3><p>${permisoGps==="granted"?"Permiso activo. La ubicación se comparte durante el turno o una entrega.":permisoGps==="denied"?"Ubicación bloqueada. Abre los permisos de Delivery en el teléfono y permite la ubicación.":"Activa la ubicación para recibir pedidos por cercanía."}</p>
    <button class="btn ghost" onclick="activarGpsAjustes()">${permisoGps==="granted"?"Comprobar GPS":"Activar GPS"}</button></section>
    <section class="card"><h3>Avisos de pedidos</h3><p>${datos.yo.avisos && avisoPermiso==="granted"?"Avisos activados en este teléfono.":"Permite los avisos para recibir pedidos con la app cerrada."}</p><button class="btn ghost" onclick="activarAvisos()">Activar avisos</button></section>`;
}
document.addEventListener("submit", e=>{
  if(e.target.id!=="fichaPago") return;
  e.preventDefault(); operarBilletera("guardar",Object.fromEntries(new FormData(e.target)));
});
