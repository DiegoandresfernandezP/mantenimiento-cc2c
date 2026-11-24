// CMMS EQ-001 · ELEGOO Centauri Carbon 2 Combo · Worker + D1
// Secretos (Cloudflare > Worker > Settings > Variables and Secrets):
//   SETUP_CODE, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // Bogotá UTC-5
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const rnd = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPin(pin, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
const num = (v) => (v === '' || v == null ? null : Number(v));
const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max));

async function nextId(db, prefix, table) {
  const r = await db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).bind(prefix + '-%').all();
  const m = r.results.reduce((a, x) => Math.max(a, parseInt(x.id.split('-')[1]) || 0), 0);
  return `${prefix}-${String(m + 1).padStart(3, '0')}`;
}
async function auth(req, env) {
  const c = req.headers.get('cookie') || '';
  const t = (c.match(/(?:^|;\s*)sid=([a-f0-9]+)/) || [])[1];
  if (!t) return null;
  return await env.DB.prepare("SELECT u.id,u.nombre,u.rol,u.turno FROM sesion s JOIN usuario u ON u.id=s.usuario_id WHERE s.token=? AND s.expira>? AND u.activo=1").bind(t, new Date().toISOString()).first();
}
async function ultimaLectura(db) { return await db.prepare('SELECT * FROM registro_horas ORDER BY fecha DESC,id DESC LIMIT 1').first(); }

// ---------- Estado del plan ----------
async function plan(db) {
  const acts = (await db.prepare('SELECT a.*,s.nombre AS sub FROM actividad a LEFT JOIN subsistema s ON s.id=a.sub_id ORDER BY a.id').all()).results;
  const ult = (await db.prepare('SELECT act_id,MAX(fecha) f FROM ejecucion GROUP BY act_id').all()).results;
  const map = Object.fromEntries(ult.map((u) => [u.act_id, u.f]));
  const base = '2026-11-23', h = hoy();
  return acts.map((a) => {
    const last = map[a.id] || null;
    let proxima = null, estado = 'Por evento';
    if (a.frecuencia_dias) {
      proxima = addDays(last || base, a.frecuencia_dias);
      const d = diffDays(proxima, h);
      estado = d < 0 ? 'Vencido' : d <= Math.max(1, Math.round(a.frecuencia_dias * 0.2)) ? 'Próximo' : 'Al día';
    }
    return { ...a, ultima: last, proxima, estado };
  });
}
async function resumen(db) {
  const p = await plan(db);
  const venc = p.filter((x) => x.estado === 'Vencido'), prox = p.filter((x) => x.estado === 'Próximo');
  const ots = (await db.prepare("SELECT id,trabajo,prioridad FROM ot WHERE estado!='Cerrada' AND estado!='Cancelada'").all()).results;
  const rep = (await db.prepare('SELECT id,descripcion FROM repuesto WHERE existencia<=minimo AND minimo>0').all()).results;
  const fal = (await db.prepare("SELECT id,descripcion FROM falla WHERE estado='Abierta'").all()).results;
  const ins = await db.prepare('SELECT COUNT(*) c FROM inspeccion WHERE fecha=?').bind(hoy()).first();
  return { venc, prox, ots, rep, fal, inspHoy: ins.c };
}
function textoResumen(r) {
  const L = [`🛠 EQ-001 · Centauri Carbon 2 · ${hoy()}`];
  if (r.venc.length) L.push('\n🔴 Vencidos:\n' + r.venc.map((x) => `• ${x.id} ${x.nombre} (era ${x.proxima})`).join('\n'));
  if (r.prox.length) L.push('\n🟡 Próximos:\n' + r.prox.map((x) => `• ${x.id} ${x.nombre} (${x.proxima})`).join('\n'));
  if (r.fal.length) L.push('\n⚠️ Fallas abiertas: ' + r.fal.map((x) => x.id).join(', '));
  if (r.ots.length) L.push('\n📋 OT abiertas: ' + r.ots.map((x) => x.id).join(', '));
  if (r.rep.length) L.push('\n📦 Repuestos por reponer: ' + r.rep.map((x) => x.id).join(', '));
  if (L.length === 1) L.push('\n✅ Sin pendientes.');
  return L.join('\n');
}
async function tgSend(env, chat, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
  return r.ok;
}
async function avisar(env, tipo, clave, texto) {
  const ya = await env.DB.prepare('SELECT 1 FROM notificacion WHERE tipo=? AND clave=?').bind(tipo, clave).first();
  if (ya) return;
  const dest = (await env.DB.prepare('SELECT chat_id FROM notif_destino').all()).results;
  let ok = false;
  for (const d of dest) ok = (await tgSend(env, d.chat_id, texto)) || ok;
  if (ok) await env.DB.prepare('INSERT OR IGNORE INTO notificacion(tipo,clave,enviado_en,mensaje) VALUES(?,?,?,?)').bind(tipo, clave, new Date().toISOString(), texto.slice(0, 500)).run();
}

