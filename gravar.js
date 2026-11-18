// Estúdio de gravação: a cantora grava a própria voz e a câmera com o playback no fone.
// O app guarda duas faixas separadas (câmera + voz, e o áudio limpo do playback),
// deixa ajustar volume e sincronia, e depois junta tudo num vídeo só.
//
// Linha do tempo: "offset" = em que segundo da gravação da câmera o playback começa.
// Na mixagem final, a voz e a imagem começam em 0 e o playback entra em "offset".

const LS_FIX = "cp-rec-fix";   // ajuste de sincronia que a pessoa fez (fica guardado no aparelho)
const LS_VOL = "cp-rec-vol";

let ctx = null;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
const fmtT1 = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + (s % 60).toFixed(1).padStart(4, "0").replace(".", ","); };
// Mantém o vídeo junto com o som sem pular: só ajusta a velocidade um pouquinho.
// Pular (mudar currentTime) faz o iPhone travar a imagem, então só pula se estiver mais de 1 segundo fora.
function follow(v, target) {
  const d = v.currentTime - target;
  if (Math.abs(d) > 1) { v.currentTime = target; v.playbackRate = 1; return; }
  const r = Math.abs(d) < 0.03 ? 1 : Math.max(0.92, Math.min(1.08, 1 - d * 0.8));
  if (Math.abs(v.playbackRate - r) > 0.005) v.playbackRate = r;
}
const ms = s => (s >= 0 ? "+" : "−") + Math.round(Math.abs(s) * 1000) + " ms";
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

