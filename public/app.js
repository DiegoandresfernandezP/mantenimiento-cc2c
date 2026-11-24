const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (s) => String(s).replace(/[^\wÁ-ú]/g, '');
let S = null, view = 'inicio';
const toast = (t) => { const e = $('#toast'); e.textContent = t; e.className = 'on'; setTimeout(() => (e.className = ''), 3500); };
async function api(p, o = {}) {
  const r = await fetch(p, { method: o.method || 'GET', headers: { 'content-type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { S = null; return login(); }
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const tag = (t) => `<span class="tag ${cls(t)}">${esc(t)}</span>`;
const fnum = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
const hm = (h) => (h == null ? '—' : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`);
const form = (el, fn) => el.addEventListener('submit', async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await fn(d, e.target); } catch (x) { toast(x.message); } });

async function login() {
  $('#nav').innerHTML = ''; $('#who').textContent = '';
  const us = await (await fetch('/api/usuarios-login')).json();
  $('#app').innerHTML = `<div class="card"><h2>Ingresar</h2><form id="f"><label>Usuario</label><select name="nombre" id="un">${us.map((u) => `<option value="${esc(u.nombre)}" data-n="${u.tiene_pin ? 0 : 1}">${esc(u.nombre)}</option>`).join('')}</select>
  <label>PIN (4 a 8 dígitos)</label><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
  <div id="cod" hidden><label>Primer ingreso: código de instalación</label><input name="codigo" type="password"><p class="m">Este usuario aún no tiene PIN: el que escriba arriba será su PIN.</p></div>
  <button class="b">Entrar</button></form></div>`;
  const sync = () => { $('#cod').hidden = $('#un').selectedOptions[0].dataset.n !== '1'; }; $('#un').onchange = sync; sync();
  form($('#f'), async (d) => { await api('/api/login', { method: 'POST', body: d }); await load(); });
}
const TABS = [['inicio', 'Inicio'], ['hoy', 'Hoy'], ['plan', 'Mantenimiento'], ['fallas', 'Fallas'], ['ot', 'Órdenes'], ['rep', 'Repuestos'], ['ind', 'Indicadores'], ['mas', 'Historial / QR']];
async function load() { S = await api('/api/estado'); $('#who').textContent = S.usuario.nombre + ' · salir'; $('#who').style.cursor = 'pointer'; $('#who').onclick = async () => { await api('/api/logout'); S = null; login(); }; go(view); }
function go(v) { view = v; $('#nav').innerHTML = TABS.map(([k, t]) => `<button class="${k === v ? 'on' : ''}" data-k="${k}">${t}</button>`).join(''); $('#nav').onclick = (e) => { const k = e.target.dataset.k; if (k) go(k); }; V[v](); }
const resp = () => /Responsable|Aprobador/.test(S.usuario.rol || '');

const V = {
  async inicio() {
    S = await api('/api/estado'); const r = S.resumen, l = S.lectura;
    $('#app').innerHTML = `<h2>Estado del equipo</h2><div class="grid">
    <div class="card"><div class="m">Tiempo de impresión acumulado</div><div class="k">${l ? hm(l.horometro) : '—'}</div><div class="m">Última lectura: ${l ? esc(l.fecha) : '—'}</div></div>
    <div class="card"><div class="m">Mantenimientos vencidos</div><div class="k" style="color:var(--bad)">${r.venc.length}</div><div class="m">${r.prox.length} próximos</div></div>
    <div class="card"><div class="m">Fallas abiertas · OT abiertas</div><div class="k">${r.fal.length} · ${r.ots.length}</div></div>
    <div class="card"><div class="m">Inspección de hoy</div><div class="k">${r.inspHoy ? 'Hecha' : 'Falta'}</div><div class="m">${esc(S.hoy)}</div></div></div>
    ${r.venc.length ? `<div class="card"><h3>Vencidos</h3>${r.venc.map((a) => `<div class="pt"><span>${esc(a.id)} · ${esc(a.nombre)}<br><span class="m">era ${esc(a.proxima)}</span></span>${tag('Vencido')}</div>`).join('')}</div>` : ''}
    ${r.prox.length ? `<div class="card"><h3>Próximos</h3>${r.prox.map((a) => `<div class="pt"><span>${esc(a.id)} · ${esc(a.nombre)}<br><span class="m">${esc(a.proxima)}</span></span>${tag('Próximo')}</div>`).join('')}</div>` : ''}
    <div class="card m">Equipo: ${esc(S.equipo.nombre)} · Propietario ${esc(S.equipo.propietario)} · ${esc(S.equipo.ubicacion)} · Firmware ${esc(S.equipo.firmware)}<br>Las frecuencias marcadas PROPUESTA están pendientes de validación técnica por el responsable de mantenimiento.</div>`;
  },
  async hoy() {
    const items = ['Entorno estable y sin vibración', 'Cable y enchufe sin daños', 'Cámara y cama sin residuos', 'Placa de impresión asentada y limpia', 'Rampa de residuos libre', 'CANVAS: carretes y tubos en posición', 'Pantalla sin errores al encender', 'Sin olores, ruidos ni calor anormales'];
    const l = S.lectura;
    $('#app').innerHTML = `<h2>Registro de hoy</h2>
    <form id="fi" class="card"><h3>FOR-001 · Inspección diaria</h3>${items.map((t, i) => `<div class="pt"><span>${i + 1}. ${t}</span><select name="p${i + 1}" required><option value="">—</option><option>Cumple</option><option>No cumple</option></select></div>`).join('')}
    <label>Observaciones</label><textarea name="obs"></textarea><button class="b">Guardar inspección</button><p class="m">Si algún punto no cumple, NO opere la impresora y registre la novedad en Fallas.</p></form>
    <form id="fh" class="card"><h3>FOR-002 · Encendido, apagado y tiempo de impresión</h3>
    <p class="m">Apague la impresora al terminar la última impresión (sin continuar con otra). Anote la lectura de "tiempo de impresión" de la pantalla. Última: ${l ? hm(l.horometro) : '—'}.</p>
    <div class="row"><div><label>Hora de encendido</label><input type="time" name="encendido" required></div><div><label>Hora de apagado</label><input type="time" name="apagado" required></div></div>
    <div class="row"><div><label>Lectura: horas</label><input type="number" name="lectura_h" min="0" required></div><div><label>Lectura: minutos</label><input type="number" name="lectura_min" min="0" max="59" required></div></div>
    <label>Observaciones</label><input name="obs"><button class="b">Guardar lectura</button></form>`;
    form($('#fi'), async (d) => { const r = await api('/api/inspeccion', { method: 'POST', body: d }); toast(r.apto === 'Apto' ? 'Inspección guardada: equipo apto' : '⚠ NO OPERAR: reporte la novedad'); });
    form($('#fh'), async (d, f) => { const r = await api('/api/horas', { method: 'POST', body: d }); toast('Guardado' + (r.horas_dia != null ? ` · ${fnum(r.horas_dia)} h de impresión` : '') + (r.alertas.length ? ' · ⚠ ' + r.alertas.join('; ') : '')); f.reset(); S = await api('/api/estado'); });
  },
  async plan() {
    const p = await api('/api/plan');
    $('#app').innerHTML = `<h2>Plan de mantenimiento</h2><p class="m">Cada actividad sigue el procedimiento de la guía (códigos ACT). Frecuencias PROPUESTA: pendientes de validación.</p>
    <div class="card tw"><table><tr><th>Código</th><th>Actividad</th><th>Frecuencia</th><th>Última</th><th>Próxima</th><th>Estado</th><th></th></tr>${p.map((a) => `<tr><td>${a.id}</td><td>${esc(a.nombre)}<br><span class="m">${esc(a.responsable)}</span></td><td class="m">${a.frecuencia_dias ? 'cada ' + a.frecuencia_dias + ' d' : esc((a.frecuencia_txt || '').split(':')[0])}</td><td>${esc(a.ultima || '—')}</td><td>${esc(a.proxima || '—')}</td><td>${tag(a.estado === 'Por evento' ? 'Por evento' : a.estado)}</td><td><button class="b s" data-a="${a.id}" style="margin:0;padding:6px 10px">Registrar</button></td></tr>`).join('')}</table></div><div id="dlg"></div>`;
    $('#app').onclick = (e) => { const a = e.target.dataset.a; if (!a) return; const x = p.find((q) => q.id === a);
      $('#dlg').innerHTML = `<form id="fe" class="card"><h3>FOR-003 · ${x.id} ${esc(x.nombre)}</h3><label>Resultado</label><select name="resultado" required><option>Cumple</option><option>No cumple</option><option>N/A</option></select><label>Evidencia (foto / referencia)</label><input name="evidencia"><label>Observaciones</label><textarea name="obs"></textarea><input type="hidden" name="act_id" value="${x.id}"><button class="b">Guardar</button></form>`; $('#fe').scrollIntoView();
      form($('#fe'), async (d) => { await api('/api/ejecuciones', { method: 'POST', body: d }); toast('Registrado'); V.plan(); }); };
  },
  async fallas() {
    const f = await api('/api/fallas');
    $('#app').innerHTML = `<h2>Novedades y fallas</h2><form id="ff" class="card"><h3>FOR-004 · Reportar</h3>
    <label>Descripción de lo observado</label><textarea name="descripcion" required></textarea>
    <div class="row"><div><label>Código de error en pantalla</label><input name="codigo_error"></div><div><label>Código FAL (guía cap. 7)</label><input name="fal_codigo"></div></div>
    <div class="row"><div><label>Filamento / modelo</label><input name="filamento"></div><div><label>¿Equipo detenido?</label><select name="detenido"><option>Sí</option><option>No</option></select></div></div>
    <label>Acción inmediata tomada</label><input name="accion"><button class="b">Enviar reporte</button></form>
    <div class="card tw"><table><tr><th>ID</th><th>Fecha</th><th>Descripción</th><th>Error</th><th>Estado</th></tr>${f.map((x) => `<tr><td>${x.id}</td><td>${esc(x.fecha)}</td><td>${esc(x.descripcion)}<br><span class="m">${esc(x.reporto || '')}</span></td><td>${esc(x.codigo_error || '')}</td><td>${tag(x.estado)}</td></tr>`).join('') || '<tr><td colspan=5 class="m">Sin reportes</td></tr>'}</table></div>`;
    form($('#ff'), async (d) => { const r = await api('/api/fallas', { method: 'POST', body: d }); toast('Reporte ' + r.id + ' enviado'); V.fallas(); });
  },
  async ot() {
    const [o, f, p] = await Promise.all([api('/api/ot'), api('/api/fallas'), api('/api/plan')]);
    $('#app').innerHTML = `<h2>Órdenes de trabajo</h2>${resp() ? `<form id="fo" class="card"><h3>FOR-005 · Nueva OT</h3><div class="row"><div><label>Prioridad</label><select name="prioridad"><option>Alta</option><option selected>Media</option><option>Baja</option></select></div><div><label>Origen</label><select name="origen"><option>Preventivo</option><option>Falla</option><option>Inspección</option></select></div></div>
    <div class="row"><div><label>Actividad (ACT)</label><select name="act_id"><option value="">—</option>${p.map((a) => `<option value="${a.id}">${a.id} ${esc(a.nombre)}</option>`).join('')}</select></div><div><label>Falla asociada</label><select name="falla_id"><option value="">—</option>${f.filter((x) => x.estado !== 'Cerrada').map((x) => `<option>${x.id}</option>`).join('')}</select></div></div>
    <label>Trabajo a realizar</label><textarea name="trabajo" required></textarea><div class="row"><div><label>Asignado a</label><input name="asignado_a"></div><div><label>Repuestos (REP-)</label><input name="repuestos"></div></div><button class="b">Abrir OT</button></form>` : '<p class="m">Las OT las abre un responsable.</p>'}
    <div class="card tw"><table><tr><th>OT</th><th>Trabajo</th><th>Prior.</th><th>Estado</th><th></th></tr>${o.map((x) => `<tr><td>${x.id}<br><span class="m">${esc(x.fecha_apertura)}</span></td><td>${esc(x.trabajo)}<br><span class="m">${esc(x.resultado || '')}</span></td><td>${esc(x.prioridad)}</td><td>${tag(x.estado)}</td><td>${resp() && x.estado !== 'Cerrada' ? `<button class="b s" data-c="${x.id}" style="margin:0;padding:6px 10px">Cerrar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=5 class="m">Sin órdenes</td></tr>'}</table></div><div id="dlg"></div>`;
    if (resp()) form($('#fo'), async (d) => { const r = await api('/api/ot', { method: 'POST', body: d }); toast(r.id + ' abierta'); V.ot(); });
    $('#app').onclick = (e) => { const c = e.target.dataset.c; if (!c) return; $('#dlg').innerHTML = `<form id="fc" class="card"><h3>Cerrar ${c}</h3><label>Resultado / trabajo realizado</label><textarea name="resultado" required></textarea><div class="row"><div><label>Tiempo de parada (h)</label><input type="number" step="0.1" min="0" name="parada_h" required></div><div><label>Costo (COP)</label><input type="number" min="0" name="costo_cop"></div></div><label>Verificó (responsable)</label><input name="verificado_por"><input type="hidden" name="cerrar" value="1"><button class="b">Cerrar OT</button></form>`; $('#fc').scrollIntoView(); form($('#fc'), async (d) => { await api('/api/ot/' + c, { method: 'PATCH', body: d }); toast('OT cerrada'); V.ot(); }); };
  },
  async rep() {
    const r = await api('/api/repuestos');
    $('#app').innerHTML = `<h2>Repuestos e insumos</h2>${resp() ? `<form id="fr" class="card"><h3>FOR-006 · Nuevo</h3><label>Descripción</label><input name="descripcion" required><label>Compatibilidad (CC2C) — confirmar con fuente oficial</label><input name="compat"><div class="row"><div><label>Existencia</label><input type="number" name="existencia" min="0" value="0"></div><div><label>Mínimo</label><input type="number" name="minimo" min="0" value="0"></div></div><button class="b">Agregar</button></form>` : ''}
    <div class="card tw"><table><tr><th>Código</th><th>Descripción</th><th>Compat.</th><th>Existencia</th><th>Mín.</th><th>Estado</th></tr>${r.map((x) => `<tr><td>${x.id}</td><td>${esc(x.descripcion)}</td><td class="m">${esc(x.compat || '')}</td><td>${resp() ? `<input type="number" min="0" value="${x.existencia}" data-r="${x.id}" data-f="e" style="width:80px">` : x.existencia}</td><td>${x.minimo}</td><td>${tag(x.minimo > 0 && x.existencia <= x.minimo ? 'Abierta' : 'OK').replace('>Abierta<', '>Reponer<')}</td></tr>`).join('') || '<tr><td colspan=6 class="m">Sin repuestos registrados</td></tr>'}</table></div>`;
    if (resp()) { form($('#fr'), async (d) => { await api('/api/repuestos', { method: 'POST', body: d }); V.rep(); }); $('#app').onchange = async (e) => { const id = e.target.dataset.r; if (!id) return; const x = r.find((q) => q.id === id); await api('/api/repuestos/' + id, { method: 'PATCH', body: { existencia: e.target.value, minimo: x.minimo } }); toast('Actualizado'); V.rep(); }; }
  },
  async ind() {
    const d = await api('/api/indicadores'); const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1) + ' %');
    $('#app').innerHTML = `<h2>Indicadores (últimos 30 días)</h2><div class="grid">${d.map((x) => `<div class="card"><div class="m">${x.id} · ${x.nombre}</div><div class="k">${x.unidad === '%' ? pct(x.valor) : x.valor == null ? '—' : fnum(x.valor, x.unidad === 'COP' ? 0 : 1) + ' ' + x.unidad}</div><div class="m">${esc(x.nota || '')}</div></div>`).join('')}</div><p class="m">Calculados con los registros reales; sin datos aparece "—". No hay valores simulados.</p>`;
  },
  async mas() {
    const [h, q] = await Promise.all([api('/api/historial'), api('/api/qr')]);
    $('#app').innerHTML = `<h2>Historial de intervenciones</h2><div class="card tw"><table><tr><th>Fecha</th><th>Tipo</th><th>Ref.</th><th>Detalle</th></tr>${h.map((x) => `<tr><td>${esc(x.fecha)}</td><td>${esc(x.tipo)}</td><td>${esc(x.ref)}</td><td>${esc(x.det)}</td></tr>`).join('') || '<tr><td colspan=4 class="m">Sin registros</td></tr>'}</table></div>
    <h2>Códigos QR (destino actualizable)</h2><p class="m">Cada etiqueta imprime <b>${location.origin}/qr/QR-0xx</b>. Aquí se cambia el video sin reimprimir.</p><div class="card tw"><table><tr><th>QR</th><th>Procedimiento</th><th>Aplicabilidad</th><th>Destino</th></tr>${q.map((x) => `<tr><td>${x.id}</td><td>${esc(x.act_ref)}</td><td class="m">${esc(x.aplicabilidad)}</td><td>${resp() ? `<input value="${esc(x.url)}" data-q="${x.id}">` : `<a href="/qr/${x.id}" target="_blank">abrir</a>`}</td></tr>`).join('')}</table></div>`;
    $('#app').onchange = async (e) => { const id = e.target.dataset.q; if (!id) return; await api('/api/qr/' + id, { method: 'PATCH', body: { url: e.target.value } }); toast('QR actualizado'); };
  },
};
(async () => { try { await load(); } catch { login(); } })();
