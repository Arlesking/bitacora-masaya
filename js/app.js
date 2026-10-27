import { sb } from "./sb.js";

// ===== Utilidades =====
const ORDEN = ["operador", "jefe_servicio", "lider", "admin"];
const ROL = { operador: "Operador", jefe_servicio: "Jefe de servicio", lider: "Líder", admin: "Administrador" };
const URG = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" };
const EST_N = { abierta: "Abierta", seguimiento: "En seguimiento", cerrada: "Cerrada", anulada: "Anulada" };
const EST_T = { pendiente: "Pendiente", en_curso: "En curso", hecha: "Hecha", cancelada: "Cancelada" };
const TABLA = { perfiles: "persona", novedades: "novedad", tareas: "tarea", comentarios: "comentario", membresias: "acceso", areas: "área", turnos: "turno", tipos_novedad: "tipo de novedad", hoteles: "hotel" };
const ACCION = { INSERT: "creó", UPDATE: "cambió", DELETE: "eliminó" };

const app = document.getElementById("app");
const MIN_INACTIVIDAD = 10;
function leer(k) { try { return localStorage.getItem(k); } catch { return null; } }
function guardar(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nivel = (rol) => ORDEN.indexOf(rol);
const alMenos = (min) => nivel(S.rol) >= nivel(min);

function aviso(msg, error = false) {
  const el = document.getElementById("aviso");
  el.textContent = msg;
  el.className = "aviso" + (error ? " error" : "");
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.hidden = true), error ? 6000 : 3000);
}

// Lanza un error legible si la consulta falla
async function q(promesa) {
  const { data, error, count } = await promesa;
  if (error) {
    console.error(error);
    const m = error.message || "";
    if (/row-level security|permission denied/i.test(m)) throw new Error("No tienes permiso para hacer esto.");
    if (/Failed to fetch|NetworkError/i.test(m)) throw new Error("Sin conexión. Revisa el internet e intenta de nuevo.");
    throw new Error(m || "Algo salió mal.");
  }
  return count !== undefined && count !== null ? { data, count } : data;
}

const fmtFecha = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function fecha(ts) {
  if (!ts) return "";
  const d = new Date(ts), min = Math.round((Date.now() - d) / 60000);
  if (min >= 0 && min < 1) return "ahora";
  if (min >= 0 && min < 60) return `hace ${min} min`;
  return fmtFecha.format(d);
}
function aLocalInput(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function pinAleatorio() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}

function dialogo(html, alAbrir) {
  const d = document.createElement("dialog");
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener("close", () => d.remove());
  d.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => d.close()));
  d.showModal();
  alAbrir?.(d);
  return d;
}

function confirmar(texto, { boton = "Confirmar", peligro = false, pedir = null } = {}) {
  return new Promise((res) => {
    const d = dialogo(`<form method="dialog">
      <p>${esc(texto)}</p>
      ${pedir ? `<label for="dlg-txt">${esc(pedir)}</label><textarea id="dlg-txt" required></textarea>` : ""}
      <div class="acciones"><button class="btn ${peligro ? "peligro" : ""}" value="si">${esc(boton)}</button>
      <button class="btn sec" type="button" data-cerrar>Volver</button></div></form>`);
    d.querySelector("form").addEventListener("submit", (e) => {
      const t = d.querySelector("#dlg-txt");
      if (t && !t.value.trim()) { e.preventDefault(); t.focus(); return; }
      res(pedir ? t.value.trim() : true);
    });
    d.addEventListener("close", () => res(false));
  });
}

// Ejecuta una acción de un botón mostrando errores
function alClic(sel, fn, raiz = app) {
  raiz.querySelectorAll(sel).forEach((el) =>
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      el.disabled = true;
      try { await fn(el, e); } catch (err) { aviso(err.message, true); } finally { el.disabled = false; }
    }));
}
function alEnviar(form, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = form.querySelector("button[type=submit], button:not([type])");
    if (b) b.disabled = true;
    try { await fn(new FormData(form)); } catch (err) { aviso(err.message, true); } finally { if (b) b.disabled = false; }
  });
}

// ===== Estado =====
const S = {
  user: null, perfil: null, membresias: [], hotel: null, rol: null, area: null,
  areas: [], tipos: [], personas: [], turnos: [], grupo: [],
};
const nombreDe = (id) => S.personas.find((p) => p.id === id)?.nombre ?? "—";
const areaDe = (id) => S.areas.find((a) => a.id === id)?.nombre ?? "—";
const hotelDe = (id) => S.grupo.find((h) => h.id === id)?.nombre ?? S.membresias.find((m) => m.hotel_id === id)?.hotel?.nombre ?? "otro hotel";

async function cargarUsuario() {
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user ?? null;
  if (!S.user) return false;
  S.perfil = await q(sb.from("perfiles").select("*").eq("id", S.user.id).single());
  if (S.perfil.es_admin_global) {
    const hoteles = await q(sb.from("hoteles").select("id, nombre, grupo_id, es_prueba").eq("activo", true).order("nombre"));
    const propias = await q(sb.from("membresias").select("*").eq("perfil_id", S.user.id).eq("activa", true));
    S.membresias = hoteles.map((h) => ({ ...(propias.find((m) => m.hotel_id === h.id) ?? {}), hotel_id: h.id, rol: "admin", hotel: h }));
  } else {
    S.membresias = await q(sb.from("membresias").select("*, hotel:hoteles(id, nombre, grupo_id, es_prueba)")
      .eq("perfil_id", S.user.id).eq("activa", true));
    S.membresias = S.membresias.filter((m) => m.hotel);
  }
  return true;
}

