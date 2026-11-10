// Guarda o "esqueleto" do app para ele abrir sem internet.
// Com internet, busca sempre a versão mais nova; sem internet, usa a guardada.
// Vídeos, letras e partituras ficam no armazenamento criptografado do app, não aqui.
const CACHE = "clube-app-v14";
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SHELL = [
  "./", "./index.html", "./app.js", "./firebase-config.js", "./manifest.webmanifest",
  "./logo.png", "./pdf.min.js", "./pdf.worker.min.js", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  SDK + "firebase-app.js", SDK + "firebase-auth.js", SDK + "firebase-firestore.js", SDK + "firebase-storage.js"
];

self.addEventListener("install", e => {
  // guarda um por um, para um arquivo que falhe não travar a atualização
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
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
  if (mine) {
    // arquivos do app: internet primeiro, guardado se estiver sem conexão
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())));
    return;
  }
  // biblioteca do Firebase e fontes: não mudam, usa o guardado
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })));
});
