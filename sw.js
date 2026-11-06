// Guarda o "esqueleto" do app para ele abrir sem internet.
// Vídeos, letras e partituras ficam no armazenamento criptografado do app, não aqui.
const CACHE = "clube-app-v1";
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SHELL = [
  "./", "./index.html", "./app.js", "./firebase-config.js", "./manifest.webmanifest",
  "./logo.png", "./icon-192.png", "./icon-512.png",
  SDK + "firebase-app.js", SDK + "firebase-auth.js", SDK + "firebase-firestore.js", SDK + "firebase-storage.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const mine = url.origin === self.location.origin;
  const sdk = url.href.startsWith(SDK);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!mine && !sdk && !fonts) return; // Firebase (dados e arquivos) passa direto
  // Usa o que está guardado e atualiza por trás, para abrir rápido e offline
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: mine });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || (mine && e.request.mode === "navigate" ? c.match("./index.html") : Response.error());
  }));
});