async function entrarAlHotel(id) {
  const m = S.membresias.find((x) => x.hotel_id === id);
  if (!m) return false;
  S.hotel = m.hotel; S.rol = m.rol; S.area = m.area_id ?? null;
  try { localStorage.setItem("hotel", id); } catch { /* sin almacenamiento */ }
  const [areas, tipos, personas, grupo] = await Promise.all([
    q(sb.from("areas").select("*").eq("hotel_id", id).order("nombre")),
    q(sb.from("tipos_novedad").select("*").eq("hotel_id", id).order("nombre")),
    q(sb.from("membresias").select("id, rol, area_id, activa, perfil:perfiles(id, nombre, correo)").eq("hotel_id", id)),
    q(sb.rpc("hoteles_del_grupo", { p_hotel: id })),
  ]);
  S.areas = areas; S.tipos = tipos; S.grupo = grupo ?? [];
  S.personas = personas.filter((p) => p.perfil).map((p) => ({ ...p.perfil, rol: p.rol, area_id: p.area_id, activa: p.activa, membresia: p.id }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  S.turnos = areas.length ? await q(sb.from("turnos").select("*").in("area_id", areas.map((a) => a.id)).order("hora_inicio")) : [];
  pintarBarra();
  return true;
}

// Lo que se ve en este hotel: lo propio y lo compartido por hoteles del grupo.
// La base de datos ya oculta lo que no te corresponde; quien trabaja en dos hoteles
// vería también lo privado del otro, por eso se filtra otra vez con soloVisibles().
function visibles(consulta) {
  const ids = [...new Set([S.hotel.id, ...S.grupo.map((h) => h.id)])];
  return ids.length > 1 ? consulta.in("hotel_id", ids) : consulta.eq("hotel_id", S.hotel.id);
}
const soloVisibles = (filas) => filas.filter((r) => r.hotel_id === S.hotel.id || r.compartida_grupo);

function turnoActual(areaId) {
  const ahora = new Date().toTimeString().slice(0, 5);
  const dentro = (t) => t.hora_inicio.slice(0, 5) <= t.hora_fin.slice(0, 5)
    ? ahora >= t.hora_inicio.slice(0, 5) && ahora < t.hora_fin.slice(0, 5)
    : ahora >= t.hora_inicio.slice(0, 5) || ahora < t.hora_fin.slice(0, 5);
  return S.turnos.find((t) => t.activo && t.area_id === areaId && dentro(t)) ?? null;
}

function pintarBarra() {
  document.getElementById("barra").hidden = false;
  document.getElementById("menu").hidden = false;
  document.getElementById("hotel-nombre").textContent = S.hotel.nombre + (S.hotel.es_prueba ? " (pruebas)" : "");
  document.getElementById("hotel-rol").textContent = `${S.perfil.nombre} · ${ROL[S.rol]}${S.area ? " · " + areaDe(S.area) : ""}`;
  document.querySelectorAll("#menu [data-min]").forEach((a) => (a.hidden = !alMenos(a.dataset.min)));
}
function ocultarBarra() {
  document.getElementById("barra").hidden = true;
  document.getElementById("menu").hidden = true;
}

// ===== Rutas =====
const RUTAS = {
  entrar: vEntrar, hotel: vElegirHotel, inicio: vInicio, novedades: vNovedades, novedad: vNovedad,
  "nueva-novedad": vNuevaNovedad, tareas: vTareas, tarea: vTarea, "nueva-tarea": vNuevaTarea,
  admin: vAdmin, log: vLog,
};

function ir(ruta) { location.hash = "#/" + ruta; }

async function enrutar() {
  const [camino, consulta] = location.hash.replace(/^#\/?/, "").split("?");
  const [nombre, ...args] = camino.split("/");
  const params = new URLSearchParams(consulta ?? "");
  const vista = RUTAS[nombre];

  if (!S.user && nombre !== "entrar") return ir("entrar");
  if (S.user && !S.hotel && !["entrar", "hotel"].includes(nombre)) return ir("hotel");
  if (!vista) return ir(S.user ? "inicio" : "entrar");

  document.querySelectorAll("#menu a").forEach((a) => a.classList.toggle("activo",
    a.dataset.ruta === nombre || (a.dataset.ruta === "novedades" && ["novedad", "nueva-novedad"].includes(nombre))
    || (a.dataset.ruta === "tareas" && ["tarea", "nueva-tarea"].includes(nombre))));
  app.innerHTML = `<p class="cargando">Cargando…</p>`;
  try {
    await vista(args, params);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<p class="vacio">${esc(err.message)}</p><div class="acciones"><a class="btn sec" href="#/inicio">Volver al inicio</a></div>`;
  }
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ===== Entrada =====
async function vEntrar() {
  ocultarBarra();
  if (S.user) return ir("inicio");
  app.innerHTML = `<div class="entrada">
    <div class="logo"><svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/></svg>Bitácora Masaya</div>
    <form id="f-entrar" novalidate>
      <label for="correo">Correo</label>
      <input id="correo" name="correo" type="email" autocomplete="username" required>
      <label for="pin">PIN <span class="ayuda">(6 dígitos)</span></label>
      <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" class="pin" required>
      <label class="check"><input type="checkbox" id="ver-pin"> Mostrar el PIN mientras lo escribo</label>
      <label class="check"><input type="checkbox" name="recordar" ${leer("correo") ? "checked" : ""}> Recordar mi correo en este dispositivo</label>
      <p class="ayuda">Por seguridad, la sesión se cierra sola tras ${MIN_INACTIVIDAD} minutos sin uso.</p>
      <button class="btn ancho" type="submit">Entrar</button>
      <p class="error-txt" id="err" hidden></p>
    </form>
    <p class="ayuda" style="margin-top:20px">¿Olvidaste tu PIN? Pídele a tu líder que te asigne uno nuevo.</p>
  </div>`;
  const f = document.getElementById("f-entrar");
  f.correo.value = leer("correo") ?? "";
  f.querySelector("#ver-pin").addEventListener("change", (e) => (f.pin.type = e.target.checked ? "text" : "password"));
  (f.correo.value ? f.pin : f.correo).focus();
  alEnviar(f, async (d) => {
    const err = document.getElementById("err");
    err.hidden = true;
    const correo = String(d.get("correo")).trim().toLowerCase(), pin = String(d.get("pin")).trim();
    if (!correo || !/^\d{6}$/.test(pin)) { err.textContent = "Escribe tu correo y un PIN de 6 dígitos."; err.hidden = false; return; }
    guardar("correo", d.get("recordar") === "on" ? correo : null);
    const { error } = await sb.auth.signInWithPassword({ email: correo, password: pin });
    if (error) {
      err.textContent = /invalid/i.test(error.message) ? "Correo o PIN incorrecto." : "No se pudo entrar: " + error.message;
      err.hidden = false;
      return;
    }
    await arrancar();
  });
}

async function vElegirHotel() {
  if (!S.membresias.length) {
    ocultarBarra();
    app.innerHTML = `<div class="entrada"><h1>Sin hoteles asignados</h1>
      <p>Tu usuario existe, pero todavía no tiene acceso a ningún hotel. Pídele a tu líder que te agregue.</p>
      <button class="btn sec" id="salir">Salir</button></div>`;
    alClic("#salir", salir);
    return;
  }
  if (S.membresias.length === 1) { await entrarAlHotel(S.membresias[0].hotel_id); return ir("inicio"); }
  ocultarBarra();
  app.innerHTML = `<div class="entrada"><h1>¿A qué hotel entras?</h1>
    ${S.membresias.map((m) => `<button class="tarjeta" style="width:100%;text-align:left;cursor:pointer" data-h="${m.hotel_id}">
      <div class="titulo">${esc(m.hotel.nombre)}${m.hotel.es_prueba ? " (pruebas)" : ""}</div>
      <div class="meta">${ROL[m.rol]}</div></button>`).join("")}
    <div class="acciones"><button class="btn sec" id="salir">Salir</button></div></div>`;
  alClic("[data-h]", async (b) => { await entrarAlHotel(b.dataset.h); ir("inicio"); });
  alClic("#salir", salir);
}

async function salir() {
  guardar("actividad", null);
  await sb.auth.signOut();
  Object.assign(S, { user: null, perfil: null, membresias: [], hotel: null, rol: null });
  ir("entrar");
}

// ===== Tarjetas =====
const SEL_NOV = "*, tipo:tipos_novedad(nombre, color), autor:perfiles!novedades_autor_id_fkey(nombre), para_perfil:perfiles!novedades_para_perfil_id_fkey(nombre)";
const SEL_TAR = "*, asignado:perfiles!tareas_asignada_a_fkey(nombre), creador:perfiles!tareas_creado_por_fkey(nombre)";

function paraTexto(n) {
  if (n.para_perfil_id) return "Para " + (n.para_perfil?.nombre ?? nombreDe(n.para_perfil_id));
  if (n.para_area_id) return "Para " + areaDe(n.para_area_id);
  return "Todo el hotel";
}

function tarjetaNovedad(n, noLeida = false) {
  const color = n.tipo?.color ?? "#6b7280";
  return `<a class="tarjeta borde-tipo ${noLeida ? "no-leida" : ""} ${n.estado === "anulada" ? "anulada" : ""}" style="--tipo:${esc(color)}" href="#/novedad/${n.id}">
    <div class="fila entre"><span class="fila">${noLeida ? `<span class="punto" title="Sin leer"></span>` : ""}
      <span class="chip tipo">${esc(n.tipo?.nombre ?? "Novedad")}</span>
      <span class="chip u-${n.urgencia}">${URG[n.urgencia]}</span>
      ${n.hotel_id !== S.hotel.id ? `<span class="chip grupo">${esc(hotelDe(n.hotel_id))}</span>` : n.compartida_grupo ? `<span class="chip grupo">Compartida</span>` : ""}</span>
      <span class="chip estado">${EST_N[n.estado]}</span></div>
    <p class="desc">${esc(n.descripcion.length > 220 ? n.descripcion.slice(0, 220) + "…" : n.descripcion)}</p>
    <div class="meta">${esc(n.autor?.nombre ?? "Alguien")} · ${fecha(n.creado_en)} · ${esc(paraTexto(n))}${n.lugar ? " · " + esc(n.lugar) : ""}</div>
  </a>`;
}

function vencida(t) {
  return t.fecha_limite && !["hecha", "cancelada"].includes(t.estado) && new Date(t.fecha_limite) < new Date();
}
function asignadoTexto(t) {
  if (t.asignada_a) return t.asignado?.nombre ?? nombreDe(t.asignada_a);
  if (t.siguiente_turno) return "Siguiente turno" + (t.area_id ? " · " + areaDe(t.area_id) : "");
  if (t.area_id) return "Bandeja de " + areaDe(t.area_id);
  return "Sin asignar";
}
function tarjetaTarea(t) {
  return `<a class="tarjeta" href="#/tarea/${t.id}">
    <div class="fila entre"><span class="titulo">${esc(t.titulo)}</span><span class="chip estado">${EST_T[t.estado]}</span></div>
    <div class="fila" style="margin-top:6px"><span class="chip u-${t.urgencia}">${URG[t.urgencia]}</span>
      ${vencida(t) ? `<span class="chip vencida">Vencida</span>` : ""}
      ${t.hotel_id !== S.hotel.id ? `<span class="chip grupo">${esc(hotelDe(t.hotel_id))}</span>` : ""}
      <span class="meta">${esc(asignadoTexto(t))}${t.fecha_limite ? " · vence " + fecha(t.fecha_limite) : ""}</span></div>
  </a>`;
}

// ===== Mi turno =====
async function vInicio() {
  const desde = new Date(Date.now() - 3 * 864e5).toISOString();
  let [novs, leidas, mias, bandeja] = await Promise.all([
    q(visibles(sb.from("novedades").select(SEL_NOV)).gte("creado_en", desde).neq("estado", "anulada")
      .neq("autor_id", S.user.id).order("creado_en", { ascending: false }).limit(100)),
    q(sb.from("novedad_lecturas").select("novedad_id").eq("perfil_id", S.user.id).gte("leido_en", desde)),
    q(visibles(sb.from("tareas").select(SEL_TAR)).eq("asignada_a", S.user.id).in("estado", ["pendiente", "en_curso"]).order("fecha_limite", { nullsFirst: false })),
    S.area || alMenos("lider")
      ? q((S.area ? sb.from("tareas").select(SEL_TAR).eq("area_id", S.area) : sb.from("tareas").select(SEL_TAR).eq("hotel_id", S.hotel.id))
        .is("asignada_a", null).eq("estado", "pendiente").order("creado_en", { ascending: false }).limit(50))
      : Promise.resolve([]),
  ]);
  const leidasSet = new Set(leidas.map((l) => l.novedad_id));
  const sinLeer = soloVisibles(novs).filter((n) => !leidasSet.has(n.id));
  const urgentes = alMenos("jefe_servicio")
    ? soloVisibles(await q(visibles(sb.from("novedades").select(SEL_NOV)).in("estado", ["abierta", "seguimiento"]).in("urgencia", ["alta", "critica"])
      .order("creado_en", { ascending: false }).limit(20)))
    : [];
  const turno = S.area ? turnoActual(S.area) : null;
  mias = soloVisibles(mias);

  app.innerHTML = `<h1>Hola, ${esc(S.perfil.nombre.split(" ")[0])}</h1>
    ${turno ? `<p class="meta">Turno actual: <strong>${esc(turno.nombre)}</strong></p>` : ""}
    <div class="fila entre"><h2>Entrega de turno: sin leer (${sinLeer.length})</h2>
      ${sinLeer.length ? `<button class="btn sec chico" id="leer-todo">Marcar todo como leído</button>` : ""}</div>
    ${sinLeer.length ? sinLeer.map((n) => tarjetaNovedad(n, true)).join("") : `<p class="vacio">Estás al día. No hay novedades nuevas de los últimos 3 días.</p>`}
    ${urgentes.length ? `<h2>Urgentes abiertas</h2>${urgentes.map((n) => tarjetaNovedad(n)).join("")}` : ""}
    <h2>Mis tareas (${mias.length})</h2>
    ${mias.length ? mias.map(tarjetaTarea).join("") : `<p class="vacio">No tienes tareas pendientes.</p>`}
    ${S.area || alMenos("lider") ? `<h2>${S.area ? "Bandeja de " + esc(areaDe(S.area)) : "Tareas sin asignar"} (${bandeja.length})</h2>
      ${bandeja.length ? bandeja.map(tarjetaTarea).join("") : `<p class="vacio">No hay tareas esperando.</p>`}` : ""}
    <a class="btn flotante" href="#/nueva-novedad">+ Novedad</a>`;

  alClic("#leer-todo", async () => {
    await q(sb.from("novedad_lecturas").upsert(sinLeer.map((n) => ({ novedad_id: n.id, perfil_id: S.user.id })), { onConflict: "novedad_id,perfil_id", ignoreDuplicates: true }));
    aviso("Listo, todo leído.");
    vInicio();
  });
}

// ===== Novedades =====
async function vNovedades(_, params) {
  const f = {
    estado: params.get("estado") ?? "activas", tipo: params.get("tipo") ?? "", urgencia: params.get("urgencia") ?? "",
    area: params.get("area") ?? "", texto: params.get("texto") ?? "", n: Number(params.get("n") ?? 50),
  };
  let c = visibles(sb.from("novedades").select(SEL_NOV, { count: "exact" })).order("creado_en", { ascending: false }).limit(f.n);
  if (f.estado === "activas") c = c.in("estado", ["abierta", "seguimiento"]);
  else if (f.estado !== "todas") c = c.eq("estado", f.estado);
  if (f.tipo) c = c.eq("tipo_id", f.tipo);
  if (f.urgencia) c = c.eq("urgencia", f.urgencia);
  if (f.area) c = c.eq("para_area_id", f.area);
  if (f.texto) { const t = f.texto.replace(/[%,()*]/g, " ").trim(); c = c.or(`descripcion.ilike.*${t}*,lugar.ilike.*${t}*`); }
  const { data: todas, count } = await q(c);
  const novs = soloVisibles(todas);
  const opt = (v, txt, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(txt)}</option>`;

  app.innerHTML = `<h1>Novedades</h1>
    <form class="filtros" id="filtros">
      <select name="estado" aria-label="Estado">${opt("activas", "Abiertas y en seguimiento", f.estado)}${opt("todas", "Todas", f.estado)}
        ${Object.entries(EST_N).map(([k, v]) => opt(k, v, f.estado)).join("")}</select>
      <select name="tipo" aria-label="Tipo">${opt("", "Todos los tipos", f.tipo)}${S.tipos.map((t) => opt(t.id, t.nombre, f.tipo)).join("")}</select>
      <select name="urgencia" aria-label="Urgencia">${opt("", "Toda urgencia", f.urgencia)}${Object.entries(URG).map(([k, v]) => opt(k, v, f.urgencia)).join("")}</select>
      <select name="area" aria-label="Área">${opt("", "Todas las áreas", f.area)}${S.areas.map((a) => opt(a.id, a.nombre, f.area)).join("")}</select>
      <input class="todo" type="search" name="texto" placeholder="Buscar en descripción o lugar" value="${esc(f.texto)}">
    </form>
    ${novs.length ? novs.map((n) => tarjetaNovedad(n)).join("") : `<p class="vacio">No hay novedades con estos filtros.</p>`}
    ${count > todas.length ? `<div class="acciones"><button class="btn sec ancho" id="mas">Ver más (${count - todas.length})</button></div>` : ""}
    <a class="btn flotante" href="#/nueva-novedad">+ Novedad</a>`;

  const form = document.getElementById("filtros");
  const aplicar = (extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    ir("novedades?" + p);
  };
  form.querySelectorAll("select").forEach((s) => s.addEventListener("change", () => aplicar()));
  form.addEventListener("submit", (e) => { e.preventDefault(); aplicar(); });
  alClic("#mas", () => aplicar({ n: f.n + 50 }));
}

async function vNuevaNovedad() {
  const activos = S.tipos.filter((t) => t.activo);
  const enGrupo = S.grupo.length > 1;
  app.innerHTML = `<h1>Nueva novedad</h1>
    <form id="f-nov">
      <label for="tipo">Tipo</label>
      <select id="tipo" name="tipo" required>${activos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join("")}</select>
      <label>Urgencia</label>
      <div class="opciones" role="radiogroup">${Object.entries(URG).map(([k, v]) => `<label><input type="radio" name="urgencia" value="${k}"><span>${v}</span></label>`).join("")}</div>
      <label>¿Para quién?</label>
      <div class="opciones">
        <label><input type="radio" name="para" value="hotel" checked><span>Todo el hotel</span></label>
        <label><input type="radio" name="para" value="area"><span>Un área</span></label>
        <label><input type="radio" name="para" value="persona"><span>Una persona</span></label>
      </div>
      <div id="para-area" hidden><label for="area">Área</label>
        <select id="area" name="area">${S.areas.filter((a) => a.activa).map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("")}</select></div>
      <div id="para-persona" hidden><label for="persona">Persona</label>
        <select id="persona" name="persona">${S.personas.filter((p) => p.activa).map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.area_id ? " · " + esc(areaDe(p.area_id)) : ""}</option>`).join("")}</select></div>
      <label for="lugar">Habitación o lugar <span class="ayuda">(opcional)</span></label>
      <input id="lugar" name="lugar" type="text" maxlength="80">
      <label for="descripcion">¿Qué pasó?</label>
      <textarea id="descripcion" name="descripcion" required maxlength="4000"></textarea>
      ${enGrupo ? `<label class="check"><input type="checkbox" name="grupo"> Compartir con ${esc(S.grupo.filter((h) => h.id !== S.hotel.id).map((h) => h.nombre).join(", "))}</label>` : ""}
      <div class="acciones"><button class="btn" type="submit">Guardar novedad</button><a class="btn sec" href="#/inicio">Cancelar</a></div>
    </form>`;
  const f = document.getElementById("f-nov");
  const ponerUrgencia = () => {
    const t = activos.find((x) => x.id === f.tipo.value);
    const r = f.querySelector(`input[name=urgencia][value=${t?.urgencia_defecto ?? "media"}]`);
    if (r) r.checked = true;
  };
  f.tipo.addEventListener("change", ponerUrgencia);
  ponerUrgencia();
  f.querySelectorAll("input[name=para]").forEach((r) => r.addEventListener("change", () => {
    document.getElementById("para-area").hidden = f.para.value !== "area";
    document.getElementById("para-persona").hidden = f.para.value !== "persona";
  }));
  f.descripcion.focus();
  alEnviar(f, async (d) => {
    const desc = String(d.get("descripcion")).trim();
    if (!desc) throw new Error("Escribe qué pasó.");
    const para = d.get("para");
    const turno = turnoActual(S.area ?? (para === "area" ? d.get("area") : null));
    const fila = {
      hotel_id: S.hotel.id, autor_id: S.user.id, tipo_id: d.get("tipo"), urgencia: d.get("urgencia"),
      para_area_id: para === "area" ? d.get("area") : null, para_perfil_id: para === "persona" ? d.get("persona") : null,
      lugar: String(d.get("lugar") ?? "").trim() || null, descripcion: desc, compartida_grupo: d.get("grupo") === "on",
      turno_id: turno?.id ?? null,
    };
    const n = await q(sb.from("novedades").insert(fila).select("id").single());
    await q(sb.from("novedad_lecturas").insert({ novedad_id: n.id, perfil_id: S.user.id }));
    aviso("Novedad guardada.");
    ir("novedad/" + n.id);
  });
}

async function vNovedad([id]) {
  const [n, coms, lecturas, tareas] = await Promise.all([
    q(sb.from("novedades").select(SEL_NOV + ", turno:turnos(nombre)").eq("id", id).maybeSingle()),
    q(sb.from("comentarios").select("*, autor:perfiles(nombre)").eq("novedad_id", id).order("creado_en")),
    q(sb.from("novedad_lecturas").select("perfil_id, leido_en, perfil:perfiles(nombre)").eq("novedad_id", id).order("leido_en")),
    q(sb.from("tareas").select(SEL_TAR).eq("novedad_id", id)),
  ]);
  if (!n) throw new Error("Esta novedad no existe o no tienes acceso a ella.");
  if (!lecturas.some((l) => l.perfil_id === S.user.id)) {
    sb.from("novedad_lecturas").upsert({ novedad_id: id, perfil_id: S.user.id }, { onConflict: "novedad_id,perfil_id", ignoreDuplicates: true }).then(() => {});
  }
  const propia = n.hotel_id === S.hotel.id;
  const puedeEditar = propia && (n.autor_id === S.user.id || alMenos("jefe_servicio"));
  const color = n.tipo?.color ?? "#6b7280";

  app.innerHTML = `<p><a href="#/novedades">← Novedades</a></p>
    <div class="tarjeta borde-tipo ${n.estado === "anulada" ? "anulada" : ""}" style="--tipo:${esc(color)}">
      <div class="fila"><span class="chip tipo">${esc(n.tipo?.nombre ?? "")}</span><span class="chip u-${n.urgencia}">${URG[n.urgencia]}</span>
        <span class="chip estado">${EST_N[n.estado]}</span>
        ${!propia ? `<span class="chip grupo">${esc(hotelDe(n.hotel_id))}</span>` : n.compartida_grupo ? `<span class="chip grupo">Compartida con el grupo</span>` : ""}</div>
      <p class="desc" style="font-size:1.05rem">${esc(n.descripcion)}</p>
      <div class="meta">${esc(n.autor?.nombre ?? "")} · ${fmtFecha.format(new Date(n.creado_en))}${n.turno ? " · turno " + esc(n.turno.nombre) : ""}</div>
      <div class="meta">${esc(paraTexto(n))}${n.lugar ? " · " + esc(n.lugar) : ""}</div>
      ${n.estado === "anulada" ? `<p class="error-txt">Anulada: ${esc(n.motivo_anulacion)}</p>` : ""}
    </div>
    ${puedeEditar && n.estado !== "anulada" ? `<div class="acciones">
      ${n.estado !== "seguimiento" && n.estado !== "cerrada" ? `<button class="btn sec chico" data-estado="seguimiento">En seguimiento</button>` : ""}
      ${n.estado !== "cerrada" ? `<button class="btn sec chico" data-estado="cerrada">Cerrar</button>` : `<button class="btn sec chico" data-estado="abierta">Reabrir</button>`}
      <a class="btn sec chico" href="#/nueva-tarea?novedad=${n.id}">Convertir en tarea</a>
      <button class="btn peligro chico" id="anular">Anular</button></div>` : ""}
    ${tareas.length ? `<h2>Tareas creadas desde esta novedad</h2>${tareas.map(tarjetaTarea).join("")}` : ""}
    <h2>Seguimiento (${coms.length})</h2>
    ${coms.map((c) => `<div class="comentario"><div class="meta">${esc(c.autor?.nombre ?? "")} · ${fecha(c.creado_en)}</div><div class="desc">${esc(c.texto)}</div></div>`).join("") || `<p class="meta">Sin comentarios todavía.</p>`}
    ${n.estado !== "anulada" ? `<form id="f-com"><label for="texto">Agregar seguimiento</label><textarea id="texto" name="texto" required maxlength="2000" style="min-height:80px"></textarea>
      <div class="acciones"><button class="btn" type="submit">Comentar</button></div></form>` : ""}
    ${alMenos("jefe_servicio") && propia ? `<h2>Leída por (${lecturas.length})</h2>
      <p class="meta">${lecturas.map((l) => `${esc(l.perfil?.nombre ?? "")} (${fecha(l.leido_en)})`).join(", ") || "Nadie todavía."}</p>` : ""}`;

  alClic("[data-estado]", async (b) => {
    await q(sb.from("novedades").update({ estado: b.dataset.estado }).eq("id", id));
    aviso("Estado actualizado."); vNovedad([id]);
  });
  alClic("#anular", async () => {
    const motivo = await confirmar("La novedad quedará tachada pero visible en el registro. No se puede deshacer.", { boton: "Anular", peligro: true, pedir: "Motivo" });
    if (!motivo) return;
    await q(sb.from("novedades").update({ estado: "anulada", motivo_anulacion: motivo }).eq("id", id));
    aviso("Novedad anulada."); vNovedad([id]);
  });
  const fc = document.getElementById("f-com");
  if (fc) alEnviar(fc, async (d) => {
    const texto = String(d.get("texto")).trim();
    if (!texto) return;
    await q(sb.from("comentarios").insert({ novedad_id: id, autor_id: S.user.id, texto }));
    if (puedeEditar && n.estado === "abierta") await q(sb.from("novedades").update({ estado: "seguimiento" }).eq("id", id));
    vNovedad([id]);
  });
}

// ===== Tareas =====
async function vTareas(_, params) {
  const tab = params.get("ver") ?? "mias";
  const estado = params.get("estado") ?? "activas";
  let c = visibles(sb.from("tareas").select(SEL_TAR)).order("creado_en", { ascending: false }).limit(100);
  if (tab === "mias") c = c.eq("asignada_a", S.user.id);
  else if (tab === "area") c = S.area ? c.eq("area_id", S.area) : c.eq("hotel_id", S.hotel.id).is("asignada_a", null);
  else if (tab === "creadas") c = c.eq("creado_por", S.user.id);
  if (estado === "activas") c = c.in("estado", ["pendiente", "en_curso"]);
  else if (estado !== "todas") c = c.eq("estado", estado);
  const tareas = soloVisibles(await q(c));
  tareas.sort((a, b) => (vencida(b) - vencida(a)) || ((a.fecha_limite ?? "9") < (b.fecha_limite ?? "9") ? -1 : 1));

  const pest = [["mias", "Mías"], ["area", S.area ? areaDe(S.area) : "Sin asignar"], ["creadas", "Creadas por mí"], ...(alMenos("jefe_servicio") ? [["todas", "Todas"]] : [])];
  const enlace = (v, e) => `#/tareas?ver=${v}&estado=${e}`;
  app.innerHTML = `<h1>Tareas</h1>
    <nav class="pestanas">${pest.map(([k, v]) => `<a href="${enlace(k, estado)}" class="${k === tab ? "activo" : ""}">${esc(v)}</a>`).join("")}</nav>
    <div class="filtros"><select id="estado" aria-label="Estado">
      ${[["activas", "Pendientes y en curso"], ["todas", "Todas"], ...Object.entries(EST_T)].map(([k, v]) => `<option value="${k}" ${k === estado ? "selected" : ""}>${v}</option>`).join("")}
    </select></div>
    ${tareas.length ? tareas.map(tarjetaTarea).join("") : `<p class="vacio">No hay tareas aquí.</p>`}
    <a class="btn flotante" href="#/nueva-tarea">+ Tarea</a>`;
  document.getElementById("estado").addEventListener("change", (e) => (location.hash = enlace(tab, e.target.value)));
}

async function vNuevaTarea(_, params) {
  const novId = params.get("novedad");
  const nov = novId ? await q(sb.from("novedades").select("id, descripcion, lugar, urgencia, para_area_id, tipo:tipos_novedad(nombre)").eq("id", novId).maybeSingle()) : null;
  const jefe = alMenos("jefe_servicio");
  const areas = jefe ? S.areas.filter((a) => a.activa) : S.areas.filter((a) => a.id === S.area);
  const personas = jefe ? S.personas.filter((p) => p.activa) : S.personas.filter((p) => p.id === S.user.id);
  const areaInicial = nov?.para_area_id ?? S.area ?? areas[0]?.id;

  app.innerHTML = `<h1>Nueva tarea</h1>
    ${nov ? `<p class="meta">Desde la novedad: ${esc(nov.tipo?.nombre ?? "")} · ${esc(nov.descripcion.slice(0, 90))}</p>` : ""}
    <form id="f-tar">
      <label for="titulo">¿Qué hay que hacer?</label>
      <input id="titulo" name="titulo" type="text" required maxlength="140" value="${esc(nov ? (nov.tipo?.nombre ?? "") + (nov.lugar ? " · " + nov.lugar : "") : "")}">
      <label for="descripcion">Detalle <span class="ayuda">(opcional)</span></label>
      <textarea id="descripcion" name="descripcion" maxlength="4000" style="min-height:80px">${esc(nov?.descripcion ?? "")}</textarea>
      <label>Asignar a</label>
      <div class="opciones">
        ${areas.length ? `<label><input type="radio" name="a" value="area" checked><span>Un área</span></label>` : ""}
        <label><input type="radio" name="a" value="persona" ${areas.length ? "" : "checked"}><span>${jefe ? "Una persona" : "Mí"}</span></label>
        ${areas.length ? `<label><input type="radio" name="a" value="siguiente"><span>Siguiente turno</span></label>` : ""}
      </div>
      <div id="sel-area" ${areas.length ? "" : "hidden"}><label for="area">Área</label>
        <select id="area" name="area">${areas.map((a) => `<option value="${a.id}" ${a.id === areaInicial ? "selected" : ""}>${esc(a.nombre)}</option>`).join("")}</select></div>
      <div id="sel-persona" ${areas.length ? "hidden" : ""}><label for="persona">Persona</label>
        <select id="persona" name="persona">${personas.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.area_id ? " · " + esc(areaDe(p.area_id)) : ""}</option>`).join("")}</select></div>
      <label>Urgencia</label>
      <div class="opciones">${Object.entries(URG).map(([k, v]) => `<label><input type="radio" name="urgencia" value="${k}" ${k === (nov?.urgencia ?? "media") ? "checked" : ""}><span>${v}</span></label>`).join("")}</div>
      <label for="limite">Fecha límite <span class="ayuda">(opcional)</span></label>
      <input id="limite" name="limite" type="datetime-local">
      ${S.grupo.length > 1 ? `<label class="check"><input type="checkbox" name="grupo"> Compartir con el grupo</label>` : ""}
      <div class="acciones"><button class="btn" type="submit">Crear tarea</button><a class="btn sec" href="${nov ? "#/novedad/" + nov.id : "#/tareas"}">Cancelar</a></div>
    </form>`;
  const f = document.getElementById("f-tar");
  f.querySelectorAll("input[name=a]").forEach((r) => r.addEventListener("change", () => {
    document.getElementById("sel-area").hidden = f.a.value === "persona";
    document.getElementById("sel-persona").hidden = f.a.value !== "persona";
  }));
  f.titulo.focus();
  alEnviar(f, async (d) => {
    const a = d.get("a");
    const persona = a === "persona" ? d.get("persona") : null;
    const fila = {
      hotel_id: S.hotel.id, creado_por: S.user.id, titulo: String(d.get("titulo")).trim(),
      descripcion: String(d.get("descripcion") ?? "").trim() || null,
      area_id: a === "persona" ? (S.personas.find((p) => p.id === persona)?.area_id ?? null) : d.get("area"),
      asignada_a: persona, asignada_por: persona ? S.user.id : null, siguiente_turno: a === "siguiente",
      urgencia: d.get("urgencia"), fecha_limite: d.get("limite") ? new Date(d.get("limite")).toISOString() : null,
      novedad_id: nov?.id ?? null, compartida_grupo: d.get("grupo") === "on",
    };
    if (!fila.titulo) throw new Error("Escribe qué hay que hacer.");
    const t = await q(sb.from("tareas").insert(fila).select("id").single());
    aviso("Tarea creada.");
    ir("tarea/" + t.id);
  });
}

async function vTarea([id]) {
  const [t, coms] = await Promise.all([
    q(sb.from("tareas").select(SEL_TAR + ", novedad:novedades(id, descripcion)").eq("id", id).maybeSingle()),
    q(sb.from("comentarios").select("*, autor:perfiles(nombre)").eq("tarea_id", id).order("creado_en")),
  ]);
  if (!t) throw new Error("Esta tarea no existe o no tienes acceso a ella.");
  const propia = t.hotel_id === S.hotel.id;
  const jefe = propia && alMenos("jefe_servicio");
  const mia = t.asignada_a === S.user.id;
  const abierta = ["pendiente", "en_curso"].includes(t.estado);
  const puedeTomar = propia && abierta && !t.asignada_a && (jefe || (t.area_id && t.area_id === S.area));
  const puedeMover = propia && (jefe || mia || t.creado_por === S.user.id);
  const candidatos = S.personas.filter((p) => p.activa && (!t.area_id || p.area_id === t.area_id || nivel(p.rol) >= nivel("lider")));

  app.innerHTML = `<p><a href="#/tareas">← Tareas</a></p>
    <div class="tarjeta">
      <div class="fila entre"><span class="titulo" style="font-size:1.1rem">${esc(t.titulo)}</span><span class="chip estado">${EST_T[t.estado]}</span></div>
      <div class="fila" style="margin-top:8px"><span class="chip u-${t.urgencia}">${URG[t.urgencia]}</span>${vencida(t) ? `<span class="chip vencida">Vencida</span>` : ""}
        ${!propia ? `<span class="chip grupo">${esc(hotelDe(t.hotel_id))}</span>` : ""}</div>
      ${t.descripcion ? `<p class="desc">${esc(t.descripcion)}</p>` : ""}
      <div class="meta">Asignada: <strong>${esc(asignadoTexto(t))}</strong>${t.asignada_por && t.asignada_por !== t.asignada_a ? " (por " + esc(nombreDe(t.asignada_por)) + ")" : ""}</div>
      <div class="meta">Creada por ${esc(t.creador?.nombre ?? "")} · ${fecha(t.creado_en)}${t.fecha_limite ? " · vence " + fmtFecha.format(new Date(t.fecha_limite)) : ""}</div>
      ${t.novedad ? `<div class="meta">Origen: <a href="#/novedad/${t.novedad.id}">${esc(t.novedad.descripcion.slice(0, 80))}</a></div>
        ${abierta ? `<div class="ayuda">Cuando se terminen todas las tareas de esa novedad, la novedad se cierra sola.</div>` : ""}` : ""}
      ${t.estado === "hecha" ? `<p class="meta">Hecha ${fecha(t.completada_en)}${t.nota_cierre ? ": " + esc(t.nota_cierre) : ""}</p>` : ""}
    </div>
    <div class="acciones">
      ${puedeTomar ? `<button class="btn" id="tomar">Tomarla yo</button>` : ""}
      ${puedeMover && t.estado === "pendiente" && t.asignada_a ? `<button class="btn sec" data-estado="en_curso">Empezar</button>` : ""}
      ${puedeMover && abierta ? `<button class="btn" id="hecha">Marcar hecha</button>` : ""}
      ${jefe && abierta ? `<button class="btn sec" id="asignar">${t.asignada_a ? "Reasignar" : "Asignar"}</button>` : ""}
      ${(jefe || t.creado_por === S.user.id) && propia && abierta ? `<button class="btn peligro chico" data-estado="cancelada">Cancelar tarea</button>` : ""}
      ${puedeMover && !abierta ? `<button class="btn sec" data-estado="pendiente">Reabrir</button>` : ""}
    </div>
    <h2>Comentarios (${coms.length})</h2>
    ${coms.map((c) => `<div class="comentario"><div class="meta">${esc(c.autor?.nombre ?? "")} · ${fecha(c.creado_en)}</div><div class="desc">${esc(c.texto)}</div></div>`).join("") || `<p class="meta">Sin comentarios todavía.</p>`}
    <form id="f-com"><label for="texto">Agregar comentario</label><textarea id="texto" name="texto" required maxlength="2000" style="min-height:80px"></textarea>
      <div class="acciones"><button class="btn" type="submit">Comentar</button></div></form>`;

  const actualizar = async (cambios, msg) => {
    await q(sb.from("tareas").update(cambios).eq("id", id));
    aviso(cambios.estado === "hecha" && t.novedad ? msg + " Si era la última tarea, la novedad quedó cerrada." : msg); vTarea([id]);
  };
  alClic("#tomar", () => actualizar({ asignada_a: S.user.id, asignada_por: S.user.id, estado: "en_curso" }, "La tarea es tuya."));
  alClic("[data-estado]", (b) => actualizar(
    { estado: b.dataset.estado, ...(b.dataset.estado === "pendiente" ? { completada_en: null, nota_cierre: null } : {}) },
    "Estado actualizado."));
  alClic("#hecha", async () => {
    const nota = await new Promise((res) => {
      const d = dialogo(`<form method="dialog"><h2 style="margin-top:0">Marcar como hecha</h2>
        <label for="nota">Nota de cierre <span class="ayuda">(opcional)</span></label><textarea id="nota" style="min-height:80px"></textarea>
        <div class="acciones"><button class="btn" value="si">Marcar hecha</button><button class="btn sec" type="button" data-cerrar>Volver</button></div></form>`);
      d.querySelector("form").addEventListener("submit", () => res({ nota: d.querySelector("#nota").value.trim() }));
      d.addEventListener("close", () => res(null));
    });
    if (!nota) return;
    await actualizar({ estado: "hecha", completada_en: new Date().toISOString(), nota_cierre: nota.nota || null }, "Tarea hecha.");
  });
  alClic("#asignar", async () => {
    const elegido = await new Promise((res) => {
      const d = dialogo(`<form method="dialog"><h2 style="margin-top:0">Asignar tarea</h2>
        <label for="quien">Persona</label><select id="quien">${candidatos.map((p) => `<option value="${p.id}" ${p.id === t.asignada_a ? "selected" : ""}>${esc(p.nombre)} · ${ROL[p.rol]}</option>`).join("")}</select>
        <div class="acciones"><button class="btn" value="si">Asignar</button><button class="btn sec" type="button" data-cerrar>Volver</button></div></form>`);
      d.querySelector("form").addEventListener("submit", () => res(d.querySelector("#quien").value));
      d.addEventListener("close", () => res(null));
    });
    if (!elegido) return;
    await actualizar({ asignada_a: elegido, asignada_por: S.user.id, siguiente_turno: false }, "Tarea asignada a " + nombreDe(elegido) + ".");
  });
  alEnviar(document.getElementById("f-com"), async (d) => {
    const texto = String(d.get("texto")).trim();
    if (!texto) return;
    await q(sb.from("comentarios").insert({ tarea_id: id, autor_id: S.user.id, texto }));
    vTarea([id]);
  });
}

// ===== Ajustes (líder y administrador) =====
async function vAdmin(_, params) {
  if (!alMenos("lider")) throw new Error("Esta sección es solo para líderes.");
  const tab = params.get("ver") ?? "personas";
  const pest = [["personas", "Personas"], ["areas", "Áreas"], ["turnos", "Turnos"], ["tipos", "Tipos de novedad"], ...(S.perfil.es_admin_global ? [["hoteles", "Hoteles"]] : [])];
  const hotelesLider = S.membresias.filter((m) => nivel(m.rol) >= nivel("lider"));
  app.innerHTML = `<h1>Ajustes</h1>
    ${hotelesLider.length > 1 ? `<label for="ajuste-hotel">Hotel que estás configurando</label>
      <select id="ajuste-hotel">${hotelesLider.map((m) => `<option value="${m.hotel_id}" ${m.hotel_id === S.hotel.id ? "selected" : ""}>${esc(m.hotel.nombre)}${m.hotel.es_prueba ? " (pruebas)" : ""}</option>`).join("")}</select>`
      : `<p class="meta">Hotel: <strong>${esc(S.hotel.nombre)}</strong></p>`}
    <p class="ayuda">Personas, áreas, turnos y tipos son propios de cada hotel.</p>
    <nav class="pestanas">${pest.map(([k, v]) => `<a href="#/admin?ver=${k}" class="${k === tab ? "activo" : ""}">${v}</a>`).join("")}</nav>
    <div id="panel"></div>`;
  const panel = document.getElementById("panel");
  document.getElementById("ajuste-hotel")?.addEventListener("change", async (e) => {
    await entrarAlHotel(e.target.value);
    aviso("Ahora configuras " + S.hotel.nombre + ".");
    vAdmin(_, params);
  });
  const recargar = async () => { await entrarAlHotel(S.hotel.id); vAdmin(_, params); };
  ({ personas: aPersonas, areas: aAreas, turnos: aTurnos, tipos: aTipos, hoteles: aHoteles }[tab] ?? aPersonas)(panel, recargar);
}

function aPersonas(panel, recargar) {
  const roles = ORDEN.filter((r) => r !== "admin" && (S.perfil.es_admin_global || nivel(r) < nivel("lider")));
  const opArea = (sel) => `<option value="">Sin área (todo el hotel)</option>` + S.areas.filter((a) => a.activa).map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.nombre)}</option>`).join("");
  panel.innerHTML = `<div class="acciones" style="margin-top:0"><button class="btn" id="nueva">+ Agregar persona</button></div>
    <div class="tabla-scroll" style="margin-top:14px"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Área</th><th>Estado</th><th></th></tr></thead><tbody>
    ${S.personas.map((p) => `<tr><td>${esc(p.nombre)}<div class="meta">${esc(p.correo)}</div></td><td>${ROL[p.rol]}</td>
      <td>${p.area_id ? esc(areaDe(p.area_id)) : "—"}</td><td>${p.activa ? "Activa" : "Sin acceso"}</td>
      <td>${p.id !== S.user.id && (S.perfil.es_admin_global || nivel(p.rol) < nivel("lider")) ? `<button class="btn sec chico" data-p="${p.id}">Editar</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="ayuda">Para dar acceso a alguien que ya trabaja en otro hotel del grupo, agrégalo con el mismo correo: conserva su PIN.</p>`;

  alClic("#nueva", async () => {
    const pin = pinAleatorio();
    const d = dialogo(`<form method="dialog" id="f-p"><h2 style="margin-top:0">Agregar persona</h2>
      <label for="p-nombre">Nombre</label><input id="p-nombre" name="nombre" type="text" required>
      <label for="p-correo">Correo</label><input id="p-correo" name="correo" type="email" required>
      <label for="p-pin">PIN inicial <span class="ayuda">(díselo en persona; puede cambiarlo después)</span></label>
      <input id="p-pin" name="pin" type="text" inputmode="numeric" maxlength="6" class="pin" value="${pin}" required>
      <label for="p-rol">Rol</label><select id="p-rol" name="rol">${roles.map((r) => `<option value="${r}">${ROL[r]}</option>`).join("")}</select>
      <label for="p-area">Área</label><select id="p-area" name="area">${opArea(null)}</select>
      <div class="acciones"><button class="btn" type="submit">Agregar</button><button class="btn sec" type="button" data-cerrar>Cancelar</button></div></form>`);
    alEnviar(d.querySelector("form"), async (f) => {
      if (!/^\d{6}$/.test(f.get("pin"))) throw new Error("El PIN debe tener 6 dígitos.");
      const r = await llamarFuncion({ accion: "crear", hotel_id: S.hotel.id, nombre: f.get("nombre"), correo: f.get("correo"), pin: f.get("pin"), rol: f.get("rol"), area_id: f.get("area") || null });
      d.close();
      if (r.yaExistia) aviso("Esa persona ya tenía usuario: se le dio acceso a este hotel con su PIN actual.");
      else mostrarAcceso(f.get("nombre"), String(f.get("correo")).trim().toLowerCase(), f.get("pin"));
      recargar();
    });
  }, panel);

  alClic("[data-p]", async (b) => {
    const p = S.personas.find((x) => x.id === b.dataset.p);
    const d = dialogo(`<form method="dialog"><h2 style="margin-top:0">Editar persona</h2>
      <label for="e-nombre">Nombre</label><input id="e-nombre" type="text" value="${esc(p.nombre)}" required>
      <label for="e-correo">Correo <span class="ayuda">(con el que entra)</span></label><input id="e-correo" type="email" value="${esc(p.correo)}" required>
      <label for="e-rol">Rol</label><select id="e-rol">${roles.map((r) => `<option value="${r}" ${r === p.rol ? "selected" : ""}>${ROL[r]}</option>`).join("")}</select>
      <label for="e-area">Área</label><select id="e-area">${opArea(p.area_id)}</select>
      <label class="check"><input type="checkbox" id="e-activa" ${p.activa ? "checked" : ""}> Tiene acceso a este hotel</label>
      <div class="acciones"><button class="btn" id="e-guardar" type="button">Guardar</button><button class="btn sec" type="button" id="e-pin">Asignar PIN nuevo</button>
      <button class="btn sec" type="button" data-cerrar>Cerrar</button></div>
      <div class="acciones"><button class="btn peligro chico" type="button" id="e-eliminar">Eliminar persona</button></div>
      <p class="ayuda">Eliminar solo funciona si la persona aún no ha registrado nada. Si ya tiene historial, desmarca "Tiene acceso".</p></form>`);
    alClic("#e-guardar", async () => {
      const nombre = d.querySelector("#e-nombre").value.trim(), correo = d.querySelector("#e-correo").value.trim().toLowerCase();
      if (!nombre || !correo.includes("@")) throw new Error("Revisa el nombre y el correo.");
      if (nombre !== p.nombre || correo !== p.correo) {
        await llamarFuncion({ accion: "editar", hotel_id: S.hotel.id, perfil_id: p.id, nombre, correo });
      }
      const cambios = { rol: d.querySelector("#e-rol").value, area_id: d.querySelector("#e-area").value || null, activa: d.querySelector("#e-activa").checked };
      if (cambios.rol !== p.rol || cambios.area_id !== (p.area_id ?? null) || cambios.activa !== p.activa) {
        await q(sb.from("membresias").update(cambios).eq("id", p.membresia));
      }
      d.close(); aviso(correo !== p.correo ? `Cambios guardados. Ahora entra con ${correo}.` : "Cambios guardados."); recargar();
    }, d);
    alClic("#e-eliminar", async () => {
      if (!(await confirmar(`¿Eliminar a ${p.nombre}? Se borra su usuario y ya no podrá entrar. No se puede deshacer.`, { boton: "Eliminar", peligro: true }))) return;
      const r = await llamarFuncion({ accion: "eliminar", hotel_id: S.hotel.id, perfil_id: p.id });
      d.close();
      aviso(r.soloEsteHotel ? `${p.nombre} ya no está en este hotel; sigue en sus otros hoteles.` : `${p.nombre} fue eliminada.`);
      recargar();
    }, d);
    alClic("#e-pin", async () => {
      const pin = pinAleatorio();
      if (!(await confirmar(`El PIN de ${p.nombre} pasará a ser ${pin}. Díselo en persona.`, { boton: "Cambiar PIN" }))) return;
      await llamarFuncion({ accion: "resetear_pin", hotel_id: S.hotel.id, perfil_id: p.id, pin });
      d.close();
      mostrarAcceso(p.nombre, p.correo, pin);
    }, d);
  }, panel);
}