// ---------- Indicadores ----------
async function indicadores(db, desde, hasta) {
  const p = await plan(db);
  let prog = 0;
  const dias = diffDays(hasta, desde) + 1;
  for (const a of p) if (a.frecuencia_dias) prog += Math.floor(dias / a.frecuencia_dias);
  const ejec = (await db.prepare("SELECT COUNT(*) c FROM ejecucion WHERE resultado='Cumple' AND fecha BETWEEN ? AND ? AND act_id IN (SELECT id FROM actividad WHERE frecuencia_dias IS NOT NULL)").bind(desde, hasta).first()).c;
  const fallas = (await db.prepare('SELECT COUNT(*) c FROM falla WHERE fecha BETWEEN ? AND ?').bind(desde, hasta).first()).c;
  const mttr = (await db.prepare("SELECT AVG(parada_h) v FROM ot WHERE estado='Cerrada' AND origen='Falla' AND fecha_cierre BETWEEN ? AND ? AND parada_h IS NOT NULL").bind(desde, hasta).first()).v;
  const hr = await db.prepare('SELECT SUM(CASE WHEN es_base=0 THEN horas_dia ELSE 0 END) imp, SUM(horas_encendida) enc FROM registro_horas WHERE fecha BETWEEN ? AND ?').bind(desde, hasta).first();
  const parada = (await db.prepare("SELECT SUM(parada_h) v FROM ot WHERE fecha_cierre BETWEEN ? AND ?").bind(desde, hasta).first()).v || 0;
  const costo = (await db.prepare('SELECT SUM(costo_cop) v FROM ot WHERE fecha_cierre BETWEEN ? AND ?').bind(desde, hasta).first()).v || 0;
  const rep = (await db.prepare('SELECT COUNT(*) c FROM repuesto WHERE existencia<=minimo AND minimo>0').first()).c;
  const imp = hr.imp || 0, enc = hr.enc || 0;
  return [
    { id: 'IND-01', nombre: 'Cumplimiento del preventivo', valor: prog ? ejec / prog : null, unidad: '%', nota: `${ejec} ejecutadas de ${prog} programadas (solo actividades por calendario)` },
    { id: 'IND-02', nombre: 'Número de fallas', valor: fallas, unidad: 'fallas' },
    { id: 'IND-03', nombre: 'MTTR', valor: mttr, unidad: 'h', nota: 'Promedio de tiempo de parada de OT por falla cerradas' },
    { id: 'IND-04', nombre: 'MTBF', valor: fallas ? imp / fallas : null, unidad: 'h', nota: 'Horas de impresión / fallas (necesita datos suficientes)' },
    { id: 'IND-05', nombre: 'Disponibilidad', valor: enc ? (enc - parada) / enc : null, unidad: '%', nota: 'Base: horas encendida' },
    { id: 'IND-06', nombre: 'Horas de utilización', valor: imp, unidad: 'h', nota: 'Tiempo de impresión (pantalla)' },
    { id: 'IND-07', nombre: 'Costos de mantenimiento', valor: costo, unidad: 'COP' },
    { id: 'IND-08', nombre: 'Repuestos por reponer', valor: rep, unidad: 'ítems' },
  ];
}

