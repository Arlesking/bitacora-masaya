// Deja abrir la página y ver lo último cargado cuando no hay señal (en Tayrona se cae seguido).
// Siempre se intenta primero la red, así que con señal todo sale fresco; sin señal, o si la
// señal es tan débil que no responde en unos segundos, se muestra la última copia guardada.
// Lo que se escribe sin señal no pasa por aquí: lo guarda la página (ver "Sin señal" en app.js).
const PAGINA = "bitacora-pagina";
const DATOS = "bitacora-datos";   // la página lo borra al cerrar sesión o si entra otra persona
const ARCHIVOS = ["./", "./css/estilos.css", "./js/app.js", "./js/sb.js", "./js/config.js", "./js/medicion.js"];
const ESPERA_PAGINA = 5000, ESPERA_DATOS = 8000;

self.addEventListener("install", (e) => e.waitUntil(caches.open(PAGINA).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// La página avisa qué archivos de la librería de Supabase cargó, para tenerlos sin señal
self.addEventListener("message", (e) => {
  if (e.data?.tipo !== "guardar") return;
  e.waitUntil(caches.open(PAGINA).then((c) => Promise.all(e.data.urls.map((u) => c.match(u).then((m) => m || c.add(u)).catch(() => {})))));
});

self.addEventListener("fetch", (e) => {
  const r = e.request, url = new URL(r.url);
  if (url.origin === location.origin) {
    if (r.method !== "GET") return;
    const clave = r.mode === "navigate" ? new URL("./", self.registration.scope).href : url.origin + url.pathname;
    e.respondWith(primeroRed(e, r, PAGINA, clave, ESPERA_PAGINA));
  } else if (url.hostname === "cdn.jsdelivr.net" && r.method === "GET") {
    // Las versiones de la librería no cambian: si ya está guardada, no hace falta la red
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => {
      if (res.ok) { const copia = res.clone(); e.waitUntil(caches.open(PAGINA).then((c) => c.put(r, copia))); }
      return res;
    })));
  } else if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    // Lecturas. Las funciones de solo lectura (rpc) van por POST: se guardan según lo que se pidió.
    if (r.method === "GET" || r.method === "HEAD") e.respondWith(datos(e, r, ""));
    else if (r.method === "POST" && url.pathname.startsWith("/rest/v1/rpc/")) e.respondWith(r.clone().text().then((cuerpo) => datos(e, r, cuerpo)));
  }
});

async function datos(e, r, cuerpo) {
  const url = new URL(r.url);
  // Las consultas con "desde hace 3 días" cambian de hora en hora: sin señal sirve la última que se hizo
  const consulta = decodeURIComponent(url.search).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "@");
  const clave = `${url.origin}${url.pathname}?q=${encodeURIComponent(consulta)}&m=${r.method}&b=${encodeURIComponent(cuerpo)}`;
  // Sin sesión vigente (por ejemplo, la página la está renovando) la respuesta saldría vacía: no se guarda
  const anonima = r.headers.get("authorization") === "Bearer " + r.headers.get("apikey");
  return primeroRed(e, r, DATOS, clave, ESPERA_DATOS, anonima);
}

async function primeroRed(e, r, nombre, clave, espera, soloLeer = false) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(clave, { ignoreVary: true });
  const red = fetch(r).then((res) => {
    if (res.ok && !soloLeer) e.waitUntil(guardar(cache, clave, res.clone()));
    return res;
  });
  if (!guardada) return red;
  if (soloLeer) return marcar(guardada);
  // Con señal débil no se espera para siempre: pasado un rato se muestra lo guardado
  // y la respuesta de la red, si llega, queda guardada para la próxima vez.
  e.waitUntil(red.catch(() => {}));
  return Promise.race([red.catch(() => marcar(guardada)), new Promise((ok) => setTimeout(() => ok(marcar(guardada)), espera))]);
}

// Se guarda con estado 200 (la caché no acepta respuestas parciales) y el estado real aparte
async function guardar(cache, clave, res) {
  const h = new Headers(res.headers);
  h.set("x-bitacora-estado", String(res.status));
  await cache.put(clave, new Response(await res.blob(), { status: 200, headers: h }));
}

// La página ve en "x-bitacora-guardado" que esto viene de la copia del celular, no de la red
async function marcar(guardada) {
  const h = new Headers(guardada.headers);
  const estado = Number(h.get("x-bitacora-estado")) || 200;
  h.set("x-bitacora-guardado", "1");
  return new Response(await guardada.blob(), { status: estado, headers: h });
}