// Los datos de acceso quedan a la vista hasta que se cierren, para anotarlos sin prisa
function mostrarAcceso(nombre, correo, pin) {
  const texto = `Bitácora Masaya\n${location.origin}${location.pathname}\nCorreo: ${correo}\nPIN: ${pin}`;
  const d = dialogo(`<div><h2 style="margin-top:0">Datos de acceso de ${esc(nombre)}</h2>
    <p class="meta">Entrégaselos en persona. Puede cambiar el PIN después en Mi cuenta.</p>
    <label>Correo</label><p class="titulo" style="margin:0;overflow-wrap:anywhere">${esc(correo)}</p>
    <label>PIN</label><p class="pin" style="font-size:2rem;font-weight:700;margin:0;text-align:left">${esc(pin)}</p>
    <div class="acciones"><button class="btn sec" id="copiar">Copiar datos</button><button class="btn" data-cerrar>Ya lo anoté</button></div></div>`);
  alClic("#copiar", async () => {
    try { await navigator.clipboard.writeText(texto); aviso("Datos copiados. Puedes pegarlos en un mensaje."); }
    catch { aviso("No se pudo copiar; anótalos a mano.", true); }
  }, d);
}

async function llamarFuncion(body) {
  const { data, error } = await sb.functions.invoke("gestionar-usuario", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch { /* respuesta sin JSON */ }
    throw new Error(msg);
  }
  return data;
}