function audioCtx() {
  if (!ctx || ctx.state === "closed") {
    const AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ sampleRate: 48000 }); } catch (e) { ctx = new AC(); }
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}
// Depois que o microfone desliga, o iPhone continua no modo "ligação" (som abafado e saindo pelo alto-falante de cima).
// Para ouvir e montar o vídeo com qualidade de música, volta para o modo de reprodução e cria um áudio novo, em 48 kHz.
async function freshAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  try { if (ctx) await ctx.close(); } catch (e) {}
  ctx = null; return audioCtx();
}
function pickMime() {
  const opts = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const m of opts) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return "";
}
// envelope de volume (picos) para desenhar a onda: RATE pontos por segundo
const RATE = 200;
function envelope(buf) {
  const ch = buf.getChannelData(0), ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const step = Math.max(1, Math.floor(buf.sampleRate / RATE)); const n = Math.ceil(ch.length / step);
  const out = new Float32Array(n); let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0; const end = Math.min(ch.length, (i + 1) * step);
    for (let j = i * step; j < end; j++) { const v = Math.abs(ch[j]) + (ch2 ? Math.abs(ch2[j]) : 0); if (v > m) m = v; }
    out[i] = m; if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

const CSS = `
.st{position:fixed;inset:0;z-index:30;background:#060505;color:var(--cream);overflow:auto;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.st-in{max-width:960px;margin:0 auto;padding:14px 16px 30px;display:flex;flex-direction:column;gap:14px}
.st-cam{position:relative;background:#000;border-radius:14px;overflow:hidden;display:grid;place-items:center;min-height:200px;max-height:72vh}
.st-cam video.cam{width:100%;max-height:72vh;object-fit:contain;display:block}
.st-cam video.cam.mirror{transform:scaleX(-1)}
.st-pip{position:absolute;width:38%;max-width:260px;border-radius:10px;overflow:hidden;box-shadow:0 6px 20px #000d;border:2px solid #c49a6c;background:#000;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;z-index:2}
.st-pip video{pointer-events:none}
.st-pip video{width:100%;display:block}
.st-pip.l1{width:66%;max-width:520px}
.st-pip.l2{width:100%;max-width:none}
.st-rec{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#b3261e;color:#fff;font-weight:700;font-size:14px;padding:4px 12px;border-radius:99px;display:none}
.st-rec.on{display:block}
.st-count{position:absolute;inset:0;display:none;place-items:center;font-size:96px;font-weight:700;color:#fff;text-shadow:0 4px 20px #000}
.st-count.on{display:grid}
.st-big{font-size:18px;padding:16px;border-radius:14px}
.st-rec-btn{background:#b3261e;border-color:#b3261e;color:#fff}
.lanes{display:flex;flex-direction:column;gap:6px;user-select:none;-webkit-user-select:none;touch-action:none}
.lane{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.lane canvas{display:block;width:100%;height:64px}
.lane span{position:absolute;left:8px;top:4px;font-size:11px;font-weight:600;color:var(--muted);pointer-events:none}
.lane.drag{border-color:var(--bronze);cursor:grab}
.lane.drag:active{cursor:grabbing}
.mixrow{display:grid;grid-template-columns:90px 1fr 48px;align-items:center;gap:10px}
.mixrow input{width:100%;accent-color:var(--bronze)}
.mixrow output{font-variant-numeric:tabular-nums;text-align:right;font-size:14px;color:var(--muted)}
.nudges{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.nudges .btn{min-width:64px}
.syncval{font-variant-numeric:tabular-nums;font-weight:700;color:var(--bronze)}
.tl{position:relative;height:60px;margin:10px 18px 6px;border-radius:6px;background:#1d1a18;touch-action:none;user-select:none;-webkit-user-select:none}
.tl canvas{position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:6px}
.tl-dim{position:absolute;top:0;bottom:0;background:#000000c0;pointer-events:none}
.tl-sel{position:absolute;top:-4px;bottom:-4px;border-top:4px solid var(--bronze);border-bottom:4px solid var(--bronze);pointer-events:none}
.tl-h{position:absolute;top:-4px;bottom:-4px;width:18px;background:var(--bronze);pointer-events:auto;touch-action:none;cursor:ew-resize}
.tl-h.a{left:-18px;border-radius:9px 0 0 9px}.tl-h.b{right:-18px;border-radius:0 9px 9px 0}
.tl-h::after{content:"";position:absolute;left:7px;top:32%;bottom:32%;width:4px;border-radius:2px;background:#1a120a}
.tl-head{position:absolute;top:-10px;bottom:-10px;width:3px;margin-left:-1.5px;background:#fff;border-radius:2px;pointer-events:none;box-shadow:0 0 6px #000}
.tl-info{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.tl-info b{color:var(--cream)}
.transport{display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap}
.transport .btn{min-width:56px}
.transport .play{min-width:110px}
.scrub{width:100%;accent-color:var(--bronze)}
.tbig{font-variant-numeric:tabular-nums;font-size:20px;font-weight:700;text-align:center}
.st-result video{width:100%;max-height:70vh;background:#000;border-radius:12px;display:block}
`;

// ---------- projetos guardados no aparelho (várias vozes) ----------
// "meta": ajustes do projeto por música e tom; "blobs": o vídeo de cada voz.
let gdb = null;
function recDb() {
  if (!gdb) gdb = new Promise((res, rej) => {
    const r = indexedDB.open("clube-gravacoes", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("meta"); r.result.createObjectStore("blobs"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return gdb;
}
async function dbGet(store, k) { const d = await recDb(); return new Promise((res, rej) => { const q = d.transaction(store).objectStore(store).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbPut(store, k, v) { const d = await recDb(); return new Promise((res, rej) => { const t = d.transaction(store, "readwrite"); t.objectStore(store).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function dbDel(store, k) { const d = await recDb(); return new Promise((res, rej) => { const t = d.transaction(store, "readwrite"); t.objectStore(store).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

const MAX_VOZES = 4;
// tela dividida automática: 2 vozes em pé = uma em cima da outra; deitado = lado a lado; 3 = faixas; 4 = grade 2x2
function layout(n, W, H) {
  const gap = 4, port = H > W; let cols = 1, rows = 1;
  if (n === 2) { cols = port ? 1 : 2; rows = port ? 2 : 1; }
  else if (n === 3) { cols = port ? 1 : 3; rows = port ? 3 : 1; }
  else if (n >= 4) { cols = 2; rows = 2; }
  const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows, out = [];
  for (let i = 0; i < n; i++) { const c = i % cols, r = Math.floor(i / cols); out.push({ x: c * (cw + gap), y: r * (ch + gap), w: cw, h: ch }); }
  return out;
}
// desenha o vídeo preenchendo o quadro (recorta o que sobra, sem deformar)
function drawCover(g, v, r) {
  const vw = v.videoWidth || 16, vh = v.videoHeight || 9, sc = Math.max(r.w / vw, r.h / vh);
  g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  g.drawImage(v, r.x + (r.w - vw * sc) / 2, r.y + (r.h - vh * sc) / 2, vw * sc, vh * sc); g.restore();
}
function startAt(s, when, tIn) { if (tIn >= 0) { if (tIn < s.buffer.duration) s.start(when, tIn); } else s.start(when - tIn, 0); }

export async function openStudio({ song, keyName, videoBlob, email, toast }) {
  if (!document.getElementById("st-css")) { const s = el("style"); s.id = "st-css"; s.textContent = CSS + `
.st-grid{position:relative;background:#000;border-radius:14px;overflow:hidden;margin:0 auto;max-width:100%}
.st-grid video{position:absolute;object-fit:cover;background:#000}
.voz{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.voz b{flex:1 1 auto}
.voz label{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--cream)}
.voz input[type=checkbox]{width:18px;height:18px;accent-color:var(--bronze)}`; document.head.appendChild(s); }
  const root = el("div", "st"); const box = el("div", "st-in"); root.appendChild(box); document.body.appendChild(root);
  document.body.style.overflow = "hidden";

  const PKEY = song.id + "|" + keyName;
  let camStream = null, recorder = null, chunks = [], wake = null, closed = false;
  let pbBuf = null, trimA = 0, trimB = 0;
  const fade = Object.assign({ i: 1, o: 2 }, (() => { try { return JSON.parse(lsGet("cp-rec-fade") || "{}"); } catch (e) { return {}; } })());
  let pbSrc = null, monitors = [], offsetAuto = 0;
  let pipVideo = null, pipUrl = URL.createObjectURL(videoBlob), pipPos = null, pipLevel = 0;
  let facing = lsGet("cp-rec-cam") === "environment" ? "environment" : "user";
  // vozes gravadas: { id, blob, url, buf, env, auto, fix, vol, show, dur, w, h }
  let takes = [], target = 0, sel = 0;
  let pbVol = (() => { try { const v = JSON.parse(lsGet(LS_VOL) || "{}"); return typeof v.p === "number" ? v.p : 0.8; } catch (e) { return 0.8; } })();
  const off = t => t.auto + t.fix;                       // em que segundo da gravação dessa voz o playback começa
  const shift = k => off(takes[k]) - off(takes[0]);      // tempo da voz k = tempo da voz 1 + shift
  const recDur = () => takes[0] ? takes[0].dur : 0;
  const visible = () => takes.map((t, i) => ({ t, i })).filter(x => x.t.show);

  // equipamento escolhido (câmera, microfone e saída do som), guardado no aparelho
  let devs = { cams: [], mics: [], outs: [] };
  let camId = lsGet("cp-rec-camid") || "", micId = lsGet("cp-rec-micid") || "", outId = lsGet("cp-rec-outid") || "";
  const canPickOut = () => !!(window.AudioContext && AudioContext.prototype.setSinkId);
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devs = { cams: all.filter(d => d.kind === "videoinput"), mics: all.filter(d => d.kind === "audioinput" && d.deviceId !== "communications"), outs: all.filter(d => d.kind === "audiooutput" && d.deviceId !== "communications") };
    } catch (e) {}
    const v = camStream && camStream.getVideoTracks()[0], a = camStream && camStream.getAudioTracks()[0];
    if (v && v.getSettings().deviceId) camId = v.getSettings().deviceId;
    if (a && a.getSettings().deviceId) micId = a.getSettings().deviceId;
  }
  async function applyOut() { try { if (outId && canPickOut()) await audioCtx().setSinkId(outId === "default" ? "" : outId); } catch (e) { console.warn(e); } }
  const isMirror = () => { const v = camStream && camStream.getVideoTracks()[0]; const f = v && v.getSettings().facingMode; return f ? f === "user" : facing === "user" && !camId; };

  async function keepAwake() { try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch (e) {} }
  function stopCam() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  function stopMonitors() { for (const s of [pbSrc, ...monitors]) { try { if (s) { s.onended = null; s.stop(); s.disconnect(); } } catch (e) {} } pbSrc = null; monitors = []; }
  function close() {
    closed = true; stopMonitors(); stopPreview(); stopCam();
    try { if (ctx) ctx.close(); } catch (e) {} ctx = null;
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (e) {}
    try { if (wake) wake.release(); } catch (e) {}
    try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch (e) {}
    URL.revokeObjectURL(pipUrl); takes.forEach(t => URL.revokeObjectURL(t.url));
    root.remove(); document.body.style.overflow = "";
  }
  const header = sub => `<div class="hrow spread"><div><div class="small muted">Gravar meu vídeo  ·  tom ${escH(keyName)}</div><div style="font-size:22px;font-weight:700;line-height:1.15">${escH(song.name)}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div><button class="btn sm" data-st="close">Fechar</button></div>`;
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-st]"); if (!b || b.dataset.st !== "close") return;
    if (recording && !confirm("Parar e sair sem guardar esta gravação?")) return;
    if (takes.length) toast("O seu projeto fica guardado neste aparelho. Para continuar, abra Gravar de novo nesta música.");
    close();
  });

  // ---------- guardar o projeto ----------
  let saveT = null;
  function saveMeta() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!takes.length) return;
      dbPut("meta", PKEY, { takes: takes.map(t => ({ id: t.id, auto: t.auto, fix: t.fix, vol: t.vol, show: t.show })), pbVol, trimA, trimB, savedAt: Date.now() }).catch(e => console.warn(e));
    }, 400);
  }
  async function deleteProject() {
    try { const m = await dbGet("meta", PKEY); if (m) for (const t of m.takes) await dbDel("blobs", PKEY + "|" + t.id); await dbDel("meta", PKEY); } catch (e) {}
    takes.forEach(t => URL.revokeObjectURL(t.url)); takes = []; trimA = trimB = 0; sel = 0;
  }
  // prepara uma voz: vídeo, áudio separado, onda, tamanho da imagem
  async function prepareTake(base) {
    const t = Object.assign({}, base); t.url = URL.createObjectURL(t.blob);
    t.buf = await audioCtx().decodeAudioData(await t.blob.arrayBuffer());
    t.env = envelope(t.buf); t.dur = t.buf.duration;
    const v = el("video"); v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = t.url;
    await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 4000); });
    t.w = v.videoWidth || 1280; t.h = v.videoHeight || 720; v.removeAttribute("src"); v.load();
    return t;
  }

  /* ---------- 1. preparar ---------- */
  box.innerHTML = header() + `<div class="empty">Preparando o playback...</div>`;
  try {
    const c = audioCtx();
    pbBuf = await c.decodeAudioData(await videoBlob.arrayBuffer());
  } catch (e) {
    console.warn(e);
    box.innerHTML = header() + `<div class="empty">Não consegui preparar o áudio deste playback neste aparelho. Avise a Janaine.</div>`;
    return;
  }
  if (closed) return;
  let saved = null; try { saved = await dbGet("meta", PKEY); } catch (e) {}
  if (saved && saved.takes && saved.takes.length) showResume(saved); else showSetup();

  function showResume(m) {
    const n = m.takes.length;
    box.innerHTML = header() + `
      <div class="card" style="border-color:var(--bronze);gap:10px">
        <b>Você tem um projeto guardado desta música</b>
        <p class="small muted" style="margin:0">${n} ${n === 1 ? "voz gravada" : "vozes gravadas"} no tom ${escH(keyName)}, ${new Date(m.savedAt).toLocaleDateString("pt-BR")}.</p>
        <button class="btn primary st-big" id="stResume">Continuar o projeto</button>
        <button class="btn" id="stFresh">Começar do zero</button>
        <p class="small muted" style="margin:0">Começar do zero apaga as vozes guardadas deste projeto.</p>
      </div>`;
    box.querySelector("#stResume").onclick = async () => {
      box.innerHTML = header() + `<div class="empty">Abrindo o projeto...</div>`;
      try {
        await freshAudio(); await applyOut();
        for (const mt of m.takes) { const blob = await dbGet("blobs", PKEY + "|" + mt.id); if (blob) takes.push(await prepareTake({ ...mt, blob })); }
      } catch (e) { console.warn(e); }
      if (closed) return;
      if (!takes.length) { toast("Não encontrei as gravações deste projeto."); await deleteProject(); return showSetup(); }
      trimA = Math.max(0, Math.min(m.trimA || 0, recDur() - 1)); trimB = Math.min(recDur(), m.trimB || recDur()); if (trimB - trimA < 1) { trimA = 0; trimB = recDur(); }
      if (typeof m.pbVol === "number") pbVol = m.pbVol;
      showEdit();
    };
    box.querySelector("#stFresh").onclick = async () => { if (!confirm("Apagar as vozes guardadas e começar do zero?")) return; await deleteProject(); showSetup(); };
  }

  function showSetup(t) {
    target = t == null ? takes.length : t;
    const others = takes.filter((x, i) => i !== target).length;
    box.innerHTML = header(takes.length ? `Voz ${target + 1}${target < takes.length ? " (regravando)" : ""}` : "") + `
      ${others ? `<div class="card" style="border-color:var(--bronze);gap:6px"><b>Gravando a voz ${target + 1}</b>
        <p class="small" style="margin:0">No fone você vai ouvir o playback e ${others === 1 ? "a voz já gravada" : "as " + others + " vozes já gravadas"}. Para abrir voz, cante a sua parte por cima delas.</p>
        <button class="btn sm" id="stBackEdit" style="align-self:flex-start">Voltar para a edição</button></div>` : ""}
      <details class="card" style="gap:8px" ${lsGet("cp-rec-tut") ? "" : "open"} id="stTut">
        <summary style="cursor:pointer"><b>Dicas para gravar o seu vídeo</b> <span class="small muted">(toque para ${lsGet("cp-rec-tut") ? "abrir" : "fechar"})</span></summary>
        <ol class="small" style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
          <li><b>Tom:</b> o vídeo usa o tom escolhido na tela da música. Se quiser outro, troque antes de entrar aqui.</li>
          <li><b>Lugar:</b> escolha um canto silencioso, com a luz de frente para você (janela à sua frente, não atrás).</li>
          <li><b>Celular:</b> apoie num suporte ou tripé, na altura dos olhos. Em pé para Reels e Status, deitado para YouTube.</li>
          <li><b>Fone:</b> coloque o fone antes de ligar a câmera (veja o quadro abaixo).</li>
          <li><b>Câmera:</b> toque em Ligar câmera. Arraste o vídeo com letra para onde ficar melhor e toque duas vezes nele para mudar o tamanho. Se o aparelho tiver mais de uma câmera ou microfone (por exemplo, uma interface de áudio), escolha qual usar em Equipamento, logo abaixo da câmera.</li>
          <li><b>Gravar:</b> toque em Gravar, espere a contagem de 3 e cante. A gravação para sozinha quando a música acaba, ou toque em Parar.</li>
          <li><b>Várias vozes:</b> quer abrir voz? Depois da primeira gravação, toque em Gravar mais uma voz. Você ouve o que já gravou e canta por cima. São até ${MAX_VOZES} vozes, e o vídeo final divide a tela sozinho.</li>
          <li><b>Ajustar:</b> confira com o Play. Acerte o volume de cada voz e do playback, corte o começo e o fim pelas alças douradas e escolha o fade.</li>
          <li><b>Salvar:</b> toque em Assistir à prévia do vídeo final. Se estiver bom, toque em Salvar vídeo e depois em Salvar ou compartilhar. No iPhone, escolha Salvar vídeo para ir para a galeria.</li>
        </ol>
      </details>
      <div class="card" style="border-color:var(--bronze);gap:8px">
        <b>Antes de gravar: use fone de ouvido</b>
        <p class="small" style="margin:0"><b>Fone com fio: o melhor resultado.</b> O microfone pega só a sua voz e o playback entra limpo no vídeo, já sincronizado.</p>
        <p class="small" style="margin:0"><b>Fone Bluetooth: funciona,</b> mas ele atrasa o som. No final, talvez você precise acertar a sincronia, arrastando a faixa da sua voz na parte Sincronia.</p>
        <p class="small" style="margin:0"><b>Sem fone: não recomendamos.</b> O microfone capta o playback que sai do alto-falante junto com a sua voz, e o som do vídeo fica embolado.</p>
      </div>
      <div class="note">Escolha agora a posição do celular, em pé ou deitado. O vídeo sai do mesmo jeito.</div>
      <div class="st-cam" id="stCam"><div class="empty" style="width:100%">Toque em Ligar câmera</div></div>
      <button class="btn primary st-big" id="stOn">Ligar câmera e microfone</button>`;
    box.querySelector("#stOn").onclick = startCam;
    const be = box.querySelector("#stBackEdit"); if (be) be.onclick = () => { stopCam(); showEdit(); };
    // depois da primeira vez, o tutorial já aparece fechado
    lsSet("cp-rec-tut", "1");
  }

  async function openCam() {
    stopCam();
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    if (camId) video.deviceId = { exact: camId }; else video.facingMode = { ideal: facing };
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
    if (micId) audio.deviceId = { exact: micId };
    try { camStream = await navigator.mediaDevices.getUserMedia({ video, audio }); }
    catch (e) {
      // se o equipamento guardado não estiver mais conectado, volta para o padrão
      if (!camId && !micId) throw e;
      camId = ""; micId = ""; return openCam();
    }
  }
  // escolha de câmera, microfone e saída do som (só aparece o que tiver mais de uma opção)
  function equipHtml() {
    const opt = (list, cur, fallback) => list.map((d, i) => `<option value="${escH(d.deviceId)}" ${d.deviceId === cur ? "selected" : ""}>${escH(d.label || fallback + " " + (i + 1))}</option>`).join("");
    const rows = [];
    if (devs.cams.length > 1) rows.push(`<div class="mixrow" style="grid-template-columns:100px 1fr"><label for="stCamSel">Câmera</label><select class="field" id="stCamSel" data-dev="cam" style="padding:8px 10px">${opt(devs.cams, camId, "Câmera")}</select></div>`);
    if (devs.mics.length > 1) rows.push(`<div class="mixrow" style="grid-template-columns:100px 1fr"><label for="stMicSel">Microfone</label><select class="field" id="stMicSel" data-dev="mic" style="padding:8px 10px">${opt(devs.mics, micId, "Microfone")}</select></div>`);
    if (canPickOut() && devs.outs.length > 1) rows.push(`<div class="mixrow" style="grid-template-columns:100px 1fr"><label for="stOutSel">Ouvir em</label><select class="field" id="stOutSel" data-dev="out" style="padding:8px 10px">${opt(devs.outs, outId || "default", "Saída")}</select></div>`);
    return rows.length ? `<div class="card" id="stEquip" style="gap:8px"><b>Equipamento</b>${rows.join("")}<p class="small muted" style="margin:0">Usa interface de áudio? Escolha a entrada do microfone e, em Ouvir em, a saída onde está o seu fone.</p></div>` : "";
  }
  async function changeDevice(kind, id) {
    if (recording) return;
    if (kind === "out") { outId = id; lsSet("cp-rec-outid", id); await applyOut(); toast("Saída do som trocada."); return; }
    const oldCam = camId, oldMic = micId;
    if (kind === "cam") camId = id; else micId = id;
    try { await openCam(); lsSet("cp-rec-camid", camId); lsSet("cp-rec-micid", micId); }
    catch (e) { camId = oldCam; micId = oldMic; toast("Não consegui usar esse equipamento."); try { await openCam(); } catch (e2) {} }
    await listDevices();
    if (!closed) showRecord();
  }
  async function startCam() {
    const btn = box.querySelector("#stOn"); btn.disabled = true; btn.textContent = "Ligando...";
    try {
      try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch (e) {}
      audioCtx();
      await openCam();
    } catch (e) {
      console.warn(e); btn.disabled = false; btn.textContent = "Tentar de novo";
      toast("Não consegui abrir a câmera e o microfone. Permita o acesso nas configurações do aparelho.");
      return;
    }
    if (closed) return stopCam();
    await listDevices(); await applyOut();
    keepAwake();
    showRecord();
  }

  /* ---------- 2. gravar ---------- */
  function showRecord() {
    box.innerHTML = header((takes.length ? `Voz ${target + 1}. ` : "") + "Arraste o vídeo com letra para onde quiser. Toque duas vezes nele para mudar o tamanho (pequeno, médio, grande).") + `
      <div class="st-cam" id="stCam">
        <video class="cam ${isMirror() ? "mirror" : ""}" id="stLive" playsinline muted autoplay></video>
        <div class="st-pip ${pipLevel ? "l" + pipLevel : ""}" id="stPip"><video playsinline muted preload="auto" src="${pipUrl}"></video></div>
        <div class="st-rec" id="stRecTag">● Gravando 0:00</div>
        <div class="st-count" id="stCount"></div>
      </div>
      <button class="btn st-big st-rec-btn" id="stGo">Gravar</button>
      ${equipHtml()}
      <p class="small muted" style="margin:0;text-align:center">O playback toca no fone${takes.filter((x, i) => i !== target).length ? ", junto com as vozes já gravadas," : ""} e a gravação para sozinha quando a música acaba.</p>`;
    const live = box.querySelector("#stLive"); live.srcObject = camStream; live.play().catch(() => {});
    pipVideo = box.querySelector("#stPip video");
    const pip = box.querySelector("#stPip"), area = box.querySelector("#stCam");
    // posição guardada em fração da área da câmera, para funcionar em pé e deitado
    const place = () => {
      const aw = area.clientWidth, ah = area.clientHeight, pw = pip.offsetWidth, ph = pip.offsetHeight;
      const pos = pipPos || { x: 1, y: 0 };
      pip.style.left = Math.round(Math.max(0, Math.min(aw - pw, pos.x * (aw - pw)))) + "px";
      pip.style.top = Math.round(Math.max(0, Math.min(ah - ph, pos.y * (ah - ph)))) + "px";
    };
    place(); live.addEventListener("loadedmetadata", place); pipVideo.addEventListener("loadedmetadata", place);
    let drag = null, lastTap = 0;
    pip.addEventListener("pointerdown", e => { e.preventDefault(); pip.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, l: pip.offsetLeft, t: pip.offsetTop, moved: false }; });
    pip.addEventListener("pointermove", e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true; if (!drag.moved) return;
      const aw = area.clientWidth, ah = area.clientHeight, pw = pip.offsetWidth, ph = pip.offsetHeight;
      const l = Math.max(0, Math.min(aw - pw, drag.l + dx)), t = Math.max(0, Math.min(ah - ph, drag.t + dy));
      pip.style.left = l + "px"; pip.style.top = t + "px";
      pipPos = { x: aw > pw ? l / (aw - pw) : 0, y: ah > ph ? t / (ah - ph) : 0 };
    });
    const up = () => {
      if (!drag) return; const moved = drag.moved; drag = null; if (moved) return;
      const now = Date.now(); if (now - lastTap < 350) { pip.classList.remove("l" + pipLevel); pipLevel = (pipLevel + 1) % 3; if (pipLevel) pip.classList.add("l" + pipLevel); place(); lastTap = 0; } else lastTap = now;
    };
    pip.addEventListener("pointerup", up); pip.addEventListener("pointercancel", () => { drag = null; });
    window.addEventListener("resize", () => { if (box.contains(pip)) place(); });
    box.querySelectorAll("[data-dev]").forEach(sel => sel.onchange = () => changeDevice(sel.dataset.dev, sel.value));
    box.querySelector("#stGo").onclick = () => recording ? stopRec() : countdown();
  }

  let recording = false, recT0 = 0, tick = null;
  function countdown() {
    const go = box.querySelector("#stGo"); go.disabled = true;
    const c = box.querySelector("#stCount"); let n = 3; c.textContent = n; c.classList.add("on");
    const t = setInterval(() => { n--; if (n > 0) c.textContent = n; else { clearInterval(t); c.classList.remove("on"); startRec(); } }, 800);
  }
  function startRec() {
    const mime = pickMime(); chunks = [];
    try { recorder = new MediaRecorder(camStream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 192_000 } : undefined); }
    catch (e) { toast("Este aparelho não grava vídeo pelo navegador."); return; }
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = onRecorded;
    const c = audioCtx();
    recorder.onstart = () => {
      recT0 = performance.now();
      // o playback começa um instante depois da câmera, num tempo conhecido do relógio de áudio
      const lead = 0.35; const when = c.currentTime + lead;
      pbSrc = c.createBufferSource(); pbSrc.buffer = pbBuf; pbSrc.connect(c.destination);
      pbSrc.start(when);
      // vozes já gravadas tocam junto, alinhadas ao playback (para abrir voz)
      takes.forEach((t, j) => {
        if (j === target) return;
        const g = c.createGain(); g.gain.value = t.vol; g.connect(c.destination);
        const s = c.createBufferSource(); s.buffer = t.buf; s.connect(g); startAt(s, when, off(t));
        monitors.push(s);
      });
      const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
      const ctxNowPerf = ts && ts.performanceTime ? ts.performanceTime + (c.currentTime - ts.contextTime) * 1000 : performance.now();
      const pbStartPerf = ctxNowPerf + lead * 1000;
      const outLat = (c.outputLatency || 0) + (c.baseLatency || 0);
      offsetAuto = (pbStartPerf - recT0) / 1000 + outLat + 0.01;
      setTimeout(() => { if (pipVideo) { pipVideo.currentTime = 0; pipVideo.play().catch(() => {}); } }, lead * 1000);
      pbSrc.onended = () => { if (recording) setTimeout(stopRec, 1200); };
      recording = true;
      const go = box.querySelector("#stGo"); go.disabled = false; go.textContent = "Parar";
      const eq = box.querySelector("#stEquip"); if (eq) eq.hidden = true;
      const tag = box.querySelector("#stRecTag"); tag.classList.add("on");
      tick = setInterval(() => { tag.textContent = "● Gravando " + fmtT((performance.now() - recT0) / 1000); }, 250);
    };
    recorder.start(1000);
  }
  function stopRec() {
    if (!recording) return; recording = false; clearInterval(tick);
    stopMonitors();
    if (pipVideo) pipVideo.pause();
    try { recorder.stop(); } catch (e) {}
    box.innerHTML = header() + `<div class="empty">Preparando a sua gravação...</div>`;
  }
  async function onRecorded() {
    stopCam();
    if (closed) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "video/mp4" }); chunks = [];
    let take;
    try {
      const c = await freshAudio(); await applyOut();
      pbBuf = await c.decodeAudioData(await videoBlob.arrayBuffer());
      const old = takes[target];
      take = await prepareTake({ id: Date.now().toString(36), blob, auto: offsetAuto, fix: old ? old.fix : +(lsGet(LS_FIX) || 0), vol: old ? old.vol : 1, show: old ? old.show : true });
    }
    catch (e) { console.warn(e); box.innerHTML = header() + `<div class="empty">A gravação foi feita, mas não consegui separar a voz neste aparelho. Avise a Janaine.</div>`; return; }
    if (closed) return;
    const old = takes[target];
    if (old) { URL.revokeObjectURL(old.url); dbDel("blobs", PKEY + "|" + old.id).catch(() => {}); }
    takes[target] = take;
    if (target === 0) { trimA = 0; trimB = recDur(); }
    sel = target;
    try { await dbPut("blobs", PKEY + "|" + take.id, blob); if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }
    catch (e) { console.warn(e); toast("Não consegui guardar esta voz no aparelho. Ela funciona agora, mas some se você fechar."); }
    saveMeta();
    showEdit();
  }

  /* ---------- 3. mixar e sincronizar ---------- */
  let preview = null;
  function stopPreview() {
    if (!preview) return;
    for (const s of preview.srcs) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }
    // o iPhone às vezes ignora o "parar" de um som agendado: desligar os fios garante o silêncio
    try { preview.gM.disconnect(); } catch (e) {}
    for (const v of preview.vids) { v.el.pause(); v.el.playbackRate = 1; }
    clearTimeout(preview.camPlay);
    cancelAnimationFrame(preview.raf); preview = null;
    const pb = box.querySelector("#stPlay"); if (pb) pb.textContent = "Play";
    const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 0;
    sleepAudioSoon();
  }
  // quando nada está tocando, o áudio do app "dorme" (some a onda da Dynamic Island e nenhum som fica preso)
  let rendering = false;
  function sleepAudioSoon() { setTimeout(() => { if (!preview && !recording && !rendering && ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, 400); }

  function outDims() {
    const v = visible(); const t = (v[0] || { t: takes[0] }).t;
    const k = Math.min(1, 1280 / Math.max(t.w, t.h));
    return { W: Math.round(t.w * k / 2) * 2, H: Math.round(t.h * k / 2) * 2 };
  }

  function showEdit() {
    if (!takes.length) return showSetup();
    sel = Math.min(sel, takes.length - 1);
    const envP = envelope(pbBuf);
    const RD = recDur();
    let zoom = false, winStart = 0, playPos = Math.max(0, Math.min(trimA, RD));
    const vis = visible(); const { W, H } = outDims(); const rects = layout(vis.length, W, H);
    const gridW = `min(100%, calc(72vh * ${(W / H).toFixed(4)}))`;
    const pct = x => Math.round(x * 100) + "%";
    box.innerHTML = header(takes.length > 1 ? `${takes.length} vozes. Ajuste e depois toque em Salvar vídeo.` : "Ajuste o volume e a sincronia. Depois toque em Salvar vídeo.") + `
      <div class="st-grid" id="stGrid" style="width:${gridW};aspect-ratio:${W}/${H}">
        ${vis.map((x, j) => `<video data-k="${x.i}" playsinline muted preload="auto" src="${x.t.url}" style="left:${rects[j].x / W * 100}%;top:${rects[j].y / H * 100}%;width:${rects[j].w / W * 100}%;height:${rects[j].h / H * 100}%"></video>`).join("")}
        <div id="stFadeOv" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none"></div>
      </div>
      <div class="card" style="gap:8px">
        <div class="tbig"><span id="stTime">0:00,0</span> <span class="small muted" style="font-weight:500">/ ${fmtT1(RD)}</span></div>
        <div class="tl" id="stTL" aria-label="Linha do tempo: arraste as alças douradas para cortar">
          <canvas id="stThumbs"></canvas>
          <div class="tl-dim" id="stDimA"></div><div class="tl-dim" id="stDimB"></div>
          <div class="tl-sel" id="stSel"><div class="tl-h a" data-h="a"></div><div class="tl-h b" data-h="b"></div></div>
          <div class="tl-head" id="stHead"></div>
        </div>
        <div class="tl-info"><span>Início <b id="stAO"></b></span><span>Duração <b id="stLen"></b></span><span>Fim <b id="stBO"></b></span></div>
        <p class="small muted" style="margin:0;text-align:center">Arraste as alças douradas para cortar o começo e o fim. Toque ou arraste na faixa para andar pelo vídeo.</p>
        <div class="transport">
          <button class="btn sm" data-sk="-5">−5 s</button><button class="btn sm" data-sk="-1">−1 s</button>
          <button class="btn primary play" id="stPlay">Play</button>
          <button class="btn sm" data-sk="1">+1 s</button><button class="btn sm" data-sk="5">+5 s</button>
        </div>
        <div class="nudges"><button class="btn sm ghost" id="stMarkA">Cortar início aqui</button><button class="btn sm ghost" id="stMarkB">Cortar fim aqui</button><button class="btn sm ghost" id="stTrimReset">Desfazer corte</button></div>
        <button class="btn primary" id="stFinal" style="padding:13px">Assistir à prévia do vídeo final</button>
        <p class="small muted" style="margin:0;text-align:center">A prévia já sai com o corte, o volume, a sincronia e os fades, do jeito que vai ficar.</p>
      </div>
      <div class="card" style="gap:8px">
        <div class="hrow spread"><b>Vozes</b><span class="small muted">${takes.length} de ${MAX_VOZES}</span></div>
        ${takes.map((t, i) => `<div class="voz"><b>Voz ${i + 1}</b>
          <label><input type="checkbox" data-show="${i}" ${t.show ? "checked" : ""}> Aparece no vídeo</label>
          <button class="btn sm ghost" data-redo="${i}">Regravar</button><button class="btn sm ghost" data-del="${i}">Apagar</button></div>`).join("")}
        ${takes.length < MAX_VOZES ? `<button class="btn primary" id="stMore">Gravar mais uma voz</button>
        <p class="small muted" style="margin:0">Para abrir voz ou fazer harmonia: na próxima gravação você ouve o playback e as vozes já gravadas, e canta por cima. O vídeo final divide a tela sozinho entre as vozes que aparecem.</p>` : `<p class="small muted" style="margin:0">Você chegou ao limite de ${MAX_VOZES} vozes.</p>`}
        <p class="small muted" style="margin:0">Desmarque Aparece no vídeo para usar uma voz só no som, sem aparecer na tela.</p>
      </div>
      <div class="card">
        <b>Volume</b>
        ${takes.map((t, i) => `<div class="mixrow"><label for="stVv${i}">${takes.length > 1 ? "Voz " + (i + 1) : "Sua voz"}</label><input type="range" id="stVv${i}" data-vol="${i}" min="0" max="2" step="0.01" value="${t.vol}"><output id="stVvO${i}">${pct(t.vol)}</output></div>`).join("")}
        <div class="mixrow"><label for="stVp">Playback</label><input type="range" id="stVp" min="0" max="2" step="0.01" value="${pbVol}"><output id="stVpO">${pct(pbVol)}</output></div>
      </div>
      <div class="card">
        <b>Fade</b>
        <div class="mixrow"><label for="stFi">Fade de entrada</label><select class="field" id="stFi" style="padding:6px 10px">${[0, 0.5, 1, 2, 3].map(x => `<option value="${x}" ${x === fade.i ? "selected" : ""}>${x ? String(x).replace(".", ",") + " s" : "Sem fade"}</option>`).join("")}</select><span></span></div>
        <div class="mixrow"><label for="stFo">Fade de saída</label><select class="field" id="stFo" style="padding:6px 10px">${[0, 0.5, 1, 2, 3, 5].map(x => `<option value="${x}" ${x === fade.o ? "selected" : ""}>${x ? String(x).replace(".", ",") + " s" : "Sem fade"}</option>`).join("")}</select><span></span></div>
        <p class="small muted" style="margin:0">O fade abaixa o som e escurece a imagem aos poucos, no começo e no fim do vídeo final.</p>
      </div>
      <div class="card">
        <div class="hrow spread"><b>Sincronia</b><span class="small">${takes.length > 1 ? "Voz " + (sel + 1) : "Voz"} <span class="syncval" id="stSync"></span></span></div>
        ${takes.length > 1 ? `<div class="tabs">${takes.map((t, i) => `<button data-sel="${i}" aria-selected="${i === sel}">Voz ${i + 1}</button>`).join("")}</div>` : ""}
        <p class="small muted" style="margin:0">Arraste a faixa da voz para a esquerda ou para a direita até encaixar no playback. Use a lupa para ajustar no detalhe.</p>
        <div class="tabs"><button id="stZ0" aria-selected="true">Música toda</button><button id="stZ1" aria-selected="false">Lupa (4 segundos)</button></div>
        <div class="lanes" id="stLanes">
          <div class="lane"><span>Playback</span><canvas id="stCP"></canvas></div>
          <div class="lane drag"><span>${takes.length > 1 ? "Voz " + (sel + 1) : "Sua voz"} (arraste)</span><canvas id="stCV"></canvas></div>
        </div>
        <input type="range" id="stWin" min="0" max="${Math.max(0, pbBuf.duration - 4).toFixed(2)}" step="0.05" value="0" aria-label="Posição da lupa" style="accent-color:var(--bronze)" hidden>
        <div class="nudges">
          <button class="btn sm" data-n="-0.05">⟨⟨ 50 ms</button><button class="btn sm" data-n="-0.01">⟨ 10 ms</button>
          <button class="btn sm" data-n="0.01">10 ms ⟩</button><button class="btn sm" data-n="0.05">50 ms ⟩⟩</button>
        </div>
        <div class="hrow" style="justify-content:center"><button class="link" id="stReset">Voltar ao ajuste automático</button></div>
      </div>
      <button class="btn primary st-big" id="stSave">Salvar vídeo</button>
      <button class="btn danger" id="stWipe">Apagar o projeto e começar do zero</button>
      <p class="small muted" style="margin:0;text-align:center">O projeto fica guardado neste aparelho. Você pode fechar e continuar depois.</p>`;

    const vids = [...box.querySelectorAll("#stGrid video")].map(v => ({ el: v, k: +v.dataset.k }));
    const cP = box.querySelector("#stCP"), cV = box.querySelector("#stCV");
    const win = box.querySelector("#stWin");
    const tT = (k, T) => T + shift(k);   // tempo dentro da voz k

    // vozes: aparecer, regravar, apagar, gravar mais
    box.querySelectorAll("[data-show]").forEach(cb => cb.onchange = () => {
      const i = +cb.dataset.show;
      if (!cb.checked && visible().length === 1 && takes[i].show) { cb.checked = true; return toast("Pelo menos uma voz precisa aparecer no vídeo."); }
      takes[i].show = cb.checked; saveMeta(); stopPreview(); showEdit();
    });
    box.querySelectorAll("[data-redo]").forEach(b => b.onclick = () => { stopPreview(); showSetup(+b.dataset.redo); });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const i = +b.dataset.del;
      if (!confirm(`Apagar a voz ${i + 1}?`)) return;
      stopPreview();
      if (i === 0 && takes.length > 1) { const sh = shift(1); trimA += sh; trimB += sh; }
      const t = takes.splice(i, 1)[0]; URL.revokeObjectURL(t.url); dbDel("blobs", PKEY + "|" + t.id).catch(() => {});
      if (!takes.length) { await deleteProject(); return showSetup(); }
      trimA = Math.max(0, Math.min(trimA, recDur() - 1)); trimB = Math.min(recDur(), Math.max(trimB, trimA + 1));
      if (!visible().length) takes[0].show = true;
      sel = Math.min(sel, takes.length - 1); saveMeta(); showEdit();
    });
    const more = box.querySelector("#stMore"); if (more) more.onclick = () => { stopPreview(); showSetup(takes.length); };
    box.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => { sel = +b.dataset.sel; stopPreview(); showEdit(); });

    // volume
    box.querySelectorAll("[data-vol]").forEach(r => r.oninput = () => {
      const i = +r.dataset.vol; takes[i].vol = +r.value; box.querySelector("#stVvO" + i).textContent = pct(takes[i].vol);
      if (preview && preview.gains[i]) preview.gains[i].gain.value = takes[i].vol; saveMeta();
    });
    const vp = box.querySelector("#stVp");
    vp.oninput = () => { pbVol = +vp.value; box.querySelector("#stVpO").textContent = pct(pbVol); lsSet(LS_VOL, JSON.stringify({ p: pbVol })); if (preview) preview.gP.gain.value = pbVol; saveMeta(); };

    // linha do tempo no estilo dos editores: alças douradas no começo e no fim, cabeça de leitura branca
    const tl = box.querySelector("#stTL"), pctOf = t => (t / RD) * 100 + "%";
    const showHead = p => { box.querySelector("#stHead").style.left = pctOf(Math.max(0, Math.min(RD, p))); };
    const showTrim = () => {
      box.querySelector("#stDimA").style.cssText = "left:0;width:" + pctOf(trimA);
      box.querySelector("#stDimB").style.cssText = "left:" + pctOf(trimB) + ";right:0";
      const s = box.querySelector("#stSel"); s.style.left = pctOf(trimA); s.style.width = pctOf(trimB - trimA);
      box.querySelector("#stAO").textContent = fmtT1(trimA); box.querySelector("#stBO").textContent = fmtT1(trimB); box.querySelector("#stLen").textContent = fmtT1(trimB - trimA);
      if (box.querySelector("#stCV")) draw();
    };
    const setTrim = (a, b) => { trimA = Math.max(0, Math.min(a, RD - 1)); trimB = Math.min(RD, Math.max(b, trimA + 1)); if (trimA > b - 1) trimA = Math.max(0, trimB - 1); showTrim(); saveMeta(); };
    const tAt = x => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(RD, ((x - r.left) / r.width) * RD)); };
    let tlDrag = null;
    tl.addEventListener("pointerdown", e => {
      e.preventDefault(); tl.setPointerCapture(e.pointerId);
      const h = e.target.closest("[data-h]"); const was = !!preview; if (was) { playPos = currentPos(); stopPreview(); }
      tlDrag = { h: h ? h.dataset.h : null, was };
      if (!h) seekTo(tAt(e.clientX));
    });
    tl.addEventListener("pointermove", e => {
      if (!tlDrag) return; const t = tAt(e.clientX);
      if (tlDrag.h === "a") { setTrim(t, trimB); seekTo(trimA); }
      else if (tlDrag.h === "b") { setTrim(trimA, t); seekTo(trimB - 0.05); }
      else seekTo(t);
    });
    const tlEnd = () => { if (!tlDrag) return; const d = tlDrag; tlDrag = null; if (d.h === "a") seekTo(trimA); if (d.was && !d.h) startPreview(playPos); };
    tl.addEventListener("pointerup", tlEnd); tl.addEventListener("pointercancel", tlEnd);
    box.querySelector("#stMarkA").onclick = () => { const p = preview ? currentPos() : playPos; setTrim(p, trimB); toast("Início cortado em " + fmtT1(trimA) + "."); };
    box.querySelector("#stMarkB").onclick = () => { const p = preview ? currentPos() : playPos; setTrim(trimA, p); toast("Fim cortado em " + fmtT1(trimB) + "."); };
    box.querySelector("#stFinal").onclick = () => startPreview(trimA);
    box.querySelector("#stTrimReset").onclick = () => setTrim(0, RD);
    // miniaturas do vídeo na faixa (da primeira voz)
    (async () => {
      const cvT = box.querySelector("#stThumbs"); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvT.width = cvT.clientWidth * dpr; cvT.height = cvT.clientHeight * dpr; const g = cvT.getContext("2d");
      const v = el("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.src = takes[0].url;
      v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none"; document.body.appendChild(v);
      try {
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; setTimeout(r, 4000); });
        const n = Math.max(4, Math.round(cvT.width / (cvT.height * 0.75))), tw = cvT.width / n;
        for (let i = 0; i < n; i++) {
          if (!box.contains(cvT)) break;
          v.currentTime = Math.min(RD - 0.1, (i + 0.5) * RD / n);
          await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
          drawCover(g, v, { x: i * tw, y: 0, w: tw, h: cvT.height });
        }
      } catch (e) {}
      v.remove();
    })();
    const saveFade = () => lsSet("cp-rec-fade", JSON.stringify(fade));
    box.querySelector("#stFi").onchange = e => { fade.i = +e.target.value; saveFade(); };
    box.querySelector("#stFo").onchange = e => { fade.o = +e.target.value; saveFade(); };

    // ondas: eixo = tempo do playback (playback fixo; a voz escolhida começa em -offset e é ela que se arrasta)
    const T0 = () => off(takes[0]);   // tempo da voz 1 quando o playback está em 0
    const st = () => takes[sel];
    const t0 = () => zoom ? winStart : Math.min(0, -off(st()));
    const span = () => zoom ? 4 : Math.max(pbBuf.duration, st().dur - off(st())) - t0() + 0.3;
    function drawLane(cv, env, startAt, color, playT) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const g = cv.getContext("2d"); g.clearRect(0, 0, w, h);
      const a = t0(), sp = span(); g.fillStyle = color;
      for (let x = 0; x < w; x++) {
        const ta = a + (x / w) * sp - startAt, tb = a + ((x + 1) / w) * sp - startAt;
        const ia = Math.floor(ta * RATE), ib = Math.max(ia + 1, Math.floor(tb * RATE));
        if (ib <= 0 || ia >= env.length) continue;
        let m = 0; for (let i = Math.max(0, ia); i < Math.min(env.length, ib); i++) if (env[i] > m) m = env[i];
        const bh = Math.max(1, m * (h - 14 * dpr)); g.fillRect(x, (h + 10 * dpr - bh) / 2, 1, bh);
      }
      // partes cortadas ficam escuras
      const ta0 = trimA - T0(), tb0 = trimB - T0(); g.fillStyle = "#000000b0";
      const xa = ((ta0 - a) / sp) * w, xb = ((tb0 - a) / sp) * w;
      if (xa > 0) g.fillRect(0, 0, Math.min(w, xa), h); if (xb < w) g.fillRect(Math.max(0, xb), 0, w - Math.max(0, xb), h);
      if (playT != null) { const px = ((playT - a) / sp) * w; if (px >= 0 && px <= w) { g.fillStyle = "#efe6d2"; g.fillRect(px, 0, 2 * dpr, h); } }
    }
    function draw(playT) {
      if (playT === undefined) playT = playPos - T0();
      drawLane(cP, envP, 0, "#c49a6c", playT);
      drawLane(cV, st().env, -off(st()), "#8a1a17", playT);
      box.querySelector("#stSync").textContent = ms(-st().fix);
    }
    const setFix = f => { st().fix = Math.max(-2, Math.min(2, f)); lsSet(LS_FIX, String(st().fix)); draw(); saveMeta(); if (preview) startPreview(currentPos()); };
    box.querySelectorAll("[data-n]").forEach(b => b.onclick = () => setFix(st().fix - +b.dataset.n)); // voz para a direita = playback entra antes
    box.querySelector("#stReset").onclick = () => setFix(0);
    const setZoom = z => { zoom = z; box.querySelector("#stZ0").setAttribute("aria-selected", !z); box.querySelector("#stZ1").setAttribute("aria-selected", z); win.hidden = !z; if (z) { winStart = Math.max(0, Math.min(+win.max, (preview ? currentPos() : playPos) - T0() - 0.5)); win.value = winStart; } draw(); };
    box.querySelector("#stZ0").onclick = () => setZoom(false); box.querySelector("#stZ1").onclick = () => setZoom(true);
    win.oninput = () => { winStart = +win.value; draw(); };

    // arrastar a faixa da voz
    let drag = null;
    cV.parentElement.addEventListener("pointerdown", e => { drag = { x: e.clientX, f: st().fix, w: cV.clientWidth }; cV.parentElement.setPointerCapture(e.pointerId); });
    cV.parentElement.addEventListener("pointermove", e => { if (!drag) return; const dt = ((e.clientX - drag.x) / drag.w) * span(); st().fix = Math.max(-2, Math.min(2, drag.f - dt)); draw(); });
    const endDrag = () => { if (!drag) return; drag = null; setFix(st().fix); };
    cV.parentElement.addEventListener("pointerup", endDrag); cV.parentElement.addEventListener("pointercancel", endDrag);
    // tocar num ponto da faixa do playback = ouvir dali
    cP.parentElement.addEventListener("click", e => { const r = cP.getBoundingClientRect(); const tPb = t0() + ((e.clientX - r.left) / r.width) * span(); startPreview(Math.max(0, tPb + T0())); });

    // ouvir (pos = tempo da voz 1)
    function currentPos() { return preview ? preview.startPos + (audioCtx().currentTime - preview.startCtx) : playPos; }
    function startPreview(pos) {
      stopPreview(); const c = audioCtx(); pos = Math.max(0, Math.min(pos, trimB - 0.05)); playPos = pos;
      const gM = c.createGain(); gM.connect(c.destination);
      const when = c.currentTime + 0.08, srcs = [], gains = {};
      takes.forEach((t, k) => {
        const g = c.createGain(); g.gain.value = t.vol; g.connect(gM); gains[k] = g;
        const s = c.createBufferSource(); s.buffer = t.buf; s.connect(g); startAt(s, when, tT(k, pos)); srcs.push(s);
      });
      const gP = c.createGain(); gP.gain.value = pbVol; gP.connect(gM);
      const sP = c.createBufferSource(); sP.buffer = pbBuf; sP.connect(gP); startAt(sP, when, pos - T0()); srcs.push(sP);
      // fades dentro do trecho escolhido, para ouvir como vai ficar
      const L = trimB - trimA, fi = Math.min(fade.i, L / 2), fo = Math.min(fade.o, L / 2), rel = pos - trimA;
      const lvl = r => Math.max(0, Math.min(1, fi && r < fi ? r / fi : 1, fo && r > L - fo ? (L - r) / fo : 1));
      gM.gain.setValueAtTime(lvl(rel), when);
      if (fi && rel < fi) gM.gain.linearRampToValueAtTime(1, when + fi - rel);
      if (fo) { const tA = Math.max(0, L - fo - rel); gM.gain.setValueAtTime(lvl(rel + tA), when + tA); gM.gain.linearRampToValueAtTime(0, when + (L - rel)); }
      for (const v of vids) { v.el.playbackRate = 1; v.el.currentTime = Math.max(0, Math.min(takes[v.k].dur - 0.05, tT(v.k, pos))); }
      const camPlay = setTimeout(() => { for (const v of vids) { if (tT(v.k, pos) < 0) continue; const go = () => v.el.play().catch(() => {}); if (v.el.seeking) v.el.addEventListener("seeked", go, { once: true }); else go(); } }, 80);
      preview = { srcs, gains, gP, gM, startCtx: when, startPos: pos, vids, raf: 0, camPlay };
      box.querySelector("#stPlay").textContent = "Pause";
      const loop = () => {
        if (!preview) return; const p = currentPos();
        if (p >= trimB) { stopPreview(); seekTo(trimA); return; }
        for (const v of vids) {
          const tv = tT(v.k, p);
          if (tv < 0 || tv > takes[v.k].dur) { if (!v.el.paused) v.el.pause(); continue; }
          if (v.el.paused && !v.el.seeking && p > pos + 0.15) v.el.play().catch(() => {});
          if (!v.el.paused && !v.el.seeking) follow(v.el, tv);
        }
        if (zoom && (p - T0() > winStart + 3.8)) { winStart = Math.min(+win.max, p - T0() - 0.2); win.value = winStart; }
        box.querySelector("#stTime").textContent = fmtT1(p); showHead(p);
        const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 1 - lvl(p - trimA);
        // redesenhar as ondas pesa no iPhone: só umas 8 vezes por segundo, para não atrapalhar a imagem
        const now = performance.now(); if (now - (preview.lastDraw || 0) > 120) { preview.lastDraw = now; draw(p - T0()); }
        preview.raf = requestAnimationFrame(loop);
      };
      loop();
    }
    // ir para um ponto: tocando, continua dali; pausado, mostra a imagem daquele ponto
    function seekTo(pos) {
      pos = Math.max(0, Math.min(RD - 0.05, pos));
      if (preview) { startPreview(pos); return; }
      playPos = pos;
      for (const v of vids) v.el.currentTime = Math.max(0, Math.min(takes[v.k].dur - 0.05, tT(v.k, pos)));
      box.querySelector("#stTime").textContent = fmtT1(pos); showHead(pos);
      const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 0;
      if (zoom) { const pb = pos - T0(); if (pb < winStart || pb > winStart + 4) { winStart = Math.max(0, Math.min(+win.max, pb - 1)); win.value = winStart; } }
      draw();
    }
    box.querySelectorAll("[data-sk]").forEach(b => b.onclick = () => seekTo((preview ? currentPos() : playPos) + +b.dataset.sk));
    box.querySelector("#stPlay").onclick = () => { if (preview) { playPos = currentPos(); stopPreview(); seekTo(playPos); } else startPreview(playPos >= trimB - 0.1 || playPos < trimA ? trimA : playPos); };
    box.querySelector("#stWipe").onclick = async () => { if (!confirm("Apagar todas as vozes deste projeto e começar do zero?")) return; stopPreview(); await deleteProject(); showSetup(); };
    box.querySelector("#stSave").onclick = () => { stopPreview(); render(); };
    requestAnimationFrame(() => { showTrim(); seekTo(playPos); });
    window.addEventListener("resize", () => { if (box.querySelector("#stCV")) draw(); });
  }

  /* ---------- 4. juntar tudo num vídeo ---------- */
  async function render() {
    box.innerHTML = header() + `
      <div class="card stack">
        <b>Montando o seu vídeo</b>
        <p class="small muted" style="margin:0">O aparelho toca o trecho inteiro por dentro para juntar as imagens, as vozes e o playback. Leva o tempo do trecho escolhido. Não saia do app e não bloqueie a tela.</p>
        <div class="bar"><i id="stBar"></i></div><p class="small muted" id="stPct" style="margin:0">0%</p>
        <button class="btn" id="stCancel">Cancelar</button>
      </div>`;
    keepAwake(); rendering = true;
    const c = audioCtx();
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    const vis = visible(); const { W, H } = outDims(); const rects = layout(vis.length, W, H);
    const hidden = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none";
    const vids = vis.map(x => { const v = el("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.src = x.t.url; v.style.cssText = hidden; document.body.appendChild(v); return { el: v, k: x.i }; });
    const cleanup = () => { vids.forEach(v => { v.el.pause(); v.el.remove(); }); cv.remove(); };
    const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    // o iPhone só "grava" um canvas que está na tela: fica pequenininho e invisível
    cv.style.cssText = hidden; document.body.appendChild(cv);
    await Promise.all(vids.map(v => new Promise(r => { if (v.el.readyState >= 1) r(); else { v.el.onloadedmetadata = r; setTimeout(r, 4000); } })));
    // mixagem feita antes, fora do tempo real, em 48 kHz estéreo: volume, sincronia, corte e fades
    const len = trimB - trimA, SR = 48000;
    const fi = Math.min(fade.i, len / 2), fo = Math.min(fade.o, len / 2);
    const tT = (k, p) => trimA + p + shift(k);
    let mix;
    try {
      const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(len * SR), SR);
      const gM = oc.createGain(); gM.connect(oc.destination);
      gM.gain.setValueAtTime(fi ? 0 : 1, 0); if (fi) gM.gain.linearRampToValueAtTime(1, fi);
      if (fo) { gM.gain.setValueAtTime(1, len - fo); gM.gain.linearRampToValueAtTime(0, len); }
      takes.forEach((t, k) => { const gV = oc.createGain(); gV.gain.value = t.vol; gV.connect(gM); const s = oc.createBufferSource(); s.buffer = t.buf; s.connect(gV); startAt(s, 0, tT(k, 0)); });
      const gP = oc.createGain(); gP.gain.value = pbVol; gP.connect(gM);
      const sP = oc.createBufferSource(); sP.buffer = pbBuf; sP.connect(gP); startAt(sP, 0, trimA - off(takes[0]));
      mix = await oc.startRendering();
    } catch (e) { console.warn(e); cleanup(); rendering = false; toast("Não consegui fazer a mixagem neste aparelho."); showEdit(); return; }
    const dest = c.createMediaStreamDestination(); dest.channelCount = 2;
    const srcM = c.createBufferSource(); srcM.buffer = mix; srcM.connect(dest);
    const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime(); const out = [];
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 } : undefined); }
    catch (e) { cleanup(); rendering = false; toast("Este aparelho não conseguiu montar o vídeo."); showEdit(); return; }
    rec.ondataavailable = e => { if (e.data && e.data.size) out.push(e.data); };
    let cancelled = false, raf = 0;
    const done = new Promise(r => { rec.onstop = r; });
    box.querySelector("#stCancel").onclick = () => { cancelled = true; try { rec.stop(); } catch (e) {} };

    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    await Promise.all(vids.map(v => new Promise(r => { v.el.currentTime = Math.max(0, Math.min(takes[v.k].dur - 0.05, tT(v.k, 0))); v.el.onseeked = r; setTimeout(r, 1500); })));
    rec.start(1000);
    await new Promise(r => setTimeout(r, 150));
    const when = c.currentTime + 0.1;
    srcM.start(when);
    setTimeout(() => vids.forEach(v => { if (tT(v.k, 0) >= 0) v.el.play().catch(() => {}); }), 100);
    const bar = box.querySelector("#stBar"), pctEl = box.querySelector("#stPct");
    const frame = () => {
      const p = c.currentTime - when;
      if (p >= 0) {
        g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
        vids.forEach((v, j) => {
          const tv = tT(v.k, p);
          if (tv < 0 || tv > takes[v.k].dur) { if (!v.el.paused) v.el.pause(); return; }
          if (v.el.paused && !v.el.seeking && p > 0.15) v.el.play().catch(() => {});
          if (!v.el.paused && !v.el.seeking) follow(v.el, tv);
          if (v.el.readyState >= 2) drawCover(g, v.el, rects[j]);
        });
        // fade da imagem: escurece até o preto
        const alpha = Math.max(fi && p < fi ? 1 - p / fi : 0, fo && p > len - fo ? (p - (len - fo)) / fo : 0);
        if (alpha > 0) { g.fillStyle = "rgba(0,0,0," + Math.min(1, alpha) + ")"; g.fillRect(0, 0, W, H); }
      }
      const f = Math.max(0, Math.min(1, p / len)); bar.style.width = f * 100 + "%"; pctEl.textContent = Math.round(f * 100) + "%";
      if (p >= len || cancelled) { try { rec.stop(); } catch (e) {} return; }
      raf = requestAnimationFrame(frame);
    };
    frame();
    await done; cancelAnimationFrame(raf);
    try { srcM.stop(); srcM.disconnect(); } catch (e) {} rendering = false; sleepAudioSoon(); cleanup();
    try { if (wake) wake.release(); } catch (e) {}
    if (cancelled || closed) { if (!closed) showEdit(); return; }
    const type = rec.mimeType || out[0]?.type || "video/mp4";
    showResult(new Blob(out, { type }));
  }

  function showResult(blob) {
    const ext = /mp4/.test(blob.type) ? "mp4" : "webm";
    const name = (song.name + " - " + keyName).replace(/[\\/:*?"<>|]+/g, "") + "." + ext;
    const url = URL.createObjectURL(blob);
    const file = new File([blob], name, { type: blob.type });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    box.innerHTML = header("Pronto! Confira e salve.") + `
      <div class="st-result"><video controls playsinline src="${url}"></video></div>
      ${canShare ? `<button class="btn primary st-big" id="stShare">Salvar ou compartilhar</button>` : ""}
      <a class="btn ${canShare ? "" : "primary st-big"}" style="text-align:center;text-decoration:none" href="${url}" download="${name}">Baixar o arquivo</a>
      <p class="small muted" style="margin:0">${canShare ? "No iPhone, escolha Salvar vídeo para ele ir para a galeria." : ""} Tamanho: ${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB.</p>
      <button class="btn" id="stBack">Voltar e ajustar a mixagem</button>
      <p class="small muted" style="margin:0;text-align:center">O projeto continua guardado neste aparelho, para você ajustar ou gravar mais vozes depois.</p>`;
    const sh = box.querySelector("#stShare");
    if (sh) sh.onclick = () => navigator.share({ files: [file], title: song.name }).catch(() => {});
    box.querySelector("#stBack").onclick = () => { URL.revokeObjectURL(url); showEdit(); };
  }
}