// ---------- Router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    try {
      if (path.startsWith('/qr/')) { // QR estable: se puede cambiar el destino sin reimprimir etiquetas
        const id = decodeURIComponent(path.slice(4)).toUpperCase();
        const r = await env.DB.prepare('SELECT url FROM recurso_qr WHERE id=?').bind(id).first();
        return r ? Response.redirect(r.url, 302) : new Response('QR no encontrado', { status: 404 });
      }
      if (path === '/tg/webhook' && m === 'POST') return await telegram(req, env);
      if (path === '/admin/telegram-setup') {
        if (!env.TELEGRAM_WEBHOOK_SECRET || url.searchParams.get('key') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('No autorizado', { status: 401 });
        const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.origin + '/tg/webhook', secret_token: env.TELEGRAM_WEBHOOK_SECRET }) });
        return new Response(await r.text(), { headers: { 'content-type': 'application/json' } });
      }
      if (path === '/api/login' && m === 'POST') return await login(req, env);
      if (path === '/api/usuarios-login' && m === 'GET') {
        const r = (await env.DB.prepare('SELECT nombre,rol,turno,(pin_hash IS NOT NULL) AS tiene_pin FROM usuario WHERE activo=1').all()).results;
        return J(r);
      }
      const u = await auth(req, env);
      if (!u) return J({ error: 'No autenticado' }, 401);
      if (path === '/api/logout') { const t = (req.headers.get('cookie') || '').match(/sid=([a-f0-9]+)/)?.[1]; if (t) await env.DB.prepare('DELETE FROM sesion WHERE token=?').bind(t).run(); return J({ ok: 1 }, 200, { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }
      return await api(req, env, u, path, m, url);
    } catch (e) { return J({ error: String(e.message || e) }, 500); }
  },
  async scheduled(ev, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await resumen(env.DB);
      if (r.venc.length || r.prox.length || r.fal.length || r.ots.length || r.rep.length) await avisar(env, 'diario', hoy(), textoResumen(r));
    })());
  },
};