function listaEditable(panel, { filas, columnas, nueva, guardar, alternar }) {
  panel.innerHTML = `<div class="tabla-scroll"><table><thead><tr>${columnas.map((c) => `<th>${c}</th>`).join("")}<th></th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    <h2>Agregar</h2><form id="f-nuevo" class="filtros">${nueva}<button class="btn" type="submit">Agregar</button></form>`;
  alEnviar(panel.querySelector("#f-nuevo"), guardar);
  alClic("[data-alt]", alternar, panel);
}

function aAreas(panel, recargar) {
  listaEditable(panel, {
    columnas: ["Área", "Estado"],
    filas: S.areas.map((a) => `<tr><td>${esc(a.nombre)}</td><td>${a.activa ? "Activa" : "Inactiva"}</td>
      <td><button class="btn sec chico" data-alt="${a.id}">${a.activa ? "Desactivar" : "Activar"}</button></td></tr>`).join(""),
    nueva: `<input class="todo" name="nombre" type="text" placeholder="Nombre del área" required aria-label="Nombre del área">`,
    guardar: async (f) => { await q(sb.from("areas").insert({ hotel_id: S.hotel.id, nombre: String(f.get("nombre")).trim() })); aviso("Área agregada."); recargar(); },
    alternar: async (b) => { const a = S.areas.find((x) => x.id === b.dataset.alt); await q(sb.from("areas").update({ activa: !a.activa }).eq("id", a.id)); recargar(); },
  });
}

