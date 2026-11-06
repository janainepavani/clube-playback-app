// App Clube Playback (Trio Playback) — versão 1
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy,
  onSnapshot, serverTimestamp, addDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref as sref, getBlob, uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_EMAIL = "janaine@janainepavani.com";
const OFFLINE_AFTER_DAYS = 7;   // offline libera depois do prazo de reembolso
const CHECK_EVERY_DAYS = 7;     // precisa se conectar a cada 7 dias

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const storage = getStorage(app);

/* ---------------- estado ---------------- */
const S = {
  user: null, profile: null, isAdmin: false, profileFromServer: false,
  songs: [], playlists: [], view: "catalog", songId: null, tab: "video", showKeys: false, addTo: false,
  plId: null, query: "", saved: new Set(), adminData: null, busy: {}
};
let unsub = [];
const DAY = 86400000;
const $ = id => document.getElementById(id);
const main = $("main");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mb = b => (b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB";
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };

let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }

/* ---------------- armazenamento local (criptografado) ---------------- */
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open("clube-offline", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idbDo(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction("files", mode); const st = t.objectStore("files"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); });
}
const idbGet = k => idb().then(d => new Promise((res, rej) => { const r = d.transaction("files").objectStore("files").get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idbPut = (k, v) => idbDo("readwrite", st => { st.put(v, k); });
const idbDel = k => idbDo("readwrite", st => { st.delete(k); });
const idbKeys = () => idb().then(d => new Promise((res, rej) => { const r = d.transaction("files").objectStore("files").getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idbClear = () => idbDo("readwrite", st => { st.clear(); });

const b64 = { to: buf => btoa(String.fromCharCode(...new Uint8Array(buf))), from: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
let cryptoKey = null;
async function getKey() {
  if (cryptoKey) return cryptoKey;
  let raw = ls.get("cp-k");
  if (!raw && navigator.onLine) {
    try { const snap = await getDoc(doc(db, "config", "offline")); if (snap.exists()) { raw = snap.data().k; ls.set("cp-k", raw); } } catch (e) {}
  }
  if (!raw) return null;
  cryptoKey = await crypto.subtle.importKey("raw", b64.from(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  return cryptoKey;
}
async function wipeOffline(reason) {
  try { await idbClear(); } catch (e) {}
  ls.del("cp-k"); cryptoKey = null; S.saved = new Set();
  if (reason) toast(reason);
}
async function refreshSaved() {
  try { const keys = await idbKeys(); S.saved = new Set(keys.filter(k => k.endsWith("|video")).map(k => k.replace(/\|video$/, ""))); } catch (e) { S.saved = new Set(); }
}
async function saveFile(id, blob) {
  const key = await getKey(); if (!key) throw new Error("O modo offline ainda não foi ativado no painel.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
  await idbPut(id, { iv, buf, type: blob.type || "", size: buf.byteLength, savedAt: Date.now() });
}
async function loadFile(id) {
  const rec = await idbGet(id); if (!rec) return null;
  const key = await getKey(); if (!key) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, key, rec.buf);
  return new Blob([plain], { type: rec.type || (id.endsWith("video") ? "video/mp4" : "image/jpeg") });
}

/* ---------------- regras de acesso offline ---------------- */
const lastCheck = () => +(ls.get("cp-check") || 0);
const activatedAt = () => { const t = S.profile && S.profile.activatedAt; return t && t.toMillis ? t.toMillis() : (t ? +t : Date.now()); };
const daysActive = () => Math.floor((Date.now() - activatedAt()) / DAY);
const canOffline = () => S.isAdmin || (S.profile && S.profile.status === "active" && (S.profile.offlineNow || daysActive() >= OFFLINE_AFTER_DAYS));
const checkExpired = () => !S.isAdmin && Date.now() - lastCheck() > CHECK_EVERY_DAYS * DAY;
function available(songId) {
  if (navigator.onLine) return true;
  return [...S.saved].some(k => k.startsWith(songId + "|")) && !checkExpired();
}

/* ---------------- arquivos (online ou do aparelho) ---------------- */
const blobCache = new Map();
async function fileBlob(path, offlineId) {
  if (offlineId && !checkExpired()) {
    try { const b = await loadFile(offlineId); if (b) return b; } catch (e) { console.warn(e); }
  }
  if (!navigator.onLine) return null;
  if (blobCache.has(path)) return blobCache.get(path);
  const b = await getBlob(sref(storage, path));
  blobCache.set(path, b);
  if (blobCache.size > 6) blobCache.delete(blobCache.keys().next().value);
  return b;
}
const urlCache = new Map();
function urlOf(blob, id) {
  if (urlCache.has(id) && urlCache.get(id).blob === blob) return urlCache.get(id).url;
  const url = URL.createObjectURL(blob); urlCache.set(id, { blob, url }); return url;
}

/* ---------------- autenticação e perfil ---------------- */
onAuthStateChanged(auth, async user => {
  unsub.forEach(f => f()); unsub = [];
  S.user = user; S.profile = null; S.profileFromServer = false;
  if (!user) { S.isAdmin = false; render(); return; }
  S.isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL && user.emailVerified;
  await refreshSaved();
  const uref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(uref);
    if (!snap.exists()) await createProfile(user);
  } catch (e) { console.warn(e); }
  unsub.push(onSnapshot(uref, { includeMetadataChanges: true }, async snap => {
    if (!snap.exists()) { if (navigator.onLine) await createProfile(user).catch(() => {}); return; }
    S.profile = snap.data();
    if (!snap.metadata.fromCache) {
      S.profileFromServer = true;
      if (S.profile.status === "active" || S.isAdmin) ls.set("cp-check", String(Date.now()));
      else if (S.saved.size || ls.get("cp-k")) await wipeOffline();
      if (S.profile.status === "pending") tryAutoActivate(user);
    }
    startData(); render();
  }, err => { console.warn(err); render(); }));
});

async function createProfile(user) {
  const email = (user.email || "").toLowerCase();
  let allowed = false;
  try { allowed = (await getDoc(doc(db, "allowed", email))).exists(); } catch (e) {}
  await setDoc(doc(db, "users", user.uid), {
    email, status: allowed ? "active" : "pending", createdAt: serverTimestamp(),
    ...(allowed ? { activatedAt: serverTimestamp() } : {}), prefKeys: {}
  });
}
async function tryAutoActivate(user) {
  try {
    const ok = (await getDoc(doc(db, "allowed", (user.email || "").toLowerCase()))).exists();
    if (ok) await updateDoc(doc(db, "users", user.uid), { status: "active", activatedAt: serverTimestamp() });
  } catch (e) {}
}

let dataStarted = false;
function startData() {
  const ok = S.isAdmin || (S.profile && S.profile.status === "active");
  if (!ok || dataStarted) return;
  dataStarted = true;
  unsub.push(onSnapshot(query(collection(db, "songs"), orderBy("name")), s => {
    S.songs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
    render();
  }, e => console.warn(e)));
  unsub.push(onSnapshot(collection(db, "users", S.user.uid, "playlists"), s => {
    S.playlists = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
    if (presOpen) renderPres();
    render();
  }, e => console.warn(e)));
  unsub.push(() => { dataStarted = false; });
}

/* ---------------- telas ---------------- */
const byId = id => S.songs.find(s => s.id === id);
const keyOf = s => (S.profile && S.profile.prefKeys && S.profile.prefKeys[s.id] && s.keys.some(k => k.key === S.profile.prefKeys[s.id])) ? S.profile.prefKeys[s.id] : (s.keys[0] && s.keys[0].key);
const keyData = (s, k) => s.keys.find(x => x.key === k) || s.keys[0];
const getPl = id => S.playlists.find(p => p.id === id);

function setConn() { const c = $("conn"); c.textContent = navigator.onLine ? "Online" : "Sem internet"; c.classList.toggle("off", !navigator.onLine); }
window.addEventListener("online", () => { setConn(); render(); });
window.addEventListener("offline", () => { setConn(); render(); });

function render() {
  setConn();
  const st = S.profile && S.profile.status;
  const inApp = S.user && (S.isAdmin || st === "active") && !(!navigator.onLine && checkExpired());
  $("dock").hidden = !inApp || S.view === "admin";
  document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-current", (b.dataset.v === S.view || (S.view === "song" && b.dataset.v === "catalog") || (S.view === "playlist" && b.dataset.v === "playlists")) ? "page" : "false"));
  if (!S.user) return paint(viewLogin());
  if (!S.profile && !S.isAdmin) return paint(`<div class="center muted">Carregando sua conta...</div>`);
  if (!navigator.onLine && checkExpired()) return paint(viewExpired());
  if (!S.isAdmin && st === "pending") return paint(viewPending());
  if (!S.isAdmin && st !== "active") return paint(viewBlocked());
  const v = { catalog: viewCatalog, song: viewSong, playlists: viewPlaylists, playlist: viewPlaylist, account: viewAccount, admin: viewAdmin }[S.view] || viewCatalog;
  paint(v());
  if (S.view === "song") mountSong();
}
// repinta sem destruir o vídeo que está tocando
function paint(html) {
  const keep = main.querySelector("#vbox");
  if (keep && S.view === "song" && main.dataset.view === "song" && main.dataset.song === S.songId) {
    const holder = document.createElement("div"); holder.innerHTML = html;
    const slot = holder.querySelector("#vbox"); if (slot) slot.replaceWith(keep);
    main.replaceChildren(...holder.childNodes);
  } else main.innerHTML = html;
  main.dataset.view = S.view; main.dataset.song = S.songId || "";
}

function viewLogin() {
  return `<form class="card" id="loginForm" style="margin-top:24px">
    <h1 class="title">Entre no Trio Playback</h1>
    <p class="muted small" style="margin:0">Use o mesmo e-mail da sua assinatura do Trio Playback.</p>
    <label for="em">E-mail</label><input class="field" id="em" type="email" autocomplete="email" required>
    <label for="pw">Senha</label><input class="field" id="pw" type="password" autocomplete="current-password" minlength="6" required>
    <button class="btn primary" type="submit" data-mode="in">Entrar</button>
    <button class="btn" type="submit" data-mode="up">Primeiro acesso: criar minha senha</button>
    <button class="link" type="button" data-a="reset">Esqueci minha senha</button>
  </form>`;
}
function viewPending() {
  return `<div class="card center stack"><h1 class="title">Aguardando liberação</h1>
    <p class="muted">Sua conta foi criada com ${esc(S.user.email)}. A Janaine vai conferir sua assinatura do Trio Playback e liberar o acesso. Assim que ela liberar, o app abre sozinho.</p>
    ${(S.user.email || "").toLowerCase() === ADMIN_EMAIL ? `<div class="card"><b>Janaine, confirme seu e-mail para abrir o painel</b><p class="small muted" style="margin:0">Toque em enviar, abra o e-mail que chegar, clique no link e volte aqui em Já confirmei.</p><div class="hrow" style="justify-content:center"><button class="btn sm primary" data-a="verify">Enviar e-mail de confirmação</button><button class="btn sm" data-a="verified">Já confirmei</button></div></div>` : ""}
    <div class="hrow" style="justify-content:center"><button class="btn" data-a="logout">Sair</button></div></div>`;
}
function viewBlocked() {
  return `<div class="card center stack"><h1 class="title">Acesso encerrado</h1>
    <p class="muted">Não encontramos uma assinatura ativa do Trio Playback para ${esc(S.user.email)}. As músicas salvas neste aparelho foram apagadas. Se você assinou de novo, fale com a Janaine.</p>
    <div class="hrow" style="justify-content:center"><button class="btn" data-a="logout">Sair</button></div></div>`;
}
function viewExpired() {
  return `<div class="card center stack"><h1 class="title">Conecte-se à internet</h1>
    <p class="muted">Faz mais de ${CHECK_EVERY_DAYS} dias que o app não confirma sua assinatura. Conecte o aparelho à internet por um instante e tudo volta a funcionar, inclusive offline.</p></div>`;
}

function viewCatalog() {
  const q = norm(S.query);
  const list = S.songs.filter(s => norm(s.name).includes(q));
  let html = `<h1 class="title">Trio Playback</h1>
    <p class="muted small" style="margin:4px 0 0">${S.songs.length} músicas${S.saved.size ? "  ·  " + S.saved.size + " tons salvos no aparelho" : ""}</p>
    <input class="search" id="q" type="search" placeholder="Buscar música" aria-label="Buscar música" value="${esc(S.query)}">`;
  if (!navigator.onLine) html += `<p class="note">Sem internet: só as músicas salvas no aparelho tocam.</p>`;
  if (!S.songs.length) html += `<p class="muted">${S.isAdmin ? "Nenhuma música ainda. Abra o Painel da Janaine, na aba Conta, para cadastrar a primeira." : "As músicas estão chegando. Volte em breve."}</p>`;
  let last = "";
  list.forEach(s => {
    const L = norm(s.name)[0].toUpperCase();
    if (L !== last) { if (last) html += `</div>`; html += `<div class="letter">${L}</div><div class="list">`; last = L; }
    const k = keyOf(s); const off = S.saved.has(s.id + "|" + k);
    html += `<button class="row ${available(s.id) ? "" : "locked"}" data-a="open" data-id="${s.id}"><span class="name">${esc(s.name)}</span>
      <span class="meta">${off ? `<span class="pill ok">Offline</span>` : ""}<span class="pill brass">${esc(k)}</span></span></button>`;
  });
  if (last) html += `</div>`;
  return html;
}

function viewSong() {
  const s = byId(S.songId); if (!s) { S.view = "catalog"; return viewCatalog(); }
  const k = keyOf(s); const offId = s.id + "|" + k; const off = S.saved.has(offId);
  const busy = S.busy[offId];
  return `<button class="link" data-a="nav" data-v="catalog">Voltar às músicas</button>
  <div class="stack" style="margin-top:12px">
    <div><h1 class="title">${esc(s.name)}</h1><p class="muted small" style="margin:4px 0 0">${s.bpm ? "BPM " + esc(s.bpm) + "  ·  " : ""}${s.keys.length} tons</p></div>
    <div class="hrow"><div><div class="small muted">Seu tom</div><div class="keychip">${esc(k)}</div></div>
      ${s.keys.length > 1 ? `<button class="link" data-a="showkeys">${S.showKeys ? "Fechar" : "Trocar tom"}</button>` : ""}</div>
    ${S.showKeys ? `<div class="hrow">${s.keys.map(x => `<button class="btn sm ${x.key === k ? "primary" : ""}" data-a="setkey" data-k="${esc(x.key)}">${esc(x.key)}</button>`).join("")}</div>
      <p class="note">O tom escolhido fica fixado para você e é o que aparece nas suas playlists.</p>` : ""}
    <div class="tabs" role="tablist">${[["video", "Vídeo"], ["letra", "Letra"], ["partitura", "Partitura"]].map(([v, l]) => `<button role="tab" aria-selected="${S.tab === v}" data-a="tab" data-t="${v}">${l}</button>`).join("")}</div>
    <div id="vbox" class="vbox"></div>
    <div id="doc"></div>
    <div class="card">
      <div class="hrow spread"><b>Adicionar a uma playlist</b><button class="link" data-a="addto">${S.addTo ? "Fechar" : "Escolher"}</button></div>
      ${S.addTo ? `<div class="list">${S.playlists.map(p => { const has = (p.items || []).includes(s.id); return `<button class="row" data-a="addpl" data-pl="${p.id}" ${has ? "disabled" : ""}><span class="name">${esc(p.name)}</span><span class="pill ${has ? "ok" : ""}">${has ? "Já está" : (p.items || []).length + " músicas"}</span></button>`; }).join("")}
        <form class="hrow" id="newPlFromSong"><input class="field" style="flex:1" id="newPlName" placeholder="Nome da nova playlist" aria-label="Nome da nova playlist"><button class="btn sm" type="submit">Criar e adicionar</button></form></div>` : ""}
    </div>
    <div class="card">
      <div class="hrow spread"><b>Usar sem internet</b>
        ${canOffline() ? (off ? `<button class="btn sm" data-a="unsave" data-id="${s.id}">Remover do aparelho</button>` : `<button class="btn sm primary" data-a="save" data-id="${s.id}" ${busy !== undefined || !navigator.onLine ? "disabled" : ""}>${busy !== undefined ? "Salvando " + Math.round(busy * 100) + "%" : "Salvar no aparelho"}</button>`) : `<span class="pill warn">Libera no ${OFFLINE_AFTER_DAYS + 1}º dia</span>`}</div>
      <p class="small muted" style="margin:0">${canOffline() ? "Vídeo, letra e partitura do tom " + esc(k) + " ficam guardados dentro do app, sem ir para a galeria." : "Faltam " + Math.max(1, OFFLINE_AFTER_DAYS - daysActive()) + " dias para liberar o modo offline. Até lá, tudo funciona com internet."}</p>
    </div>
  </div>`;
}
let mountedKey = null;
async function mountSong() {
  const s = byId(S.songId); if (!s) return;
  const k = keyOf(s); const kd = keyData(s, k); const offId = s.id + "|" + k;
  const box = $("vbox"); box.classList.toggle("mini", S.tab !== "video");
  const want = s.id + "|" + k;
  if (mountedKey !== want || !box.querySelector("video")) {
    mountedKey = want;
    if (!available(s.id) && !S.saved.has(offId)) { box.innerHTML = `<div class="empty">Sem internet, e este tom não está salvo no aparelho.</div>`; }
    else {
      box.innerHTML = `<div class="empty">Carregando o vídeo...</div>`;
      try {
        const b = await fileBlob(kd.video, S.saved.has(offId) ? offId + "|video" : null);
        if (mountedKey !== want) return;
        if (!b) { box.innerHTML = `<div class="empty">Não consegui abrir o vídeo agora.</div>`; }
        else { box.innerHTML = `<video controls playsinline preload="auto" src="${urlOf(b, offId + "|video")}"></video><span class="wm">${esc(S.user.email)}</span>`; videoFallback(box.querySelector("video"), b); }
      } catch (e) { console.warn(e); if (mountedKey === want) box.innerHTML = `<div class="empty">Não consegui abrir o vídeo. Confira a internet.</div>`; }
    }
  }
  const d = $("doc"); if (!d) return;
  if (S.tab === "video") { d.innerHTML = ""; return; }
  const path = S.tab === "letra" ? s.letra : kd.sheet;
  const oid = S.tab === "letra" ? s.id + "|letra" : offId + "|sheet";
  if (!path) { d.innerHTML = `<div class="empty">${S.tab === "letra" ? "Letra" : "Partitura"} ainda não disponível para esta música.</div>`; return; }
  d.innerHTML = `<div class="empty">Abrindo...</div>`;
  try {
    const b = await fileBlob(path, S.saved.has(offId) ? oid : null);
    if (!$("doc")) return;
    $("doc").innerHTML = b ? `<img class="sheet" alt="${S.tab === "letra" ? "Letra" : "Partitura"} de ${esc(s.name)}" src="${urlOf(b, oid)}">` : `<div class="empty">Sem internet, e isto não está salvo no aparelho.</div>`;
  } catch (e) { if ($("doc")) $("doc").innerHTML = `<div class="empty">Não consegui abrir agora.</div>`; }
}
// se o iPhone recusar o endereço blob, tenta com data URL
function videoFallback(v, blob) {
  if (!v) return;
  v.addEventListener("error", () => {
    if (v.dataset.fb) return; v.dataset.fb = "1";
    const fr = new FileReader(); fr.onload = () => { v.src = fr.result; }; fr.readAsDataURL(blob);
  }, { once: true });
}

async function saveSong(s, k) {
  const kd = keyData(s, k); const offId = s.id + "|" + k;
  if (S.saved.has(offId)) return;
  S.busy[offId] = 0; render();
  try {
    const jobs = [[kd.video, offId + "|video"], [kd.sheet, offId + "|sheet"], [s.letra, s.id + "|letra"]].filter(j => j[0]);
    let i = 0;
    for (const [path, id] of jobs) {
      const b = await getBlob(sref(storage, path));
      await saveFile(id, b); i++; S.busy[offId] = i / jobs.length; if (S.view === "song") render();
    }
    await refreshSaved();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  } catch (e) { toast(e.message && e.message.includes("offline") ? e.message : "Não consegui salvar. Confira a internet e tente de novo."); console.warn(e); }
  delete S.busy[offId]; render();
}
async function unsaveSong(s, k) {
  const offId = s.id + "|" + k;
  for (const p of ["|video", "|sheet"]) await idbDel(offId + p).catch(() => {});
  await refreshSaved();
  if (![...S.saved].some(x => x.startsWith(s.id + "|"))) await idbDel(s.id + "|letra").catch(() => {});
  render();
}

function viewPlaylists() {
  return `<h1 class="title">Minhas playlists</h1>
  <p class="muted small" style="margin:4px 0 14px">Monte a ordem do seu show e toque tudo daqui no dia do evento.</p>
  <div class="list">${S.playlists.map(p => `<button class="row" data-a="openpl" data-pl="${p.id}"><span class="name">${esc(p.name)}</span><span class="pill">${(p.items || []).length} músicas</span></button>`).join("") || `<p class="muted">Nenhuma playlist ainda.</p>`}</div>
  <form class="hrow" id="newPl" style="margin-top:14px"><input class="field" style="flex:1" id="plName" placeholder="Nome da nova playlist" aria-label="Nome da nova playlist"><button class="btn" type="submit">Criar playlist</button></form>`;
}
function viewPlaylist() {
  const p = getPl(S.plId); if (!p) { S.view = "playlists"; return viewPlaylists(); }
  const items = (p.items || []).filter(byId);
  const missing = items.filter(id => !S.saved.has(id + "|" + keyOf(byId(id))));
  return `<button class="link" data-a="nav" data-v="playlists">Voltar às playlists</button>
  <div class="stack" style="margin-top:12px">
    <div class="hrow spread"><h1 class="title">${esc(p.name)}</h1><button class="link" data-a="delpl">Apagar playlist</button></div>
    <button class="btn primary" data-a="present" ${items.length ? "" : "disabled"}>Iniciar modo apresentação</button>
    ${canOffline() && items.length ? (missing.length ? `<button class="btn" data-a="savepl" ${navigator.onLine ? "" : "disabled"}>Salvar a playlist no aparelho (${missing.length} ${missing.length === 1 ? "música" : "músicas"})</button>` : `<p class="note">Toda a playlist está salva no aparelho. Pode tocar sem internet.</p>`) : ""}
    <div class="list">${items.map((id, i) => { const s = byId(id); const k = keyOf(s); return `<div class="row ${available(id) ? "" : "locked"}">
      <span class="order">${i + 1}</span><span class="name">${esc(s.name)}<br><span class="small muted">tom ${esc(k)}${S.saved.has(id + "|" + k) ? "  ·  offline" : ""}</span></span>
      <span class="meta"><button class="btn sm ghost" data-a="mv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""}>Subir</button><button class="btn sm ghost" data-a="mv" data-i="${i}" data-d="1" ${i === items.length - 1 ? "disabled" : ""}>Descer</button><button class="btn sm ghost" data-a="rm" data-i="${i}">Tirar</button></span></div>`; }).join("")}</div>
    ${items.length ? "" : `<p class="muted">Playlist vazia. Abra uma música e escolha Adicionar a uma playlist.</p>`}
  </div>`;
}
async function savePlItems(p, items) { await updateDoc(doc(db, "users", S.user.uid, "playlists", p.id), { items, updatedAt: serverTimestamp() }); }

function viewAccount() {
  const left = Math.max(0, CHECK_EVERY_DAYS - Math.floor((Date.now() - lastCheck()) / DAY));
  return `<h1 class="title">Conta</h1>
  <div class="stack" style="margin-top:14px">
    <div class="card">
      <div class="hrow spread"><b>Trio Playback</b><span class="pill ok">${S.isAdmin ? "Administradora" : "Ativa"}</span></div>
      <p class="small muted" style="margin:0">${esc(S.user.email)}</p>
      <p class="small muted" style="margin:0">Modo offline: ${canOffline() ? "liberado" : "libera no " + (OFFLINE_AFTER_DAYS + 1) + "º dia de assinatura"}. ${canOffline() ? "Vale por mais " + left + (left === 1 ? " dia" : " dias") + " sem internet." : ""}</p>
      <p class="small muted" style="margin:0">${S.saved.size} ${S.saved.size === 1 ? "tom salvo" : "tons salvos"} neste aparelho.</p>
      <div class="hrow">${S.saved.size ? `<button class="btn sm" data-a="wipe">Apagar tudo do aparelho</button>` : ""}<button class="btn sm" data-a="logout">Sair</button></div>
    </div>
    ${(S.user.email || "").toLowerCase() === ADMIN_EMAIL ? (S.isAdmin ? `<button class="btn primary" data-a="nav" data-v="admin">Abrir o Painel da Janaine</button>`
      : `<div class="card"><b>Confirme seu e-mail para abrir o painel</b><p class="small muted" style="margin:0">Por segurança, o painel só abre depois que você confirma o e-mail ${ADMIN_EMAIL}.</p>
        <div class="hrow"><button class="btn sm" data-a="verify">Enviar e-mail de confirmação</button><button class="btn sm" data-a="verified">Já confirmei</button></div></div>`) : ""}
  </div>`;
}

/* ---------------- Painel da Janaine ---------------- */
let adminForm = null; // música sendo editada
let adminLoading = false;
async function loadAdmin() {
  const [pend, act, allowed, cfg] = await Promise.all([
    getDocs(query(collection(db, "users"), where("status", "==", "pending"))),
    getDocs(query(collection(db, "users"), where("status", "==", "active"))),
    getDocs(collection(db, "allowed")),
    getDoc(doc(db, "config", "offline"))
  ]);
  S.adminData = {
    pending: pend.docs.map(d => ({ uid: d.id, ...d.data() })),
    active: act.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email)),
    allowed: allowed.docs.map(d => d.id).sort(),
    hasKey: cfg.exists()
  };
  render();
}
function viewAdmin() {
  if (!S.isAdmin) { S.view = "account"; return viewAccount(); }
  if (!S.adminData) { if (!adminLoading) { adminLoading = true; loadAdmin().catch(e => toast("Erro ao abrir o painel: " + e.message)).finally(() => { adminLoading = false; }); } return `<div class="center muted">Abrindo o painel...</div>`; }
  const A = S.adminData;
  if (adminForm) return viewSongForm();
  return `<button class="link" data-a="nav" data-v="account">Voltar ao app</button>
  <div class="stack" style="margin-top:12px">
    <div class="hrow spread"><h1 class="title">Painel da Janaine</h1><button class="btn sm" data-a="adminreload">Atualizar</button></div>
    ${A.hasKey ? "" : `<div class="card"><b>Ative o modo offline</b><p class="small muted" style="margin:0">Cria a chave que embaralha os vídeos salvos nos aparelhos. Faça isso uma vez só.</p><button class="btn primary" data-a="mkkey">Ativar modo offline</button></div>`}
    <div class="card"><div class="hrow spread"><b>Pedidos de acesso</b><span class="pill ${A.pending.length ? "warn" : ""}">${A.pending.length}</span></div>
      ${A.pending.length ? `<div class="list">${A.pending.map(u => `<div class="row"><span class="name">${esc(u.email)}</span><span class="meta"><button class="btn sm primary" data-a="approve" data-uid="${u.uid}" data-em="${esc(u.email)}">Liberar</button><button class="btn sm danger" data-a="deny" data-uid="${u.uid}">Recusar</button></span></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">Nenhum pedido esperando.</p>`}
    </div>
    <div class="card"><div class="hrow spread"><b>Assinantes com acesso</b><span class="pill ok">${A.active.length}</span></div>
      <div class="list">${A.active.map(u => `<div class="row"><span class="name">${esc(u.email)}</span><span class="meta">${u.email === ADMIN_EMAIL ? `<span class="pill brass">você</span>` : `<button class="btn sm danger" data-a="revoke" data-uid="${u.uid}" data-em="${esc(u.email)}">Tirar acesso</button>`}</span></div>`).join("") || `<p class="small muted" style="margin:0">Ninguém ainda.</p>`}</div>
    </div>
    <div class="card"><b>E-mails autorizados</b>
      <p class="small muted" style="margin:0">Cole aqui os e-mails das assinantes do Trio, um por linha. Quem estiver nesta lista entra direto, sem esperar.</p>
      <textarea class="field" id="emails" rows="4" placeholder="maria@exemplo.com"></textarea>
      <button class="btn" data-a="addemails">Adicionar à lista</button>
      <details><summary class="small muted">Ver lista (${A.allowed.length})</summary><div class="list" style="margin-top:8px">${A.allowed.map(e => `<div class="row"><span class="name small">${esc(e)}</span><button class="btn sm ghost" data-a="rmallowed" data-em="${esc(e)}">Remover</button></div>`).join("")}</div></details>
    </div>
    <div class="card"><div class="hrow spread"><b>Músicas</b><button class="btn sm primary" data-a="newsong">Nova música</button></div>
      <div class="list">${S.songs.map(s => `<div class="row"><span class="name">${esc(s.name)}<br><span class="small muted">${s.keys.map(k => esc(k.key)).join(" / ")}${s.bpm ? "  ·  BPM " + esc(s.bpm) : ""}</span></span><span class="meta"><button class="btn sm" data-a="editsong" data-id="${s.id}">Editar</button></span></div>`).join("") || `<p class="small muted" style="margin:0">Nenhuma música cadastrada.</p>`}</div>
    </div>
  </div>`;
}
function viewSongForm() {
  const f = adminForm;
  return `<button class="link" data-a="cancelsong">Voltar ao painel</button>
  <form class="stack" id="songForm" style="margin-top:12px">
    <h1 class="title">${f.id ? "Editar música" : "Nova música"}</h1>
    <div class="card">
      <label for="sName">Nome da música</label><input class="field" id="sName" value="${esc(f.name)}" required ${f.id ? "readonly" : ""}>
      <label for="sBpm">BPM</label><input class="field" id="sBpm" inputmode="numeric" value="${esc(f.bpm || "")}">
      <label for="sLetra">Letra (imagem JPG ou PNG)${f.letra ? "  ·  já enviada" : ""}</label><input class="field" id="sLetra" type="file" accept="image/*">
    </div>
    ${f.keys.map((k, i) => `<div class="card"><div class="hrow spread"><b>Tom ${i + 1}</b>${f.keys.length > 1 ? `<button class="link" type="button" data-a="rmkey" data-i="${i}">Tirar este tom</button>` : ""}</div>
      <label for="k${i}">Tonalidade (ex.: Cm)</label><input class="field" id="k${i}" value="${esc(k.key)}" required>
      <label for="v${i}">Vídeo 720p (MP4)${k.video ? "  ·  já enviado" : ""}</label><input class="field" id="v${i}" type="file" accept="video/mp4">
      <label for="p${i}">Partitura (imagem JPG ou PNG)${k.sheet ? "  ·  já enviada" : ""}</label><input class="field" id="p${i}" type="file" accept="image/*">
    </div>`).join("")}
    <button class="btn" type="button" data-a="addkey">Adicionar outro tom</button>
    <div class="bar" id="upBar" hidden><i></i></div><p class="small muted" id="upMsg" style="margin:0"></p>
    <button class="btn primary" type="submit">Salvar música</button>
    ${f.id ? `<button class="btn danger" type="button" data-a="delsong">Apagar esta música do catálogo</button>` : ""}
  </form>`;
}
function readForm() {
  const f = adminForm; if (!$("sName")) return;
  f.name = $("sName").value.trim(); f.bpm = $("sBpm").value.trim();
  f.keys.forEach((k, i) => { k.key = $("k" + i).value.trim(); k._v = $("v" + i).files[0]; k._p = $("p" + i).files[0]; });
  f._l = $("sLetra").files[0];
}
function upload(path, file, onProg) {
  return new Promise((res, rej) => {
    const t = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });
    t.on("state_changed", s => onProg(s.bytesTransferred / s.totalBytes), rej, () => res(path));
  });
}
async function submitSong() {
  readForm(); const f = adminForm;
  if (!f.name || f.keys.some(k => !k.key)) return toast("Preencha o nome e as tonalidades.");
  if (f.keys.some(k => !k.video && !k._v)) return toast("Cada tom precisa de um vídeo.");
  const id = f.id || slug(f.name);
  if (!f.id && byId(id)) return toast("Já existe uma música com esse nome.");
  const jobs = [];
  if (f._l) jobs.push(["letra", f._l, `songs/${id}/letra.${(f._l.name.split(".").pop() || "jpg").toLowerCase()}`]);
  f.keys.forEach((k, i) => {
    const ks = slug(k.key) || "tom" + i;
    if (k._v) jobs.push(["v" + i, k._v, `songs/${id}/${ks}-video.mp4`]);
    if (k._p) jobs.push(["p" + i, k._p, `songs/${id}/${ks}-partitura.${(k._p.name.split(".").pop() || "jpg").toLowerCase()}`]);
  });
  const bar = $("upBar"), msg = $("upMsg"); bar.hidden = false;
  const total = jobs.reduce((a, j) => a + j[1].size, 0) || 1; let done = 0;
  try {
    for (const [tag, file, path] of jobs) {
      msg.textContent = "Enviando " + file.name + "...";
      await upload(path, file, p => { bar.firstElementChild.style.width = ((done + p * file.size) / total * 100) + "%"; });
      done += file.size;
      if (tag === "letra") f.letra = path;
      else { const i = +tag.slice(1); if (tag[0] === "v") f.keys[i].video = path; else f.keys[i].sheet = path; }
    }
    await setDoc(doc(db, "songs", id), {
      name: f.name, bpm: f.bpm || null, letra: f.letra || null,
      keys: f.keys.map(k => ({ key: k.key, video: k.video, sheet: k.sheet || null })), updatedAt: serverTimestamp()
    });
    toast("Música salva."); adminForm = null; render();
  } catch (e) { console.warn(e); msg.textContent = "Erro ao enviar: " + (e.code || e.message) + ". Confira se o armazenamento do Firebase já foi ativado."; }
}

/* ---------------- modo apresentação ---------------- */
let presOpen = false, presIdx = 0, presReorder = false, presLyrics = false, presReady = false;
const pres = $("pres"), presIn = $("presIn");
function openPres() { presOpen = true; presIdx = 0; presReorder = false; presReady = false; pres.classList.add("show"); document.body.style.overflow = "hidden"; renderPres(); }
function closePres() { presOpen = false; const v = presIn.querySelector("video"); if (v) v.pause(); pres.classList.remove("show"); presIn.innerHTML = ""; document.body.style.overflow = ""; presMounted = null; render(); }
let presMounted = null;
function renderPres() {
  const p = getPl(S.plId); if (!p) return closePres();
  const items = (p.items || []).filter(byId); if (!items.length) return closePres();
  presIdx = Math.min(presIdx, items.length - 1);
  const s = byId(items[presIdx]); const k = keyOf(s);
  const next = items.slice(presIdx + 1, presIdx + 4);
  const keepV = presIn.querySelector("#pv");
  presIn.innerHTML = `
    <div class="hrow spread"><span class="small muted">${esc(p.name)}  ·  música ${presIdx + 1} de ${items.length}</span><button class="btn sm" data-a="closepres">Sair</button></div>
    <div><div class="now">${esc(s.name)}</div><div class="hrow" style="margin-top:8px"><span class="keychip">${esc(k)}</span>${s.bpm ? `<span class="muted">BPM ${esc(s.bpm)}</span>` : ""}${presReady ? `<span class="pill ok">Pronta. Toque quando quiser.</span>` : ""}</div></div>
    <div id="pvslot"></div>
    <div class="ctl"><button class="btn" data-a="pgo" data-d="-1" ${presIdx === 0 ? "disabled" : ""}>Anterior</button><button class="btn primary" data-a="pgo" data-d="1" ${presIdx === items.length - 1 ? "disabled" : ""}>Próxima</button></div>
    <div class="hrow"><button class="btn sm ghost" data-a="plyr">${presLyrics ? "Esconder letra" : "Mostrar letra"}</button><button class="btn sm ghost" data-a="pre">${presReorder ? "Concluir ordem" : "Reordenar a playlist"}</button></div>
    <div id="plyrslot"></div>
    <div><div class="small muted" style="margin-bottom:6px">${presReorder ? "Toque em Subir ou Descer. A música atual não muda." : "A seguir"}</div>
      <div class="list">${presReorder
        ? items.map((x, i) => `<div class="row" ${i === presIdx ? 'style="border-color:var(--bronze)"' : ""}><span class="order">${i + 1}</span><span class="name">${esc(byId(x).name)}</span><span class="meta"><button class="btn sm ghost" data-a="pmv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""}>Subir</button><button class="btn sm ghost" data-a="pmv" data-i="${i}" data-d="1" ${i === items.length - 1 ? "disabled" : ""}>Descer</button></span></div>`).join("")
        : (next.length ? next.map((x, i) => `<button class="row ${available(x) ? "" : "locked"}" data-a="pjump" data-i="${presIdx + 1 + i}"><span class="order">${presIdx + 2 + i}</span><span class="name">${esc(byId(x).name)}</span><span class="pill brass">${esc(keyOf(byId(x)))}</span></button>`).join("") : `<p class="muted">Esta é a última música.</p>`)}</div></div>`;
  const slot = $("pvslot");
  const want = s.id + "|" + k;
  if (keepV && presMounted === want) slot.replaceWith(keepV);
  else { const box = document.createElement("div"); box.id = "pv"; box.className = "vbox"; box.innerHTML = `<div class="empty">Carregando o vídeo...</div>`; slot.replaceWith(box); presMounted = want; loadPresVideo(s, k, box, want); }
  if (presLyrics && s.letra) {
    fileBlob(s.letra, S.saved.has(want) ? s.id + "|letra" : null).then(b => { const el = $("plyrslot"); if (el && b) el.innerHTML = `<img class="sheet" alt="Letra de ${esc(s.name)}" src="${urlOf(b, s.id + "|letra")}">`; }).catch(() => {});
  }
  const n = items[presIdx + 1]; // pré-carrega a próxima
  if (n) { const ns = byId(n), nk = keyOf(ns), nkd = keyData(ns, nk); fileBlob(nkd.video, S.saved.has(n + "|" + nk) ? n + "|" + nk + "|video" : null).catch(() => {}); }
}
async function loadPresVideo(s, k, box, want) {
  const kd = keyData(s, k); const offId = want;
  try {
    const b = await fileBlob(kd.video, S.saved.has(offId) ? offId + "|video" : null);
    if (presMounted !== want) return;
    if (!b) { box.innerHTML = `<div class="empty">Esta música não pode tocar agora: sem internet e não salva no aparelho.</div>`; return; }
    box.innerHTML = `<video controls playsinline preload="auto" src="${urlOf(b, offId + "|video")}"></video><span class="wm">${esc(S.user.email)}</span>`;
    const v = box.querySelector("video"); videoFallback(v, b);
    v.addEventListener("play", () => { if (presReady) { presReady = false; const pl = presIn.querySelector(".pill.ok"); if (pl) pl.remove(); } });
    v.addEventListener("ended", () => { const p = getPl(S.plId); const items = (p.items || []).filter(byId); if (presIdx < items.length - 1) { presIdx++; presReady = true; renderPres(); } });
  } catch (e) { if (presMounted === want) box.innerHTML = `<div class="empty">Não consegui abrir o vídeo.</div>`; }
}

/* ---------------- ações ---------------- */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-a]"); if (!el) return;
  const a = el.dataset.a;
  try {
    if (a === "nav") { S.view = el.dataset.v; S.addTo = false; S.showKeys = false; if (S.view === "admin") { S.adminData = null; adminForm = null; } mountedKey = null; render(); window.scrollTo(0, 0); }
    else if (a === "open") { S.songId = el.dataset.id; S.view = "song"; S.tab = "video"; S.showKeys = false; S.addTo = false; mountedKey = null; render(); window.scrollTo(0, 0); }
    else if (a === "tab") { S.tab = el.dataset.t; render(); }
    else if (a === "showkeys") { S.showKeys = !S.showKeys; render(); }
    else if (a === "setkey") { const k = el.dataset.k; S.profile.prefKeys = { ...(S.profile.prefKeys || {}), [S.songId]: k }; S.showKeys = false; mountedKey = null; render(); updateDoc(doc(db, "users", S.user.uid), { prefKeys: S.profile.prefKeys }).catch(() => {}); toast("Tom " + k + " fixado para esta música."); }
    else if (a === "addto") { S.addTo = !S.addTo; render(); }
    else if (a === "addpl") { const p = getPl(el.dataset.pl); await savePlItems(p, [...(p.items || []), S.songId]); toast("Adicionada à playlist " + p.name + "."); }
    else if (a === "save") { const s = byId(el.dataset.id); saveSong(s, keyOf(s)); }
    else if (a === "unsave") { const s = byId(el.dataset.id); await unsaveSong(s, keyOf(s)); toast("Removida do aparelho."); }
    else if (a === "openpl") { S.plId = el.dataset.pl; S.view = "playlist"; render(); window.scrollTo(0, 0); }
    else if (a === "delpl") { await deleteDoc(doc(db, "users", S.user.uid, "playlists", S.plId)); S.view = "playlists"; render(); toast("Playlist apagada."); }
    else if (a === "mv") { const p = getPl(S.plId); const it = (p.items || []).filter(byId); const i = +el.dataset.i, j = i + +el.dataset.d; [it[i], it[j]] = [it[j], it[i]]; await savePlItems(p, it); }
    else if (a === "rm") { const p = getPl(S.plId); const it = (p.items || []).filter(byId); it.splice(+el.dataset.i, 1); await savePlItems(p, it); }
    else if (a === "savepl") { const p = getPl(S.plId); for (const id of (p.items || []).filter(byId)) { const s = byId(id); await saveSong(s, keyOf(s)); } toast("Playlist salva no aparelho."); }
    else if (a === "present") openPres();
    else if (a === "closepres") closePres();
    else if (a === "pgo") { presIdx += +el.dataset.d; presReady = false; renderPres(); }
    else if (a === "pjump") { presIdx = +el.dataset.i; presReady = false; renderPres(); }
    else if (a === "pre") { presReorder = !presReorder; renderPres(); }
    else if (a === "plyr") { presLyrics = !presLyrics; renderPres(); }
    else if (a === "pmv") { const p = getPl(S.plId); const it = (p.items || []).filter(byId); const cur = it[presIdx]; const i = +el.dataset.i, j = i + +el.dataset.d; [it[i], it[j]] = [it[j], it[i]]; presIdx = it.indexOf(cur); p.items = it; renderPres(); await savePlItems(p, it); }
    else if (a === "wipe") { await wipeOffline("Tudo apagado deste aparelho."); render(); }
    else if (a === "logout") { await wipeOffline(); await signOut(auth); }
    else if (a === "reset") { const em = $("em").value.trim(); if (!em) return toast("Digite seu e-mail primeiro."); await sendPasswordResetEmail(auth, em); toast("Enviamos um e-mail para criar uma nova senha."); }
    else if (a === "verify") { await sendEmailVerification(S.user); toast("E-mail de confirmação enviado. Abra sua caixa de entrada."); }
    else if (a === "verified") { await S.user.reload(); await S.user.getIdToken(true); S.isAdmin = S.user.emailVerified && S.user.email.toLowerCase() === ADMIN_EMAIL; if (S.isAdmin) { if (S.profile && S.profile.status !== "active") await updateDoc(doc(db, "users", S.user.uid), { status: "active", activatedAt: serverTimestamp() }); await setDoc(doc(db, "allowed", ADMIN_EMAIL), { addedAt: serverTimestamp() }); startData(); } toast(S.isAdmin ? "Confirmado. O painel está liberado." : "Ainda não aparece como confirmado."); render(); }
    // painel
    else if (a === "adminreload") { S.adminData = null; render(); }
    else if (a === "mkkey") { const k = crypto.getRandomValues(new Uint8Array(32)); await setDoc(doc(db, "config", "offline"), { k: b64.to(k), createdAt: serverTimestamp() }); toast("Modo offline ativado."); S.adminData = null; render(); }
    else if (a === "approve") { const em = el.dataset.em; await setDoc(doc(db, "allowed", em), { addedAt: serverTimestamp() }); await updateDoc(doc(db, "users", el.dataset.uid), { status: "active", activatedAt: serverTimestamp() }); toast("Acesso liberado para " + em + "."); S.adminData = null; render(); }
    else if (a === "deny") { await updateDoc(doc(db, "users", el.dataset.uid), { status: "blocked" }); toast("Pedido recusado."); S.adminData = null; render(); }
    else if (a === "revoke") { const em = el.dataset.em; await deleteDoc(doc(db, "allowed", em)).catch(() => {}); await updateDoc(doc(db, "users", el.dataset.uid), { status: "blocked" }); toast("Acesso retirado de " + em + ". O conteúdo salvo some na próxima conexão dela."); S.adminData = null; render(); }
    else if (a === "addemails") { const list = [...new Set(($("emails").value.match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) || []).map(x => x.toLowerCase()))]; if (!list.length) return toast("Nenhum e-mail encontrado no texto."); for (const em of list) await setDoc(doc(db, "allowed", em), { addedAt: serverTimestamp() }); toast(list.length + (list.length === 1 ? " e-mail adicionado." : " e-mails adicionados.")); S.adminData = null; render(); }
    else if (a === "rmallowed") { await deleteDoc(doc(db, "allowed", el.dataset.em)); S.adminData = null; render(); }
    else if (a === "newsong") { adminForm = { name: "", bpm: "", letra: null, keys: [{ key: "", video: null, sheet: null }, { key: "", video: null, sheet: null }] }; render(); window.scrollTo(0, 0); }
    else if (a === "editsong") { const s = byId(el.dataset.id); adminForm = JSON.parse(JSON.stringify({ id: s.id, name: s.name, bpm: s.bpm, letra: s.letra, keys: s.keys })); render(); window.scrollTo(0, 0); }
    else if (a === "addkey") { readForm(); adminForm.keys.push({ key: "", video: null, sheet: null }); render(); }
    else if (a === "rmkey") { readForm(); adminForm.keys.splice(+el.dataset.i, 1); render(); }
    else if (a === "cancelsong") { adminForm = null; render(); }
    else if (a === "delsong") { await deleteDoc(doc(db, "songs", adminForm.id)); adminForm = null; toast("Música apagada do catálogo."); render(); }
  } catch (err) { console.warn(err); toast("Algo deu errado: " + (err.code || err.message)); }
});

const AUTH_ERR = {
  "auth/invalid-credential": "E-mail ou senha incorretos.", "auth/wrong-password": "Senha incorreta.", "auth/user-not-found": "Não existe conta com esse e-mail. Use Primeiro acesso.",
  "auth/email-already-in-use": "Esse e-mail já tem conta. Use Entrar.", "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/invalid-email": "Esse e-mail não parece válido.", "auth/network-request-failed": "Sem internet. Conecte-se para entrar.", "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos."
};
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    if (f.id === "loginForm") {
      const mode = e.submitter && e.submitter.dataset.mode; const em = $("em").value.trim(), pw = $("pw").value;
      if (mode === "up") await createUserWithEmailAndPassword(auth, em, pw); else await signInWithEmailAndPassword(auth, em, pw);
    } else if (f.id === "newPl" || f.id === "newPlFromSong") {
      const name = f.querySelector("input").value.trim(); if (!name) return toast("Dê um nome para a playlist.");
      const r = await addDoc(collection(db, "users", S.user.uid, "playlists"), { name, items: f.id === "newPlFromSong" ? [S.songId] : [], updatedAt: serverTimestamp() });
      toast("Playlist " + name + " criada."); if (f.id === "newPl") { S.plId = r.id; S.view = "playlist"; render(); }
    } else if (f.id === "songForm") await submitSong();
  } catch (err) { console.warn(err); toast(AUTH_ERR[err.code] || "Algo deu errado: " + (err.code || err.message)); }
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { S.query = e.target.value; const pos = e.target.selectionStart; render(); const q = $("q"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} } }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