async function login(req, env) {
  const b = await req.json();
  const u = await env.DB.prepare('SELECT * FROM usuario WHERE nombre=? AND activo=1').bind(b.nombre).first();
  if (!u) return J({ error: 'Usuario no válido' }, 400);
  if (!/^\d{4,8}$/.test(String(b.pin || ''))) return J({ error: 'El PIN debe tener de 4 a 8 dígitos' }, 400);
  if (!u.pin_hash) { // primer ingreso: crear PIN con el código de instalación
    if (!env.SETUP_CODE || b.codigo !== env.SETUP_CODE) return J({ error: 'Primer ingreso: escriba el código de instalación (SETUP_CODE)' }, 403);
    const salt = rnd(8);
    await env.DB.prepare('UPDATE usuario SET pin_hash=?,pin_salt=? WHERE id=?').bind(await hashPin(String(b.pin), salt), salt, u.id).run();
  } else if ((await hashPin(String(b.pin), u.pin_salt)) !== u.pin_hash) return J({ error: 'PIN incorrecto' }, 403);
  const t = rnd(24);
  await env.DB.prepare('INSERT INTO sesion VALUES(?,?,?)').bind(t, u.id, new Date(Date.now() + 12 * 3600e3).toISOString()).run();
  await env.DB.prepare('DELETE FROM sesion WHERE expira<?').bind(new Date().toISOString()).run();
  return J({ ok: 1, nombre: u.nombre }, 200, { 'set-cookie': `sid=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
}

async function telegram(req, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('no', { status: 401 });
  const up = await req.json();
  const msg = up.message; if (!msg || !msg.text) return new Response('ok');
  const chat = String(msg.chat.id), t = msg.text.trim().split(/\s+/)[0].toLowerCase();
  const nombre = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ');
  if (t === '/start') {
    await env.DB.prepare('INSERT OR REPLACE INTO notif_destino VALUES(?,?,?)').bind(chat, nombre, new Date().toISOString()).run();
    await tgSend(env, chat, '✅ Registrado: recibirá los avisos de EQ-001 (Centauri Carbon 2 Combo).\nComandos: /estado, /baja');
  } else if (t === '/estado') await tgSend(env, chat, textoResumen(await resumen(env.DB)));
  else if (t === '/baja') { await env.DB.prepare('DELETE FROM notif_destino WHERE chat_id=?').bind(chat).run(); await tgSend(env, chat, 'Listo: no recibirá más avisos.'); }
  return new Response('ok');
}

async function api(req, env, u, path, m, url) {
  const db = env.DB, body = m === 'GET' ? {} : await req.json().catch(() => ({}));
  const esResp = /Responsable|Aprobador/.test(u.rol || '');
  // ----- Estado
  if (path === '/api/estado') {
    const eq = await db.prepare("SELECT * FROM equipo WHERE id='EQ-001'").first();
    return J({ usuario: u, equipo: eq, lectura: await ultimaLectura(db), resumen: await resumen(db), hoy: hoy(), plan: await plan(db) });
  }
  // ----- Horas (FOR-002)
  if (path === '/api/horas' && m === 'GET') return J((await db.prepare('SELECT r.*,u.nombre AS operador FROM registro_horas r LEFT JOIN usuario u ON u.id=r.usuario_id ORDER BY fecha DESC,r.id DESC LIMIT 200').all()).results);
  if (path === '/api/horas' && m === 'POST') {
    const h = num(body.lectura_h), mi = num(body.lectura_min), f = body.fecha || hoy();
    if (h == null || mi == null || h < 0 || mi < 0 || mi > 59) return J({ error: 'Lectura inválida (minutos 0-59)' }, 400);
    const ant = await ultimaLectura(db), hor = h + mi / 60, alertas = [];
    let dia = null;
    if (ant) { dia = hor - ant.horometro; if (dia < 0) return J({ error: `La lectura (${hor.toFixed(2)} h) es menor que la anterior (${ant.horometro.toFixed(2)} h). ¿Se reinició el contador? Avise al responsable.` }, 400); if (dia > 24) alertas.push('Más de 24 h en un día'); }
    let enc = null;
    if (body.encendido && body.apagado) { const [a, b] = [body.encendido, body.apagado].map((x) => { const [hh, mm] = x.split(':').map(Number); return hh * 60 + mm; }); if (b < a) return J({ error: 'La hora de apagado es anterior a la de encendido' }, 400); enc = (b - a) / 60; if (dia != null && dia > enc + 0.02) alertas.push('Horas de impresión mayores al tiempo encendida'); }
    await db.prepare('INSERT INTO registro_horas(fecha,lectura_h,lectura_min,horometro,anterior,horas_dia,encendido,apagado,horas_encendida,turno,usuario_id,obs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(f, h, mi, hor, ant ? ant.horometro : null, dia, body.encendido || null, body.apagado || null, enc, body.turno || u.turno, u.id, str(body.obs)).run();
    return J({ ok: 1, horas_dia: dia, alertas });
  }
  // ----- Inspección diaria (FOR-001)
  if (path === '/api/inspeccion' && m === 'GET') return J((await db.prepare('SELECT i.*,u.nombre AS operador FROM inspeccion i LEFT JOIN usuario u ON u.id=i.usuario_id ORDER BY fecha DESC,i.id DESC LIMIT 100').all()).results);
  if (path === '/api/inspeccion' && m === 'POST') {
    const v = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (['Cumple', 'No cumple'].includes(body['p' + i]) ? body['p' + i] : null));
    if (v.includes(null)) return J({ error: 'Responda los 8 puntos' }, 400);
    const apto = v.includes('No cumple') ? 'NO OPERAR' : 'Apto';
    await db.prepare('INSERT INTO inspeccion(fecha,usuario_id,turno,p1,p2,p3,p4,p5,p6,p7,p8,apto,obs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(body.fecha || hoy(), u.id, u.turno, ...v, apto, str(body.obs)).run();
    if (apto === 'NO OPERAR') await avisar(env, 'insp-no', hoy() + '-' + rnd(3), `🚫 EQ-001: inspección con punto "No cumple" (${u.nombre}). NO operar y revisar FOR-004.`);
    return J({ ok: 1, apto });
  }
  // ----- Actividades / ejecuciones (FOR-003)
  if (path === '/api/plan') return J(await plan(db));
  if (path === '/api/ejecuciones' && m === 'GET') return J((await db.prepare('SELECT e.*,a.nombre AS actividad,u.nombre AS operador FROM ejecucion e LEFT JOIN actividad a ON a.id=e.act_id LEFT JOIN usuario u ON u.id=e.usuario_id ORDER BY fecha DESC,e.id DESC LIMIT 200').all()).results);
  if (path === '/api/ejecuciones' && m === 'POST') {
    const a = await db.prepare('SELECT * FROM actividad WHERE id=?').bind(body.act_id).first();
    if (!a) return J({ error: 'Actividad no existe' }, 400);
    if (!['Cumple', 'No cumple', 'N/A'].includes(body.resultado)) return J({ error: 'Resultado inválido' }, 400);
    const l = await ultimaLectura(db), id = await nextId(db, 'REG', 'ejecucion');
    await db.prepare('INSERT INTO ejecucion VALUES(?,?,?,?,?,?,?,?,?)').bind(id, a.id, body.fecha || hoy(), u.id, l ? l.horometro : null, body.resultado, str(body.evidencia), str(body.obs), esResp ? u.nombre : null).run();
    return J({ ok: 1, id });
  }
  // ----- Fallas (FOR-004)
  if (path === '/api/fallas' && m === 'GET') return J((await db.prepare('SELECT f.*,u.nombre AS reporto FROM falla f LEFT JOIN usuario u ON u.id=f.usuario_id ORDER BY fecha DESC,f.id DESC LIMIT 200').all()).results);
  if (path === '/api/fallas' && m === 'POST') {
    if (!body.descripcion) return J({ error: 'Describa lo observado' }, 400);
    const l = await ultimaLectura(db), id = await nextId(db, 'NOV', 'falla');
    await db.prepare('INSERT INTO falla(id,fecha,usuario_id,fal_codigo,codigo_error,filamento,horas_acum,descripcion,accion,detenido,foto) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id, body.fecha || hoy(), u.id, str(body.fal_codigo, 20), str(body.codigo_error, 20), str(body.filamento, 80), l ? l.horometro : null, str(body.descripcion), str(body.accion), body.detenido || 'Sí', str(body.foto)).run();
    await avisar(env, 'falla', id, `⚠️ ${id} · EQ-001 · ${u.nombre}\n${str(body.descripcion, 300)}${body.codigo_error ? '\nCódigo de error: ' + body.codigo_error : ''}\nEquipo detenido: ${body.detenido || 'Sí'}`);
    return J({ ok: 1, id });
  }
  if (path.startsWith('/api/fallas/') && m === 'PATCH') { if (!esResp) return J({ error: 'Solo responsables' }, 403); await db.prepare('UPDATE falla SET estado=? WHERE id=?').bind(body.estado, path.split('/')[3]).run(); return J({ ok: 1 }); }
  // ----- Órdenes de trabajo (FOR-005)
  if (path === '/api/ot' && m === 'GET') return J((await db.prepare('SELECT * FROM ot ORDER BY id DESC LIMIT 200').all()).results);
  if (path === '/api/ot' && m === 'POST') {
    if (!esResp) return J({ error: 'Solo responsables abren OT' }, 403);
    if (!body.trabajo) return J({ error: 'Indique el trabajo a realizar' }, 400);
    const l = await ultimaLectura(db), id = await nextId(db, 'OT', 'ot');
    await db.prepare('INSERT INTO ot(id,fecha_apertura,prioridad,origen,act_id,falla_id,asignado_a,trabajo,repuestos,horas_inicio) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, hoy(), body.prioridad || 'Media', body.origen || 'Preventivo', body.act_id || null, body.falla_id || null, str(body.asignado_a, 80), str(body.trabajo), str(body.repuestos), l ? l.horometro : null).run();
    if (body.falla_id) await db.prepare("UPDATE falla SET ot_id=?,estado='En OT' WHERE id=?").bind(id, body.falla_id).run();
    await avisar(env, 'ot', id, `📋 ${id} abierta (${body.prioridad || 'Media'}): ${str(body.trabajo, 200)}`);
    return J({ ok: 1, id });
  }
  if (path.startsWith('/api/ot/') && m === 'PATCH') {
    if (!esResp) return J({ error: 'Solo responsables' }, 403);
    const id = path.split('/')[3];
    if (body.cerrar) {
      await db.prepare("UPDATE ot SET estado='Cerrada',fecha_cierre=?,parada_h=?,costo_cop=?,resultado=?,cerrado_por=?,verificado_por=? WHERE id=?").bind(hoy(), num(body.parada_h), num(body.costo_cop), str(body.resultado), u.nombre, str(body.verificado_por, 80), id).run();
      await db.prepare("UPDATE falla SET estado='Cerrada' WHERE ot_id=?").bind(id).run();
    } else await db.prepare('UPDATE ot SET estado=? WHERE id=?').bind(body.estado, id).run();
    return J({ ok: 1 });
  }
  // ----- Repuestos (FOR-006)
  if (path === '/api/repuestos' && m === 'GET') return J((await db.prepare('SELECT * FROM repuesto ORDER BY id').all()).results);
  if (path === '/api/repuestos' && m === 'POST') {
    if (!esResp) return J({ error: 'Solo responsables' }, 403);
    const id = await nextId(db, 'REP', 'repuesto');
    await db.prepare('INSERT INTO repuesto VALUES(?,?,?,?,?,?)').bind(id, str(body.descripcion, 200), str(body.compat, 200), num(body.existencia) || 0, num(body.minimo) || 0, str(body.nota)).run();
    return J({ ok: 1, id });
  }
  if (path.startsWith('/api/repuestos/') && m === 'PATCH') {
    if (!esResp) return J({ error: 'Solo responsables' }, 403);
    await db.prepare('UPDATE repuesto SET existencia=?,minimo=? WHERE id=?').bind(num(body.existencia) || 0, num(body.minimo) || 0, path.split('/')[3]).run();
    const r = await db.prepare('SELECT * FROM repuesto WHERE id=?').bind(path.split('/')[3]).first();
    if (r && r.minimo > 0 && r.existencia <= r.minimo) await avisar(env, 'repuesto', r.id + '-' + r.existencia, `📦 Reponer ${r.id} ${r.descripcion}: quedan ${r.existencia} (mínimo ${r.minimo}).`);
    return J({ ok: 1 });
  }
  // ----- Indicadores, historial, QR
  if (path === '/api/indicadores') { const h = hoy(); return J(await indicadores(db, url.searchParams.get('desde') || addDays(h, -30), url.searchParams.get('hasta') || h)); }
  if (path === '/api/historial') {
    const e = (await db.prepare("SELECT fecha,'Preventivo/Insp.' tipo,act_id ref,resultado det FROM ejecucion").all()).results;
    const o = (await db.prepare("SELECT COALESCE(fecha_cierre,fecha_apertura) fecha,'OT' tipo,id ref,estado||': '||trabajo det FROM ot").all()).results;
    const f = (await db.prepare("SELECT fecha,'Falla' tipo,id ref,descripcion det FROM falla").all()).results;
    return J([...e, ...o, ...f].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 300));
  }
  if (path === '/api/qr' && m === 'GET') return J((await db.prepare('SELECT * FROM recurso_qr ORDER BY id').all()).results);
  if (path.startsWith('/api/qr/') && m === 'PATCH') {
    if (!esResp) return J({ error: 'Solo responsables' }, 403);
    if (!/^https:\/\//.test(body.url || '')) return J({ error: 'URL https requerida' }, 400);
    await db.prepare('UPDATE recurso_qr SET url=?,verificado_en=? WHERE id=?').bind(body.url, hoy(), path.split('/')[3]).run();
    return J({ ok: 1 });
  }
  return J({ error: 'Ruta no encontrada' }, 404);
}