function aTurnos(panel, recargar) {
  listaEditable(panel, {
    columnas: ["Área", "Turno", "Horario", "Estado"],
    filas: S.turnos.map((t) => `<tr><td>${esc(areaDe(t.area_id))}</td><td>${esc(t.nombre)}</td><td>${t.hora_inicio.slice(0, 5)} a ${t.hora_fin.slice(0, 5)}</td>
      <td>${t.activo ? "Activo" : "Inactivo"}</td><td><button class="btn sec chico" data-alt="${t.id}">${t.activo ? "Desactivar" : "Activar"}</button></td></tr>`).join("")
      || `<tr><td colspan="5" class="meta">${esc(S.hotel.nombre)} aún no tiene turnos. Agrega los de cada área, por ejemplo Mañana de 06:00 a 14:00.</td></tr>`,
    nueva: `<select name="area" aria-label="Área">${S.areas.filter((a) => a.activa).map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("")}</select>
      <input name="nombre" type="text" placeholder="Nombre (Mañana)" required aria-label="Nombre del turno">
      <input name="inicio" type="time" required aria-label="Hora de inicio" value="06:00"><input name="fin" type="time" required aria-label="Hora de fin" value="14:00">`,
    guardar: async (f) => {
      await q(sb.from("turnos").insert({ area_id: f.get("area"), nombre: String(f.get("nombre")).trim(), hora_inicio: f.get("inicio"), hora_fin: f.get("fin") }));
      aviso("Turno agregado."); recargar();
    },
    alternar: async (b) => { const t = S.turnos.find((x) => x.id === b.dataset.alt); await q(sb.from("turnos").update({ activo: !t.activo }).eq("id", t.id)); recargar(); },
  });
}

