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

export async function openStudio({ song, keyName, videoBlob, email, toast }) {
  if (!document.getElementById("st-css")) { const s = el("style"); s.id = "st-css"; s.textContent = CSS; document.head.appendChild(s); }
  const root = el("div", "st"); const box = el("div", "st-in"); root.appendChild(box); document.body.appendChild(root);
  document.body.style.overflow = "hidden";

  let camStream = null, recorder = null, chunks = [], wake = null, closed = false;
  let pbBuf = null, voiceBuf = null, recBlob = null, recUrl = null, recDur = 0, trimA = 0, trimB = 0;
  const fade = Object.assign({ i: 1, o: 2 }, (() => { try { return JSON.parse(lsGet("cp-rec-fade") || "{}"); } catch (e) { return {}; } })());
  let pbSrc = null, offsetAuto = 0;
  let pipVideo = null, pipUrl = URL.createObjectURL(videoBlob), pipPos = null, pipLevel = 0;
  let facing = lsGet("cp-rec-cam") === "environment" ? "environment" : "user";
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
  const vol = Object.assign({ v: 1, p: 0.8 }, (() => { try { return JSON.parse(lsGet(LS_VOL) || "{}"); } catch (e) { return {}; } })());
  let fix = +(lsGet(LS_FIX) || 0); // correção manual guardada

  async function keepAwake() { try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch (e) {} }
  function stopCam() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  function close() {
    closed = true; try { if (pbSrc) { pbSrc.stop(); pbSrc.disconnect(); } } catch (e) {} stopPreview(); stopCam();
    try { if (ctx) ctx.close(); } catch (e) {} ctx = null;
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (e) {}
    try { if (wake) wake.release(); } catch (e) {}
    try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch (e) {}
    URL.revokeObjectURL(pipUrl); if (recUrl) URL.revokeObjectURL(recUrl);
    root.remove(); document.body.style.overflow = "";
  }
  const header = sub => `<div class="hrow spread"><div><div class="small muted">Gravar meu vídeo  ·  tom ${escH(keyName)}</div><div style="font-size:22px;font-weight:700;line-height:1.15">${escH(song.name)}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div><button class="btn sm" data-st="close">Fechar</button></div>`;
  root.addEventListener("click", e => { const b = e.target.closest("[data-st]"); if (b && b.dataset.st === "close") { if (!recBlob || confirm("Sair e descartar esta gravação?")) close(); } });

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
  showSetup();

  function showSetup() {
    box.innerHTML = header() + `
      <details class="card" style="gap:8px" ${lsGet("cp-rec-tut") ? "" : "open"} id="stTut">
        <summary style="cursor:pointer"><b>Dicas para gravar o seu vídeo</b> <span class="small muted">(toque para ${lsGet("cp-rec-tut") ? "abrir" : "fechar"})</span></summary>
        <ol class="small" style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
          <li><b>Tom:</b> o vídeo usa o tom escolhido na tela da música. Se quiser outro, troque antes de entrar aqui.</li>
          <li><b>Lugar:</b> escolha um canto silencioso, com a luz de frente para você (janela à sua frente, não atrás).</li>
          <li><b>Celular:</b> apoie num suporte ou tripé, na altura dos olhos. Em pé para Reels e Status, deitado para YouTube.</li>
          <li><b>Fone:</b> coloque o fone antes de ligar a câmera (veja o quadro abaixo).</li>
          <li><b>Câmera:</b> toque em Ligar câmera. Arraste o vídeo com letra para onde ficar melhor e toque duas vezes nele para mudar o tamanho. Se o aparelho tiver mais de uma câmera ou microfone (por exemplo, uma interface de áudio), escolha qual usar em Equipamento, logo abaixo da câmera.</li>
          <li><b>Gravar:</b> toque em Gravar, espere a contagem de 3 e cante. A gravação para sozinha quando a música acaba, ou toque em Parar.</li>
          <li><b>Ajustar:</b> confira com o Play. Acerte o volume da voz e do playback, corte o começo e o fim pelas alças douradas e escolha o fade.</li>
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
    box.innerHTML = header("Arraste o vídeo com letra para onde quiser. Toque duas vezes nele para mudar o tamanho (pequeno, médio, grande).") + `
      <div class="st-cam" id="stCam">
        <video class="cam ${isMirror() ? "mirror" : ""}" id="stLive" playsinline muted autoplay></video>
        <div class="st-pip ${pipLevel ? "l" + pipLevel : ""}" id="stPip"><video playsinline muted preload="auto" src="${pipUrl}"></video></div>
        <div class="st-rec" id="stRecTag">● Gravando 0:00</div>
        <div class="st-count" id="stCount"></div>
      </div>
      <button class="btn st-big st-rec-btn" id="stGo">Gravar</button>
      ${equipHtml()}
      <p class="small muted" style="margin:0;text-align:center">O playback toca no fone e a gravação para sozinha quando a música acaba.</p>`;
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
    try { recorder = new MediaRecorder(camStream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 192_000 } : undefined); }
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
    recDur = (performance.now() - recT0) / 1000;
    try { pbSrc.onended = null; pbSrc.stop(); } catch (e) {} try { pbSrc.disconnect(); } catch (e) {}
    if (pipVideo) pipVideo.pause();
    try { recorder.stop(); } catch (e) {}
    box.innerHTML = header() + `<div class="empty">Preparando a sua gravação...</div>`;
  }
  async function onRecorded() {
    stopCam();
    recBlob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "video/mp4" }); chunks = [];
    recUrl = URL.createObjectURL(recBlob);
    try {
      const c = await freshAudio(); await applyOut();
      pbBuf = await c.decodeAudioData(await videoBlob.arrayBuffer());
      voiceBuf = await c.decodeAudioData(await recBlob.arrayBuffer());
    }
    catch (e) { console.warn(e); box.innerHTML = header() + `<div class="empty">A gravação foi feita, mas não consegui separar a voz neste aparelho. Avise a Janaine.</div>`; return; }
    if (closed) return;
    recDur = voiceBuf.duration; trimA = 0; trimB = recDur;
    showEdit();
  }

  /* ---------- 3. mixar e sincronizar ---------- */
  let preview = null; // { srcV, srcP, startCtx, startPos }
  function stopPreview() {
    if (!preview) return;
    try { preview.srcV.stop(); } catch (e) {} try { preview.srcP.stop(); } catch (e) {}
    // o iPhone às vezes ignora o "parar" de um som agendado: desligar os fios garante o silêncio
    try { preview.gM.disconnect(); } catch (e) {} try { preview.srcV.disconnect(); preview.srcP.disconnect(); } catch (e) {}
    if (preview.cam) { preview.cam.pause(); preview.cam.playbackRate = 1; } clearTimeout(preview.camPlay);
    cancelAnimationFrame(preview.raf); preview = null;
    const pb = box.querySelector("#stPlay"); if (pb) pb.textContent = "Play";
    const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 0;
    sleepAudioSoon();
  }
  const offset = () => offsetAuto + fix;
  // quando nada está tocando, o áudio do app "dorme" (some a onda da Dynamic Island e nenhum som fica preso)
  let rendering = false;
  function sleepAudioSoon() { setTimeout(() => { if (!preview && !recording && !rendering && ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, 400); }

  function showEdit() {
    const envV = envelope(voiceBuf), envP = envelope(pbBuf);
    let zoom = false, winStart = 0, playPos = 0; // posição na linha do tempo da gravação
    box.innerHTML = header("Ajuste o volume e a sincronia. Depois toque em Salvar vídeo.") + `
      <div class="st-cam"><video class="cam" id="stPrev" playsinline muted preload="auto" src="${recUrl}" style="transform:none"></video><div id="stFadeOv" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none"></div></div>
      <div class="card" style="gap:8px">
        <div class="tbig"><span id="stTime">0:00,0</span> <span class="small muted" style="font-weight:500">/ ${fmtT1(recDur)}</span></div>
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
      <div class="card">
        <b>Volume</b>
        <div class="mixrow"><label for="stVv">Sua voz</label><input type="range" id="stVv" min="0" max="2" step="0.01" value="${vol.v}"><output id="stVvO"></output></div>
        <div class="mixrow"><label for="stVp">Playback</label><input type="range" id="stVp" min="0" max="2" step="0.01" value="${vol.p}"><output id="stVpO"></output></div>
      </div>
      <div class="card">
        <b>Fade</b>
        <div class="mixrow"><label for="stFi">Fade de entrada</label><select class="field" id="stFi" style="padding:6px 10px">${[0, 0.5, 1, 2, 3].map(x => `<option value="${x}" ${x === fade.i ? "selected" : ""}>${x ? String(x).replace(".", ",") + " s" : "Sem fade"}</option>`).join("")}</select><span></span></div>
        <div class="mixrow"><label for="stFo">Fade de saída</label><select class="field" id="stFo" style="padding:6px 10px">${[0, 0.5, 1, 2, 3, 5].map(x => `<option value="${x}" ${x === fade.o ? "selected" : ""}>${x ? String(x).replace(".", ",") + " s" : "Sem fade"}</option>`).join("")}</select><span></span></div>
        <p class="small muted" style="margin:0">O fade abaixa o som e escurece a imagem aos poucos, no começo e no fim do vídeo final.</p>
      </div>
      <div class="card">
        <div class="hrow spread"><b>Sincronia</b><span class="small">Voz <span class="syncval" id="stSync"></span></span></div>
        <p class="small muted" style="margin:0">Arraste a faixa da sua voz para a esquerda ou para a direita até encaixar no playback. Use a lupa para ajustar no detalhe.</p>
        <div class="tabs"><button id="stZ0" aria-selected="true">Música toda</button><button id="stZ1" aria-selected="false">Lupa (4 segundos)</button></div>
        <div class="lanes" id="stLanes">
          <div class="lane"><span>Playback</span><canvas id="stCP"></canvas></div>
          <div class="lane drag"><span>Sua voz (arraste)</span><canvas id="stCV"></canvas></div>
        </div>
        <input type="range" id="stWin" min="0" max="${Math.max(0, recDur - 4).toFixed(2)}" step="0.05" value="${winStart}" aria-label="Posição da lupa" style="accent-color:var(--bronze)" hidden>
        <div class="nudges">
          <button class="btn sm" data-n="-0.05">⟨⟨ 50 ms</button><button class="btn sm" data-n="-0.01">⟨ 10 ms</button>
          <button class="btn sm" data-n="0.01">10 ms ⟩</button><button class="btn sm" data-n="0.05">50 ms ⟩⟩</button>
        </div>
        <div class="hrow" style="justify-content:center"><button class="link" id="stReset">Voltar ao ajuste automático</button></div>
      </div>
      <button class="btn primary st-big" id="stSave">Salvar vídeo</button>
      <button class="btn" id="stAgain">Gravar de novo</button>`;

    const cam = box.querySelector("#stPrev");
    const cP = box.querySelector("#stCP"), cV = box.querySelector("#stCV");
    const win = box.querySelector("#stWin");
    const vv = box.querySelector("#stVv"), vp = box.querySelector("#stVp");
    const pct = x => Math.round(x * 100) + "%";
    const showVol = () => { box.querySelector("#stVvO").textContent = pct(vol.v); box.querySelector("#stVpO").textContent = pct(vol.p); lsSet(LS_VOL, JSON.stringify(vol)); if (preview) { preview.gV.gain.value = vol.v; preview.gP.gain.value = vol.p; } };
    vv.oninput = () => { vol.v = +vv.value; showVol(); }; vp.oninput = () => { vol.p = +vp.value; showVol(); }; showVol();
    // linha do tempo no estilo dos editores: alças douradas no começo e no fim, cabeça de leitura branca
    const tl = box.querySelector("#stTL"), pctOf = t => (t / recDur) * 100 + "%";
    const showHead = p => { box.querySelector("#stHead").style.left = pctOf(Math.max(0, Math.min(recDur, p))); };
    const showTrim = () => {
      box.querySelector("#stDimA").style.cssText = "left:0;width:" + pctOf(trimA);
      box.querySelector("#stDimB").style.cssText = "left:" + pctOf(trimB) + ";right:0";
      const sel = box.querySelector("#stSel"); sel.style.left = pctOf(trimA); sel.style.width = pctOf(trimB - trimA);
      box.querySelector("#stAO").textContent = fmtT1(trimA); box.querySelector("#stBO").textContent = fmtT1(trimB); box.querySelector("#stLen").textContent = fmtT1(trimB - trimA);
      if (box.querySelector("#stCV")) draw();
    };
    const setTrim = (a, b) => { trimA = Math.max(0, Math.min(a, recDur - 1)); trimB = Math.min(recDur, Math.max(b, trimA + 1)); if (trimA > b - 1) trimA = Math.max(0, trimB - 1); showTrim(); };
    const tAt = x => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(recDur, ((x - r.left) / r.width) * recDur)); };
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
    // miniaturas do vídeo na faixa
    (async () => {
      const cvT = box.querySelector("#stThumbs"); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvT.width = cvT.clientWidth * dpr; cvT.height = cvT.clientHeight * dpr; const g = cvT.getContext("2d");
      const v = el("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.src = recUrl;
      v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none"; document.body.appendChild(v);
      try {
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; setTimeout(r, 4000); });
        const n = Math.max(4, Math.round(cvT.width / (cvT.height * 0.75))), tw = cvT.width / n;
        for (let i = 0; i < n; i++) {
          if (!box.contains(cvT)) break;
          v.currentTime = Math.min(recDur - 0.1, (i + 0.5) * recDur / n);
          await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
          const vw = v.videoWidth || 16, vh = v.videoHeight || 9, sc = Math.max(tw / vw, cvT.height / vh);
          g.save(); g.beginPath(); g.rect(i * tw, 0, tw, cvT.height); g.clip();
          g.drawImage(v, i * tw + (tw - vw * sc) / 2, (cvT.height - vh * sc) / 2, vw * sc, vh * sc); g.restore();
        }
      } catch (e) {}
      v.remove();
    })();
    const saveFade = () => lsSet("cp-rec-fade", JSON.stringify(fade));
    box.querySelector("#stFi").onchange = e => { fade.i = +e.target.value; saveFade(); };
    box.querySelector("#stFo").onchange = e => { fade.o = +e.target.value; saveFade(); };
    box.querySelector("#stTrimReset").onclick = () => setTrim(0, recDur);

    // desenho: eixo = tempo da gravação (câmera e voz ficam paradas; o playback é desenhado em offset)
    // Para a pessoa, quem se mexe é a VOZ: desenhamos o playback fixo e a voz deslocada por -offset.
    const t0 = () => zoom ? winStart : Math.min(0, -offset());
    const span = () => zoom ? 4 : Math.max(pbBuf.duration, recDur - offset()) - t0() + 0.3;
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
      const ta0 = trimA - offset(), tb0 = trimB - offset(); g.fillStyle = "#000000b0";
      const xa = ((ta0 - a) / sp) * w, xb = ((tb0 - a) / sp) * w;
      if (xa > 0) g.fillRect(0, 0, Math.min(w, xa), h); if (xb < w) g.fillRect(Math.max(0, xb), 0, w - Math.max(0, xb), h);
      if (playT != null) { const px = ((playT - a) / sp) * w; if (px >= 0 && px <= w) { g.fillStyle = "#efe6d2"; g.fillRect(px, 0, 2 * dpr, h); } }
    }
    // linha do tempo "do playback": playback começa em 0, a voz começa em -offset
    function draw(playT) {
      if (playT === undefined) playT = playPos - offset();
      drawLane(cP, envP, 0, "#c49a6c", playT);
      drawLane(cV, envV, -offset(), "#8a1a17", playT);
      box.querySelector("#stSync").textContent = ms(-fix);
    }
    const setFix = f => { fix = Math.max(-2, Math.min(2, f)); lsSet(LS_FIX, String(fix)); draw(); if (preview) startPreview(currentPos()); };
    box.querySelectorAll("[data-n]").forEach(b => b.onclick = () => setFix(fix - +b.dataset.n)); // voz para a direita = playback entra antes
    box.querySelector("#stReset").onclick = () => setFix(0);
    const setZoom = z => { zoom = z; box.querySelector("#stZ0").setAttribute("aria-selected", !z); box.querySelector("#stZ1").setAttribute("aria-selected", z); win.hidden = !z; if (z) { winStart = Math.max(0, Math.min(+win.max, (preview ? currentPos() - offset() : 0) - 0.5)); win.value = winStart; } draw(); };
    box.querySelector("#stZ0").onclick = () => setZoom(false); box.querySelector("#stZ1").onclick = () => setZoom(true);
    win.max = Math.max(0, pbBuf.duration - 4).toFixed(2);
    win.oninput = () => { winStart = +win.value; draw(); };

    // arrastar a faixa da voz
    const lanes = box.querySelector("#stLanes"); let drag = null;
    cV.parentElement.addEventListener("pointerdown", e => { drag = { x: e.clientX, f: fix, w: cV.clientWidth }; cV.parentElement.setPointerCapture(e.pointerId); });
    cV.parentElement.addEventListener("pointermove", e => { if (!drag) return; const dt = ((e.clientX - drag.x) / drag.w) * span(); fix = Math.max(-2, Math.min(2, drag.f - dt)); draw(); });
    const endDrag = () => { if (!drag) return; drag = null; setFix(fix); };
    cV.parentElement.addEventListener("pointerup", endDrag); cV.parentElement.addEventListener("pointercancel", endDrag);
    // tocar num ponto da faixa do playback = ouvir dali
    cP.parentElement.addEventListener("click", e => { const r = cP.getBoundingClientRect(); const tPb = t0() + ((e.clientX - r.left) / r.width) * span(); startPreview(Math.max(0, tPb + offset())); });

    // ouvir
    function currentPos() { return preview ? preview.startPos + (audioCtx().currentTime - preview.startCtx) : playPos; }
    function startPreview(pos) {
      stopPreview(); const c = audioCtx(); pos = Math.max(0, Math.min(pos, trimB - 0.05)); playPos = pos;
      const gM = c.createGain(); gM.connect(c.destination);
      const gV = c.createGain(), gP = c.createGain(); gV.gain.value = vol.v; gP.gain.value = vol.p;
      gV.connect(gM); gP.connect(gM);
      const srcV = c.createBufferSource(); srcV.buffer = voiceBuf; srcV.connect(gV);
      const srcP = c.createBufferSource(); srcP.buffer = pbBuf; srcP.connect(gP);
      const when = c.currentTime + 0.08;
      // fades dentro do trecho escolhido, para ouvir como vai ficar
      const L = trimB - trimA, fi = Math.min(fade.i, L / 2), fo = Math.min(fade.o, L / 2), rel = pos - trimA;
      const lvl = r => Math.max(0, Math.min(1, fi && r < fi ? r / fi : 1, fo && r > L - fo ? (L - r) / fo : 1));
      gM.gain.setValueAtTime(lvl(rel), when);
      if (fi && rel < fi) gM.gain.linearRampToValueAtTime(1, when + fi - rel);
      if (fo) { const tA = Math.max(0, L - fo - rel); gM.gain.setValueAtTime(lvl(rel + tA), when + tA); gM.gain.linearRampToValueAtTime(0, when + (L - rel)); }
      srcV.start(when, pos);
      const pIn = pos - offset(); // posição dentro do playback
      if (pIn >= 0) { if (pIn < pbBuf.duration) srcP.start(when, pIn); } else srcP.start(when - pIn, 0);
      cam.playbackRate = 1; cam.currentTime = pos;
      const camPlay = setTimeout(() => { const go = () => cam.play().catch(() => {}); if (cam.seeking) cam.addEventListener("seeked", go, { once: true }); else go(); }, 80);
      preview = { srcV, srcP, gV, gP, gM, startCtx: when, startPos: pos, cam, raf: 0, camPlay };
      box.querySelector("#stPlay").textContent = "Pause";
      const loop = () => {
        if (!preview) return; const p = currentPos();
        if (p >= trimB) { stopPreview(); box.querySelector("#stPlay").textContent = "Play"; seekTo(trimA); return; }
        if (!cam.paused && !cam.seeking) follow(cam, p);
        if (zoom && (p - offset() > winStart + 3.8)) { winStart = Math.min(+win.max, p - offset() - 0.2); win.value = winStart; }
        box.querySelector("#stTime").textContent = fmtT1(p); showHead(p);
        const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 1 - lvl(p - trimA);
        // redesenhar as ondas pesa no iPhone: só umas 8 vezes por segundo, para não atrapalhar a imagem
        const now = performance.now(); if (now - (preview.lastDraw || 0) > 120) { preview.lastDraw = now; draw(p - offset()); }
        preview.raf = requestAnimationFrame(loop);
      };
      loop();
    }
    // ir para um ponto: tocando, continua dali; pausado, mostra a imagem daquele ponto
    function seekTo(pos) {
      pos = Math.max(0, Math.min(recDur - 0.05, pos));
      if (preview) { startPreview(pos); return; }
      playPos = pos; cam.currentTime = pos;
      box.querySelector("#stTime").textContent = fmtT1(pos); showHead(pos);
      const ov = box.querySelector("#stFadeOv"); if (ov) ov.style.opacity = 0;
      if (zoom) { const pb = pos - offset(); if (pb < winStart || pb > winStart + 4) { winStart = Math.max(0, Math.min(+win.max, pb - 1)); win.value = winStart; } }
      draw();
    }
    box.querySelectorAll("[data-sk]").forEach(b => b.onclick = () => seekTo((preview ? currentPos() : playPos) + +b.dataset.sk));
    box.querySelector("#stPlay").onclick = () => { if (preview) { playPos = currentPos(); stopPreview(); seekTo(playPos); } else startPreview(playPos >= trimB - 0.1 || playPos < trimA ? trimA : playPos); };
    box.querySelector("#stAgain").onclick = () => { if (!confirm("Descartar esta gravação e gravar de novo?")) return; stopPreview(); URL.revokeObjectURL(recUrl); recBlob = null; voiceBuf = null; showSetup(); };
    box.querySelector("#stSave").onclick = () => { stopPreview(); render(); };
    requestAnimationFrame(() => { showTrim(); showHead(playPos); });
    window.addEventListener("resize", () => { if (box.querySelector("#stCV")) draw(); });
  }

  /* ---------- 4. juntar tudo num vídeo ---------- */
  async function render() {
    box.innerHTML = header() + `
      <div class="card stack">
        <b>Montando o seu vídeo</b>
        <p class="small muted" style="margin:0">O celular toca a música inteira por dentro para juntar a imagem, a sua voz e o playback. Leva o tempo do trecho escolhido. Não saia do app e não bloqueie a tela.</p>
        <div class="bar"><i id="stBar"></i></div><p class="small muted" id="stPct" style="margin:0">0%</p>
        <button class="btn" id="stCancel">Cancelar</button>
      </div>`;
    keepAwake(); rendering = true;
    const c = audioCtx();
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    const cam = el("video"); cam.muted = true; cam.playsInline = true; cam.setAttribute("playsinline", ""); cam.preload = "auto"; cam.src = recUrl;
    cam.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none"; document.body.appendChild(cam);
    await new Promise(r => { if (cam.readyState >= 1) r(); else cam.onloadedmetadata = r; });
    let W = cam.videoWidth || 1280, H = cam.videoHeight || 720; const k = Math.min(1, 1280 / Math.max(W, H)); W = Math.round(W * k / 2) * 2; H = Math.round(H * k / 2) * 2;
    const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    // o iPhone só "grava" um canvas que está na tela: fica pequenininho e invisível
    cv.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none"; document.body.appendChild(cv);
    // mixagem feita antes, fora do tempo real, em 48 kHz estéreo: volume, sincronia, corte e fades
    const len = trimB - trimA, SR = 48000;
    const fi = Math.min(fade.i, len / 2), fo = Math.min(fade.o, len / 2);
    let mix;
    try {
      const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(len * SR), SR);
      const gM = oc.createGain(); gM.connect(oc.destination);
      gM.gain.setValueAtTime(fi ? 0 : 1, 0); if (fi) gM.gain.linearRampToValueAtTime(1, fi);
      if (fo) { gM.gain.setValueAtTime(1, len - fo); gM.gain.linearRampToValueAtTime(0, len); }
      const gV = oc.createGain(), gP = oc.createGain(); gV.gain.value = vol.v; gP.gain.value = vol.p; gV.connect(gM); gP.connect(gM);
      const sV = oc.createBufferSource(); sV.buffer = voiceBuf; sV.connect(gV); sV.start(0, trimA);
      const sP = oc.createBufferSource(); sP.buffer = pbBuf; sP.connect(gP);
      const pIn = trimA - offset(); if (pIn >= 0) { if (pIn < pbBuf.duration) sP.start(0, pIn); } else sP.start(-pIn, 0);
      mix = await oc.startRendering();
    } catch (e) { console.warn(e); cam.remove(); cv.remove(); rendering = false; toast("Não consegui fazer a mixagem neste aparelho."); showEdit(); return; }
    const dest = c.createMediaStreamDestination(); dest.channelCount = 2;
    const srcM = c.createBufferSource(); srcM.buffer = mix; srcM.connect(dest);
    const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime(); const out = [];
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 } : undefined); }
    catch (e) { cv.remove(); cam.remove(); rendering = false; toast("Este aparelho não conseguiu montar o vídeo."); showEdit(); return; }
    rec.ondataavailable = e => { if (e.data && e.data.size) out.push(e.data); };
    let cancelled = false, raf = 0;
    const done = new Promise(r => { rec.onstop = r; });
    box.querySelector("#stCancel").onclick = () => { cancelled = true; try { rec.stop(); } catch (e) {} };

    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    cam.currentTime = trimA; await new Promise(r => { cam.onseeked = r; setTimeout(r, 1500); });
    rec.start(1000);
    await new Promise(r => setTimeout(r, 150));
    const when = c.currentTime + 0.1;
    srcM.start(when);
    setTimeout(() => cam.play().catch(() => {}), 100);
    const bar = box.querySelector("#stBar"), pctEl = box.querySelector("#stPct");
    const frame = () => {
      const p = c.currentTime - when;
      if (p >= 0 && cam.readyState >= 2) { if (!cam.paused && !cam.seeking) follow(cam, trimA + p); g.drawImage(cam, 0, 0, W, H);
        // fade da imagem: escurece até o preto
        const alpha = Math.max(fi && p < fi ? 1 - p / fi : 0, fo && p > len - fo ? (p - (len - fo)) / fo : 0);
        if (alpha > 0) { g.fillStyle = "rgba(0,0,0," + Math.min(1, alpha) + ")"; g.fillRect(0, 0, W, H); } }
      const f = Math.max(0, Math.min(1, p / len)); bar.style.width = f * 100 + "%"; pctEl.textContent = Math.round(f * 100) + "%";
      if (p >= len || cancelled) { try { rec.stop(); } catch (e) {} return; }
      raf = requestAnimationFrame(frame);
    };
    frame();
    await done; cancelAnimationFrame(raf);
    try { srcM.stop(); srcM.disconnect(); } catch (e) {} rendering = false; sleepAudioSoon(); cam.pause(); cam.remove(); cv.remove();
    try { if (wake) wake.release(); } catch (e) {}
    if (cancelled || closed) { if (!closed) showEdit(); return; }
    const type = rec.mimeType || out[0]?.type || "video/mp4";
    const final = new Blob(out, { type });
    showResult(final);
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
      <button class="btn" id="stBack">Voltar e ajustar a mixagem</button>`;
    const sh = box.querySelector("#stShare");
    if (sh) sh.onclick = () => navigator.share({ files: [file], title: song.name }).catch(() => {});
    box.querySelector("#stBack").onclick = () => { URL.revokeObjectURL(url); showEdit(); };
  }
}