function aTipos(panel, recargar) {
  listaEditable(panel, {
    columnas: ["Tipo", "Urgencia por defecto", "Estado"],
    filas: S.tipos.map((t) => `<tr><td><span class="chip tipo" style="--tipo:${esc(t.color)}">${esc(t.nombre)}</span></td><td>${URG[t.urgencia_defecto]}</td>
      <td>${t.activo ? "Activo" : "Inactivo"}</td><td><button class="btn sec chico" data-alt="${t.id}">${t.activo ? "Desactivar" : "Activar"}</button></td></tr>`).join(""),
    nueva: `<input name="nombre" type="text" placeholder="Nombre del tipo" required aria-label="Nombre del tipo">
      <select name="urgencia" aria-label="Urgencia por defecto">${Object.entries(URG).map(([k, v]) => `<option value="${k}" ${k === "media" ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input name="color" type="color" value="#2563eb" aria-label="Color">`,
    guardar: async (f) => {
      await q(sb.from("tipos_novedad").insert({ hotel_id: S.hotel.id, nombre: String(f.get("nombre")).trim(), urgencia_defecto: f.get("urgencia"), color: f.get("color") }));
      aviso("Tipo agregado."); recargar();
    },
    alternar: async (b) => { const t = S.tipos.find((x) => x.id === b.dataset.alt); await q(sb.from("tipos_novedad").update({ activo: !t.activo }).eq("id", t.id)); recargar(); },
  });
}

async function aHoteles(panel) {
  const [hoteles, grupos] = await Promise.all([
    q(sb.from("hoteles").select("*").order("nombre")),
    q(sb.from("grupos").select("*").order("nombre")),
  ]);
  const gNombre = (id) => grupos.find((g) => g.id === id)?.nombre ?? "Sin grupo";
  panel.innerHTML = `<div class="tabla-scroll"><table><thead><tr><th>Hotel</th><th>Grupo</th><th>Estado</th></tr></thead><tbody>
    ${hoteles.map((h) => `<tr><td>${esc(h.nombre)}${h.es_prueba ? " (pruebas)" : ""}</td><td>${esc(gNombre(h.grupo_id))}</td><td>${h.activo ? "Activo" : "Inactivo"}</td></tr>`).join("")}
    </tbody></table></div>
    <h2>Agregar hotel</h2>
    <form id="f-hotel">
      <label for="h-nombre">Nombre</label><input id="h-nombre" name="nombre" type="text" required>
      <label for="h-grupo">Grupo <span class="ayuda">(los hoteles de un grupo pueden compartir novedades y tareas)</span></label>
      <select id="h-grupo" name="grupo"><option value="">Sin grupo (aislado)</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.nombre)}</option>`).join("")}<option value="nuevo">Nuevo grupo…</option></select>
      <div id="h-nuevo" hidden><label for="h-gnombre">Nombre del grupo nuevo</label><input id="h-gnombre" name="gnombre" type="text"></div>
      <p class="ayuda">Se crea con las áreas y tipos de novedad de ${esc(S.hotel.nombre)}, que luego puedes cambiar.</p>
      <div class="acciones"><button class="btn" type="submit">Crear hotel</button></div>
    </form>`;
  const f = panel.querySelector("#f-hotel");
  f.grupo.addEventListener("change", () => (panel.querySelector("#h-nuevo").hidden = f.grupo.value !== "nuevo"));
  alEnviar(f, async (d) => {
    let grupo = d.get("grupo") || null;
    if (grupo === "nuevo") {
      const nombre = String(d.get("gnombre")).trim();
      if (!nombre) throw new Error("Escribe el nombre del grupo.");
      grupo = (await q(sb.from("grupos").insert({ nombre }).select("id").single())).id;
    }
    const h = await q(sb.from("hoteles").insert({ nombre: String(d.get("nombre")).trim(), grupo_id: grupo }).select("*").single());
    await q(sb.from("areas").insert(S.areas.filter((a) => a.activa).map((a) => ({ hotel_id: h.id, nombre: a.nombre }))));
    await q(sb.from("tipos_novedad").insert(S.tipos.filter((t) => t.activo).map((t) => ({ hotel_id: h.id, nombre: t.nombre, color: t.color, urgencia_defecto: t.urgencia_defecto }))));
    await cargarUsuario();
    aviso("Hotel creado. Ya aparece al cambiar de hotel.");
    aHoteles(panel);
  });
}

// ===== Registro (log) =====
function describir(r) {
  const cosa = TABLA[r.tabla] ?? r.tabla;
  const d = r.despues ?? {}, a = r.antes ?? {};
  let detalle = "";
  if (r.accion === "INSERT") detalle = d.titulo ?? d.descripcion ?? d.texto ?? d.nombre ?? (r.tabla === "membresias" ? `${nombreDe(d.perfil_id)} como ${ROL[d.rol] ?? d.rol}` : "");
  else if (r.accion === "UPDATE") {
    const cambios = Object.keys(d).filter((k) => JSON.stringify(d[k]) !== JSON.stringify(a[k]));
    const nombres = { estado: "estado", asignada_a: "asignada a", rol: "rol", area_id: "área", activa: "acceso", activo: "activo", descripcion: "descripción", urgencia: "urgencia", motivo_anulacion: "motivo" };
    const val = (k, v) => k === "asignada_a" ? nombreDe(v) : k === "area_id" ? areaDe(v) : k === "estado" ? (EST_N[v] ?? EST_T[v] ?? v) : k === "rol" ? ROL[v] : String(v ?? "—");
    detalle = cambios.filter((k) => nombres[k]).map((k) => `${nombres[k]}: ${val(k, a[k])} → ${val(k, d[k])}`).join("; ");
    if (r.tabla === "membresias") detalle = nombreDe(d.perfil_id) + (detalle ? " · " + detalle : "");
    if (r.tabla === "perfiles") detalle = d.pin ? `PIN de ${nombreDe(r.registro_id)}` : ["nombre", "correo"].filter((k) => a[k] !== d[k]).map((k) => `${k}: ${a[k]} → ${d[k]}`).join("; ");
  } else if (r.accion === "DELETE") detalle = a.nombre ? `${a.nombre} (${a.correo ?? ""})` : r.tabla === "membresias" ? `acceso de ${nombreDe(a.perfil_id)}` : (a.titulo ?? a.nombre ?? "");
  return { cosa, detalle: String(detalle ?? "").slice(0, 200) };
}

async function vLog(_, params) {
  if (!alMenos("lider")) throw new Error("Esta sección es solo para líderes.");
  const hoy = new Date().toISOString().slice(0, 10);
  const f = { desde: params.get("desde") ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), hasta: params.get("hasta") ?? hoy, tabla: params.get("tabla") ?? "", persona: params.get("persona") ?? "" };
  const consulta = (lim) => {
    let c = sb.from("log_auditoria").select("*").eq("hotel_id", S.hotel.id)
      .gte("en", new Date(f.desde + "T00:00").toISOString()).lt("en", new Date(new Date(f.hasta + "T00:00").getTime() + 864e5).toISOString())
      .order("en", { ascending: false }).limit(lim);
    if (f.tabla) c = c.eq("tabla", f.tabla);
    if (f.persona) c = c.eq("perfil_id", f.persona);
    return c;
  };
  const filas = await q(consulta(300));
  const opt = (v, t, s) => `<option value="${esc(v)}" ${v === s ? "selected" : ""}>${esc(t)}</option>`;
  app.innerHTML = `<h1>Registro de actividad</h1>
    <p class="meta">Todo lo que se crea o cambia queda aquí automáticamente y no se puede editar.</p>
    <form class="filtros" id="filtros">
      <input type="date" name="desde" value="${f.desde}" aria-label="Desde"><input type="date" name="hasta" value="${f.hasta}" aria-label="Hasta">
      <select name="tabla" aria-label="Qué">${opt("", "Todo", f.tabla)}${Object.entries(TABLA).map(([k, v]) => opt(k, v[0].toUpperCase() + v.slice(1), f.tabla)).join("")}</select>
      <select name="persona" aria-label="Persona">${opt("", "Todas las personas", f.persona)}${S.personas.map((p) => opt(p.id, p.nombre, f.persona)).join("")}</select>
    </form>
    <div class="acciones" style="margin-top:0;margin-bottom:12px"><button class="btn sec chico" id="csv">Descargar para Excel (CSV)</button></div>
    ${filas.length ? filas.map((r) => { const x = describir(r); return `<div class="tarjeta">
        <div class="meta">${fmtFecha.format(new Date(r.en))} · ${esc(r.perfil_id ? nombreDe(r.perfil_id) : "Sistema")}</div>
        <div><strong>${ACCION[r.accion] ?? r.accion} ${esc(x.cosa)}</strong>${x.detalle ? ": " + esc(x.detalle) : ""}</div></div>`; }).join("")
      + (filas.length === 300 ? `<p class="ayuda">Se muestran los 300 más recientes. Acota las fechas o descarga el CSV para ver todo.</p>` : "")
    : `<p class="vacio">No hay actividad en estas fechas.</p>`}`;

  const form = document.getElementById("filtros");
  form.querySelectorAll("input, select").forEach((el) => el.addEventListener("change", () => ir("log?" + new URLSearchParams(new FormData(form)))));
  alClic("#csv", async () => {
    const todas = await q(consulta(5000));
    const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = [["Fecha", "Persona", "Acción", "Qué", "Detalle", "Id"].map(celda).join(";")];
    for (const r of todas) {
      const x = describir(r);
      lineas.push([new Date(r.en).toLocaleString("es-CO"), r.perfil_id ? nombreDe(r.perfil_id) : "Sistema", ACCION[r.accion] ?? r.accion, x.cosa, x.detalle, r.registro_id].map(celda).join(";"));
    }
    const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `registro-${S.hotel.nombre.replace(/\W+/g, "-")}-${f.desde}-a-${f.hasta}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ===== Mi cuenta =====
function abrirCuenta() {
  if (!S.user) return;
  const d = dialogo(`<div><h2 style="margin-top:0">${esc(S.perfil.nombre)}</h2><p class="meta">${esc(S.perfil.correo)}</p>
    <form id="f-pin"><label for="nuevo-pin">Cambiar mi PIN</label>
      <input id="nuevo-pin" name="pin" type="password" inputmode="numeric" maxlength="6" class="pin" autocomplete="new-password" placeholder="Nuevo PIN">
      <div class="acciones"><button class="btn sec" type="submit">Guardar PIN</button></div></form>
    <div class="acciones">${S.membresias.length > 1 ? `<button class="btn sec" id="c-hotel">Cambiar de hotel</button>` : ""}
      <button class="btn peligro" id="c-salir">Cerrar sesión</button><button class="btn sec" data-cerrar>Cerrar</button></div></div>`);
  alEnviar(d.querySelector("#f-pin"), async (f) => {
    const pin = String(f.get("pin"));
    if (!/^\d{6}$/.test(pin)) throw new Error("El PIN debe tener 6 dígitos.");
    const { error } = await sb.auth.updateUser({ password: pin });
    if (error) throw new Error(/different/i.test(error.message) ? "Ese ya es tu PIN." : error.message);
    d.close(); aviso("PIN cambiado.");
  });
  alClic("#c-hotel", () => { d.close(); S.hotel = null; ir("hotel"); }, d);
  alClic("#c-salir", async () => { d.close(); await salir(); }, d);
}

// La sesión se cierra tras MIN_INACTIVIDAD minutos sin uso, en cualquier dispositivo.
// La última actividad se guarda para que también aplique si se cerró la pestaña o el celular se bloqueó.
function marcarActividad() {
  if (S.user && Date.now() - (Number(leer("actividad")) || 0) > 15000) guardar("actividad", String(Date.now()));
}
function inactivo() {
  const ultima = Number(leer("actividad")) || 0;
  return ultima > 0 && Date.now() - ultima > MIN_INACTIVIDAD * 60000;
}
async function revisarInactividad() {
  if (S.user && inactivo()) {
    document.querySelectorAll("dialog").forEach((d) => d.close());
    await salir();
    aviso(`Se cerró la sesión tras ${MIN_INACTIVIDAD} minutos sin uso.`);
  }
}
["click", "keydown", "touchstart", "scroll"].forEach((ev) => document.addEventListener(ev, marcarActividad, { passive: true }));
document.addEventListener("visibilitychange", () => { if (!document.hidden) revisarInactividad(); });
setInterval(revisarInactividad, 20000);

// ===== Arranque =====
async function arrancar() {
  // Si la última vez se dejó abierta y pasó el tiempo, se pide el PIN otra vez
  if (inactivo()) { await sb.auth.signOut(); guardar("actividad", null); }
  try {
    if (!(await cargarUsuario())) return ir("entrar");
  } catch (err) {
    aviso(err.message, true);
    await sb.auth.signOut();
    S.user = null;
    return ir("entrar");
  }
  let guardado = null;
  try { guardado = localStorage.getItem("hotel"); } catch { /* sin almacenamiento */ }
  const elegido = S.membresias.find((m) => m.hotel_id === guardado) ?? (S.membresias.length === 1 ? S.membresias[0] : null);
  if (elegido) await entrarAlHotel(elegido.hotel_id);
  guardar("actividad", String(Date.now()));
  const destino = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (!S.hotel) ir("hotel");
  else if (!destino || ["entrar", "hotel"].includes(destino)) ir("inicio");
  else enrutar();
}

document.getElementById("btn-cuenta").addEventListener("click", abrirCuenta);
document.getElementById("btn-hotel").addEventListener("click", () => { if (S.membresias.length > 1) { S.hotel = null; ir("hotel"); } });
window.addEventListener("hashchange", enrutar);
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && S.user) { S.user = null; S.hotel = null; ir("entrar"); } });
arrancar();
