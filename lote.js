// Envio em lote: a Janaine escolhe (ou arrasta) uma pasta inteira, o app reconhece
// música, tom e tipo de cada arquivo pelos nomes, mostra tudo para conferir
// e depois envia sozinho, uma música de cada vez.
//
// Regras de leitura dos nomes:
// - Música: nome da pasta da música (pastas como "Vídeos", "Partituras", "720p" são ignoradas).
//   Se os arquivos estiverem soltos numa pasta só, o nome vem do próprio arquivo.
// - Tom: a última "palavra" do nome que é uma tonalidade (C, Cm, Bb, F#m...). Vale também o nome da subpasta.
// - Tipo: .mp4 = vídeo; PDF ou imagem com "letra" no nome = letra; outros PDFs = partitura.
//   Áudios são ignorados (o app não usa áudio).

const CAT = new Set(["video", "videos", "partitura", "partituras", "letra", "letras", "audio", "audios", "mp4", "pdf", "pdfs",
  "720p", "720", "1080p", "1080", "clube app", "app", "convertido", "convertidos", "convertida", "convertidas", "handbrake",
  "karaoke", "karaokes", "wav", "mp3", "arquivos", "arquivo", "playback", "playbacks", "trio", "piano", "trio playback",
  "piano playback", "clube playback", "pp", "tp", "fem", "feminina", "feminino", "masc", "masculina", "masculino", "inter", "intermediaria", "intermediario", "lyric", "lyrics", "lyric video", "lyric videos", "exportados"]); // sem "final", "novos" etc.: podem fazer parte do nome ("Final feliz")
const VIDEO_EXT = ["mp4", "m4v", "mov"], DOC_EXT = ["pdf", "jpg", "jpeg", "png", "webp"], AUDIO_EXT = ["mp3", "wav", "aif", "aiff", "m4a", "flac", "aac", "ogg"];
const TONE = /^([A-G])(#|b|♯|♭)?(m)?$/;
const SPLIT = /[\s_\-.()[\],+&]+/;

import { ACERVO_PIANO, ACERVO_TRIO } from "./acervo.js";
// Nome da música sempre regular: se está no acervo, usa a grafia do acervo (acentos e maiúsculas certos);
// se é nova, só a primeira letra maiúscula (mantém nomes próprios conhecidos)
const PROPER = ["Deus", "Maria", "João", "José", "Jesus", "Rio", "Ipanema", "Brasil", "Natal", "América", "Bahia", "Minas", "Itapuã", "Santo", "Amaro", "Odeon", "Saigon", "Luiza", "Madalena", "Beatriz", "Sampa", "Copacabana", "Senhora", "Nossa", "Índio", "Branca", "Gita", "Asa", "I", "II", "Love", "You"];
function acervoPrefix(raw, fmt) {
  const r = C.slug(raw) + "-";
  const lists = fmt === "piano" ? [ACERVO_PIANO, ACERVO_TRIO] : [ACERVO_TRIO, ACERVO_PIANO];
  for (const list of lists) {
    const hits = list.filter(a => r.startsWith(C.slug(a[0]) + "-")).sort((a, b) => C.slug(b[0]).length - C.slug(a[0]).length);
    if (hits.length) return hits[0][0];
  }
  return "";
}
function properName(name) {
  const sl = C.slug(name);
  const hit = ACERVO_TRIO.concat(ACERVO_PIANO).find(a => C.slug(a[0]) === sl);
  if (hit) return hit[0];
  const words = String(name || "").trim().replace(/\s+/g, " ").split(" ");
  return words.map((w, i) => {
    const p = PROPER.find(x => C.norm(x) === C.norm(w));
    if (p && i > 0) return p;
    const lw = w.toLocaleLowerCase("pt-BR");
    return i === 0 ? lw.charAt(0).toLocaleUpperCase("pt-BR") + lw.slice(1) : lw;
  }).join(" ");
}
let C = null; // contexto vindo do app.js
// No Piano, todo tom fica no padrão do app: F-E (Feminina), I-C (Intermediária), M-A (Masculina)
const hasGen = t => /^[FIM]-/.test(String(t || ""));
// tom sem F-/I-/M- numa música do Piano: descobre pelo acervo (ordem Feminina/Intermediária/Masculina)
function genFromAcervo(song, tone) {
  const a = ACERVO_PIANO.find(x => C.slug(x[0]) === C.slug(song)); if (!a) return "";
  const tons = a[1].split("/").map(t => t.trim()); const hits = tons.map((t, i) => t.toLowerCase() === String(tone).toLowerCase() ? i : -1).filter(i => i >= 0);
  return hits.length === 1 ? "FIM"[hits[0]] : "";
}
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const extOf = n => (n.split(".").pop() || "").toLowerCase();
const baseOf = n => n.replace(/\.[^.]+$/, "");
const isCat = s => CAT.has(C.norm(s).replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim());
const fixTone = t => t.replace("♯", "#").replace("♭", "b");
// Piano Playback: "F-E" = Feminina em E, "I-G" = Intermediária em G, "M-C" = Masculina em C
const GEN = /(^|[\s_(])([FIM])\s*[-–_]\s*([A-G](?:#|b|♯|♭)?m?)(?=$|[\s_\-.)])/g;
const GEN_RANK = { F: 0, I: 1, M: 2 };
const splitKey = k => { const m = String(k || "").trim().match(/^([FIM])\s*-\s*(.+)$/); return m ? { g: m[1], t: m[2] } : { g: "", t: String(k || "").trim() }; };
function keyEq(a, b) { const x = splitKey(a), y = splitKey(b); return x.t.toLowerCase() === y.t.toLowerCase() && (!x.g || !y.g || x.g === y.g); }
// Nos arquivos: FEM / INTER / MASC (ou Feminina...) com o tom em outra palavra do nome
const GW = { fem: "F", feminina: "F", feminino: "F", inter: "I", intermediaria: "I", intermediario: "I", masc: "M", masculina: "M", masculino: "M" };
function genIn(s) {
  let m, last = null; GEN.lastIndex = 0;
  while ((m = GEN.exec(String(s || "")))) last = m;
  if (!last) {
    const parts = String(s || "").split(/([\s_\-.()[\]]+)/);
    const gi = parts.findIndex(t => GW[C.norm(t)]); if (gi < 0) return null;
    let ti = -1, best = 1e9;
    parts.forEach((t, i) => { if (i !== gi && TONE.test(fixTone(t)) && Math.abs(i - gi) < best) { best = Math.abs(i - gi); ti = i; } });
    const g = GW[C.norm(parts[gi])], tone = ti >= 0 ? fixTone(parts[ti]) : "";
    const rest = parts.map((t, i) => (i === gi || i === ti) ? " " : t).join("").replace(/\s+/g, " ").trim();
    return { g, tone, rest };
  }
  const str = String(s); const at = last.index + last[1].length;
  return { g: last[2], tone: fixTone(last[3]), rest: (str.slice(0, at) + " " + str.slice(at + last[0].length - last[1].length)).replace(/\s+/g, " ").trim() };
}
function toneAtEnd(s) { const t = String(s || "").split(SPLIT).filter(Boolean).pop() || ""; const f = fixTone(t); return TONE.test(f) ? f : ""; }
function toneIn(s) {
  const gm = genIn(s); if (gm) return gm.tone;
  const toks = String(s || "").split(SPLIT).filter(Boolean);
  for (let i = toks.length - 1; i >= 0; i--) { const t = fixTone(toks[i]); if (TONE.test(t)) return t; }
  // "Tom D", "tom-Bb" já caem acima; "D.mp4" também
  return "";
}
// tira número na frente ("01 - "), tons entre parênteses no fim ("(D/G)") e espaços extras
// BPM no nome ("70bpm", "| 70 BPM |", "BPM 70"): sai do nome e vira o BPM da música
const BPM_RE = /(?:^|[\s_|\-(\[])(?:(\d{2,3})\s*bpm|bpm\s*[:=]?\s*(\d{2,3}))(?=$|[\s_|\-)\].])/i;
// número sozinho entre barras ("Estrada de sol | | 124 |") também é BPM
const PIPE_BPM = /\|\s*(\d{2,3})\s*(?=\||$)/;
function bpmIn(s) { const m = String(s || "").match(BPM_RE); if (m) return m[1] || m[2]; const p = String(s || "").match(PIPE_BPM); return p ? p[1] : ""; }
function stripBpm(s) { return String(s || "").replace(new RegExp(BPM_RE.source, "gi"), " ").replace(new RegExp(PIPE_BPM.source, "g"), " ").replace(/\s*\|\s*/g, " ").replace(/[\s\-–_]+$/, "").replace(/^[\s\-–_]+/, "").replace(/\s+/g, " ").trim(); }
function cleanSong(s) {
  return stripBpm(s).replace(/^\s*\d+\s*[-_.)]\s*/, "").replace(/\s*[([][^)\]]*[)\]]\s*$/, m => {
    const inner = m.replace(/[()[\]]/g, "").split(/[\s/\-,e]+/).filter(Boolean);
    return inner.length && inner.every(t => TONE.test(fixTone(t))) ? "" : m;
  }).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}
// nome da música a partir do nome do arquivo: tira o tom, as palavras de categoria e marcas de conversão
// noTone: não procura tom solto (arquivo de letra, ou pasta no padrão F-/I-/M- do Piano)
function songFromFile(name, noTone) {
  const gm = genIn(stripBpm(baseOf(name))); const base = gm ? gm.rest : stripBpm(baseOf(name));
  const tone = gm || /letra/.test(C.norm(name)) ? "" : noTone ? toneAtEnd(stripBpm(base)) : toneIn(base);
  let toks = base.split(/[\s_()[\]]+/).filter(t => t && !/^[-–,.+&]+$/.test(t));
  if (tone) { const i = toks.map(fixTone).lastIndexOf(tone); if (i >= 0) toks.splice(i, 1); }
  if (toks.length > 1 && /^\d{1,3}$/.test(toks[0])) toks.shift();
  toks = toks.filter(t => !isCat(t) && !/^(\d{3,4}p\d*|hd|fast|rf\d+|v\d+|tom)$/i.test(t));
  return cleanSong(toks.join(" ").replace(/\s*[-–]\s*$/, "").replace(/^\s*[-–]\s*/, ""));
}
// nome do botão da partitura: o nome do arquivo sem a música, sem o tom e sem "partitura"
function sheetLabel(name, song) {
  const gm = genIn(baseOf(name)); let s = gm ? gm.rest : baseOf(name); const tone = gm ? "" : toneIn(s);
  const ns = C.norm(song);
  let toks = s.split(/[\s_()[\]]+/).filter(t => t && !/^[-–,.+&]+$/.test(t));
  if (toks.length > 1 && /^\d{1,3}$/.test(toks[0])) toks.shift();
  if (tone) { const i = toks.map(fixTone).lastIndexOf(tone); if (i >= 0) toks.splice(i, 1); }
  let out = toks.join(" ");
  if (ns && C.norm(out).includes(ns)) { const i = C.norm(out).indexOf(ns); out = out.slice(0, i) + out.slice(i + ns.length); }
  out = out.split(/\s+/).filter(t => t && !/^(partitura|partituras|tom|pdf|[-–()]|\d{3,4}p\d*|fast|hd)$/i.test(t)).join(" ").replace(/^[\s\-–()]+|[\s\-–()]+$/g, "");
  out = out.trim();
  return out ? out[0].toUpperCase() + out.slice(1) : "Partitura";
}

function videoHeight(file) {
  return new Promise(res => {
    const v = document.createElement("video"); const u = URL.createObjectURL(file); let done = false;
    const end = h => { if (done) return; done = true; URL.revokeObjectURL(u); v.removeAttribute("src"); res(h); };
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => end(Math.min(v.videoWidth, v.videoHeight) || 0);
    v.onerror = () => end(0); setTimeout(() => end(0), 8000); v.src = u;
  });
}

// lê pastas arrastadas (computador)
async function filesFromDrop(dt) {
  const out = []; const items = [...(dt.items || [])];
  const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])].map(f => ({ file: f, rel: f.name }));
  async function walk(entry, path) {
    if (entry.isFile) { const f = await new Promise((r, j) => entry.file(r, j)); out.push({ file: f, rel: path + f.name }); return; }
    const reader = entry.createReader(); let batch;
    do { batch = await new Promise((r, j) => reader.readEntries(r, j)); for (const e of batch) await walk(e, path + entry.name + "/"); } while (batch.length);
  }
  for (const e of entries) await walk(e, "");
  return out;
}

export function openLote(ctx) {
  C = ctx;
  const S = { step: "pick", fmt: "", items: [], groups: [], busy: false, log: [], progress: 0, now: "" };
  const root = el("div", "st lote"); root.style.cssText = "position:fixed;inset:0;z-index:30;background:var(--ink);overflow:auto";
  const box = el("div", "stack"); box.style.cssText = "max-width:760px;margin:0 auto;padding:calc(18px + env(safe-area-inset-top)) 18px calc(60px + env(safe-area-inset-bottom))";
  root.appendChild(box); document.body.appendChild(root); document.body.style.overflow = "hidden";
  const close = () => { if (S.busy) return; root.remove(); document.body.style.overflow = ""; window.removeEventListener("beforeunload", stay); };
  const stay = e => { if (S.busy) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", stay);

  const songsNow = () => C.getSongs();
  const findSong = (name, fmt) => { const sl = C.slug(name); return songsNow().find(s => (s.formacao === "piano" ? "piano" : "trio") === fmt && C.slug(s.name) === sl); };
  const group = gid => S.groups.find(g => g.gid === gid);

  async function load(list) {
    list = list.filter(x => x.file && !x.file.name.startsWith(".") && x.file.size > 0);
    if (!list.length) return C.toast("Não achei arquivos nessa pasta.");
    S.step = "reading"; render();
    // 1) música de cada arquivo
    const dirsOf = x => x.rel.split("/").slice(0, -1);
    const meta = list.map(x => {
      const dirs = dirsOf(x); const keep = dirs.filter(d => !isCat(d));
      const all = [...dirs, baseOf(x.file.name)];
      const fmtHint = all.some(d => /(^|[^a-z])pp([^a-z]|$)/i.test(d)) ? "piano" : all.some(d => /(^|[^a-z])tp([^a-z]|$)/i.test(d)) ? "trio"
        : dirs.some(d => /piano/i.test(d)) ? "piano" : dirs.some(d => /trio/i.test(d)) ? "trio" : "";
      return { ...x, dirs, keep, fmtHint };
    });
    const genStyle = meta.some(m => genIn(baseOf(m.file.name)));
    // no Piano com padrão de gênero, uma letra solta no nome (ex.: "A paz") não é tom; no Trio é
    const fmtOf = m => S.fmt === "auto" ? (m.fmtHint || "trio") : S.fmt; // Trio ou Piano escolhido vale para todas
    const strict = m => genStyle && fmtOf(m) === "piano";
    const sff = (n, m) => songFromFile(n, m ? strict(m) : genStyle);
    const anyDeep = meta.some(m => m.keep.length >= 2);
    const rootName = meta[0].dirs[0] || "";
    const rootIsSong = rootName && !isCat(rootName);
    const loose = meta.filter(m => !(anyDeep ? m.keep.length >= 2 : false));
    // arquivos soltos: usar a pasta como nome se os vídeos não mostrarem nomes diferentes
    const looseVideoNames = new Set(loose.filter(m => VIDEO_EXT.includes(extOf(m.file.name))).map(m => C.slug(sff(m.file.name, m))).filter(Boolean));
    const looseUseRoot = rootIsSong && !anyDeep && looseVideoNames.size <= 1;
    for (const m of meta) {
      let song = "";
      if (anyDeep && m.keep.length >= 2) song = (rootIsSong && m.keep[0] === rootName) ? m.keep[1] : m.keep[0];
      else if (looseUseRoot) song = rootName;
      else if (anyDeep && m.keep.length === 1 && m.keep[0] !== rootName) song = m.keep[0];
      const src = song || baseOf(m.file.name);
      if (!song) { song = sff(m.file.name, m); m.fromFile = true; }
      // o nome certo vem no começo: se o começo bate com uma música do acervo, usa ela (a mais comprida que bater)
      m.song = acervoPrefix(src.replace(/^\s*\d+\s*[-_.)]\s*/, ""), fmtOf(m)) || cleanSong(song) || "Sem nome";
    }
    // partitura/letra solta com nome mais comprido ("Andança Baixo") vai para a música do vídeo ("Andança")
    const vidNames = [...new Set(meta.filter(m => m.fromFile && VIDEO_EXT.includes(extOf(m.file.name))).map(m => m.song))].concat(songsNow().map(s => s.name)).sort((a, b) => b.length - a.length);
    for (const m of meta) if (m.fromFile && !VIDEO_EXT.includes(extOf(m.file.name))) {
      const hit = vidNames.find(n => C.norm(n) !== C.norm(m.song) && (" " + C.norm(baseOf(m.file.name)).replace(/[_\-()]+/g, " ") + " ").includes(" " + C.norm(n) + " "));
      if (hit) m.song = hit;
    }
    // 2) grupos
    S.groups = []; S.items = [];
    const gByName = {};
    for (const m of meta) {
      const fmt = fmtOf(m);
      const k = fmt + "|" + C.slug(m.song);
      if (!gByName[k]) {
        const ex = findSong(m.song, fmt);
        gByName[k] = { gid: "g" + S.groups.length, name: ex ? ex.name : properName(m.song), fmt, bpm: ex && ex.bpm ? ex.bpm : "", order: [] };
        S.groups.push(gByName[k]);
      }
      if (!gByName[k].bpm) { const b = [...m.dirs, baseOf(m.file.name)].map(bpmIn).find(Boolean); if (b) gByName[k].bpm = b; }
      const ext = extOf(m.file.name);
      // tom: no arquivo; se não tiver, na subpasta mais próxima
      const gmf = genIn(baseOf(m.file.name));
      let tone = gmf ? (gmf.tone ? gmf.g + "-" + gmf.tone : "") : /letra/.test(C.norm(m.file.name)) ? "" : strict(m) ? toneAtEnd(stripBpm(baseOf(m.file.name))) : toneIn(baseOf(m.file.name)); if (!tone && !strict(m)) for (let i = m.dirs.length - 1; i >= 0 && !tone; i--) tone = (m.dirs[i].split(SPLIT).length <= 3) ? toneIn(m.dirs[i]) : "";
      let type = "skip", note = "";
      if (VIDEO_EXT.includes(ext)) type = "video";
      else if (DOC_EXT.includes(ext)) type = /letra/.test(C.norm(m.file.name)) ? "letra" : "sheet";
      else if (AUDIO_EXT.includes(ext)) note = "áudio (o app não usa)";
      else note = "tipo de arquivo que o app não usa";
      if (ext === "mov" || ext === "m4v") note = "converta para MP4 antes";
      if (type === "sheet" && !tone) note = "escolha o tom";
      S.items.push({ id: "f" + S.items.length, file: m.file, rel: m.rel, gid: gByName[k].gid, type: (ext === "mov" || ext === "m4v") ? "skip" : type, tone, g: (genIn(baseOf(m.file.name)) || {}).g || "", label: type === "sheet" ? sheetLabel(m.file.name, m.song) : "", note, h: 0 });
    }
    // 3) altura dos vídeos (para separar o original grande do convertido)
    const vids = S.items.filter(i => VIDEO_EXT.includes(extOf(i.file.name)));
    let idx = 0; S.now = "Conferindo os vídeos (0 de " + vids.length + ")"; render();
    await Promise.all([0, 1, 2, 3].map(async () => { while (idx < vids.length) { const v = vids[idx++]; v.h = await videoHeight(v.file); S.now = "Conferindo os vídeos (" + idx + " de " + vids.length + ")"; const p = box.querySelector("#lnow"); if (p) p.textContent = S.now; } }));
    // dois vídeos no mesmo tom: fica o de 720p (ou o menor)
    const byTone = {};
    for (const v of vids.filter(v => v.type === "video" && v.tone)) (byTone[v.gid + "|" + v.tone] = byTone[v.gid + "|" + v.tone] || []).push(v);
    for (const arr of Object.values(byTone)) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => ((a.h && a.h <= 720) ? 0 : 1) - ((b.h && b.h <= 720) ? 0 : 1) || a.file.size - b.file.size);
      arr.slice(1).forEach(v => { v.type = "skip"; v.note = "outro vídeo do mesmo tom (fica o " + (arr[0].h ? arr[0].h + "p" : "menor") + ")"; });
    }
    for (const v of vids) if (v.type === "video" && v.h > 720) { v.type = "skip"; v.note = "ainda em " + v.h + "p: converta no HandBrake antes"; }
    applyExisting();
    S.step = "review"; render();
  }

  // compara com o que já está no catálogo: não reenvia o que já existe
  function applyExisting() {
    for (const g of S.groups) {
      const ex = findSong(g.name, g.fmt); g.exists = !!ex;
      for (const it of S.items.filter(i => i.gid === g.gid && (i.type === "video" || i.type === "sheet") && i.tone)) {
        if (g.fmt === "piano" && !hasGen(it.tone)) { const gg = genFromAcervo(g.name, it.tone); if (gg) it.tone = gg + "-" + it.tone; }
        if (g.fmt === "trio" && hasGen(it.tone)) it.tone = it.tone.slice(2);
      }
      for (const it of S.items.filter(i => i.gid === g.gid)) {
        if (it.auto) { it.type = it.auto.type; it.note = it.auto.note; delete it.auto; }
        if (!ex) continue;
        const kd = (ex.keys || []).find(k => keyEq(k.key, it.tone));
        let why = "";
        if (it.type === "video" && kd && kd.video) why = "esse tom já tem vídeo";
        if (it.type === "letra" && ex.letra) why = "essa música já tem letra";
        if (it.type === "sheet" && kd && C.sheetsOf(kd).some(s => C.norm(s.label) === C.norm(it.label))) why = "essa partitura já foi enviada";
        if (why) { it.auto = { type: it.type, note: it.note }; it.type = "skip"; it.note = why + " (escolha o tipo para substituir)"; }
      }
      // ordem dos tons: começa pela ordem do catálogo, depois a dos arquivos
      const tones = [];
      (ex ? ex.keys.map(k => k.key) : []).forEach(t => tones.includes(t) || tones.push(t));
      S.items.filter(i => i.gid === g.gid && i.type !== "skip" && i.type !== "letra" && i.tone).sort((a, b) => (GEN_RANK[hasGen(a.tone) ? a.tone[0] : a.g] ?? 9) - (GEN_RANK[hasGen(b.tone) ? b.tone[0] : b.g] ?? 9) || a.file.name.localeCompare(b.file.name)).forEach(i => {
        const same = tones.find(t => keyEq(t, i.tone)); if (same) i.tone = same; else tones.push(i.tone);
      });
      g.order = g.order.filter(t => tones.includes(t)).concat(tones.filter(t => !g.order.includes(t)));
      if (g.fmt === "piano" && g.order.every(hasGen)) g.order.sort((a, b) => GEN_RANK[a[0]] - GEN_RANK[b[0]]);
    }
    S.groups = S.groups.filter(g => S.items.some(i => i.gid === g.gid));
  }

  // o que falta em cada música
  function status(g) {
    const its = S.items.filter(i => i.gid === g.gid && i.type !== "skip");
    if (!its.length) return { ok: false, idle: true, text: "Nada para enviar" };
    const ex = findSong(g.name, g.fmt);
    if (its.some(i => (i.type === "video" || i.type === "sheet") && !i.tone)) return { ok: false, text: "Falta escolher o tom de algum arquivo" };
    if (g.fmt === "piano" && its.some(i => (i.type === "video" || i.type === "sheet") && !hasGen(i.tone))) return { ok: false, text: "No Piano, escreva F-, I- ou M- antes do tom (ex.: F-E)" };
    const has = t => its.some(i => i.type === "video" && keyEq(i.tone, t)) || (ex && (ex.keys || []).some(k => keyEq(k.key, t) && k.video));
    const miss = g.order.filter(t => !has(t));
    if (miss.length) return { ok: false, text: "Falta o vídeo do tom " + miss.join(", ") };
    return { ok: true, text: ex ? "Vai completar a música que já existe" : "Música nova, pronta" };
  }

  function render() {
    const fmtBtns = (cur, attr) => [["trio", "Trio"], ["piano", "Piano"]].map(([v, l]) => `<button type="button" role="radio" aria-selected="${cur === v}" ${attr}="${v}">${l}</button>`).join("");
    if (S.step === "pick") {
      const canDir = "webkitdirectory" in document.createElement("input");
      box.innerHTML = `<div class="hrow spread"><h1 class="title">Enviar uma pasta</h1><button class="btn sm" data-l="close">Fechar</button></div>
        <div class="card"><p class="small" style="margin:0">Escolha a pasta com as músicas. Pode ser a pasta de uma música só ou uma pasta com várias músicas dentro. O app reconhece sozinho:</p>
          <ul class="small muted" style="margin:0;padding-left:18px"><li>a música, pelo nome da pasta (ou do arquivo, se estiverem soltos);</li><li>o tom, pelo nome do arquivo (ex.: <b>Andança D.mp4</b>, <b>Andança G Piano.pdf</b>);</li><li>vídeo (MP4), letra (PDF com "letra" no nome) e partituras (os outros PDFs).</li></ul>
          <p class="small muted" style="margin:0">Áudios e vídeos ainda em 1080p ficam de fora. Antes de enviar, você confere tudo.</p></div>
        <div class="card"><b class="small">Todas as músicas desta pasta são</b><div class="tabs" role="radiogroup">${fmtBtns(S.fmt, "data-fmt")}<button type="button" role="radio" aria-selected="${S.fmt === "auto"}" data-fmt="auto">Misturadas</button></div>
          <p class="small muted" style="margin:0">${!S.fmt ? "" : S.fmt === "auto" ? "Misturadas: o app decide por PP/TP ou Piano/Trio no nome do arquivo ou da pasta (sem nada, vira Trio)." : "Todas entram como " + (S.fmt === "piano" ? "Piano" : "Trio") + ", seja qual for o nome dos arquivos."}</p></div>
        ${!S.fmt ? `<p class="small" style="margin:0;color:var(--warn)">Escolha primeiro se a pasta é Trio, Piano ou Misturada.</p>` : `<div id="ldrop" class="card" style="border-style:dashed;align-items:center;text-align:center;padding:28px 16px">
          ${canDir ? `<label class="btn primary" style="cursor:pointer">Escolher pasta<input id="ldir" type="file" webkitdirectory multiple hidden></label>` : ""}
          <label class="btn ${canDir ? "" : "primary"}" style="cursor:pointer">Escolher arquivos<input id="lfiles" type="file" multiple hidden accept="video/mp4,application/pdf,image/*"></label>
          ${canDir ? `<p class="small muted" style="margin:0">ou arraste a pasta para cá</p>` : ""}</div>`}`;
      return;
    }
    if (S.step === "reading") { box.innerHTML = `<h1 class="title">Lendo a pasta...</h1><p class="muted" id="lnow">${C.esc(S.now || "")}</p>`; return; }
    if (S.step === "review") {
      const ready = S.groups.filter(g => status(g).ok);
      const nFiles = S.items.filter(i => i.type !== "skip" && ready.some(g => g.gid === i.gid));
      const size = nFiles.reduce((a, i) => a + i.file.size, 0);
      const skipped = S.items.filter(i => i.type === "skip").length;
      box.innerHTML = `<div class="hrow spread"><h1 class="title">Conferir antes de enviar</h1><button class="btn sm" data-l="close">Fechar</button></div>
        <div class="card"><b>${ready.length} de ${S.groups.length} ${S.groups.length === 1 ? "música pronta" : "músicas prontas"}  ·  ${nFiles.length} ${nFiles.length === 1 ? "arquivo" : "arquivos"}  ·  ${C.mb(size)}</b>
          <p class="small muted" style="margin:0">${skipped ? skipped + " arquivo" + (skipped > 1 ? "s ficam" : " fica") + " de fora (estão marcados como Ignorar, com o motivo). " : ""}Você pode mudar o nome, a formação, o tipo e o tom de qualquer arquivo. As músicas com aviso não são enviadas até resolver.</p>
          <div class="hrow small muted" style="flex-wrap:wrap;gap:6px">Mudar todas para: <button class="btn sm" data-l="allfmt" data-v="trio">Trio</button><button class="btn sm" data-l="allfmt" data-v="piano">Piano</button></div>
          ${(() => { const nr = S.groups.filter(g => !status(g).ok && !status(g).idle); return nr.length ? `<div class="small" style="color:var(--bad);border:1px solid var(--bad);border-radius:10px;padding:8px 10px"><b>${nr.length} ${nr.length > 1 ? "músicas NÃO vão subir" : "música NÃO vai subir"} se você enviar agora:</b><br>${nr.map(g => C.esc(g.name) + ": " + C.esc(status(g).text)).join("<br>")}</div>` : ""; })()}
          <button class="btn primary" data-l="send" ${ready.length ? "" : "disabled"}>Enviar ${ready.length === 1 ? "1 música" : ready.length + " músicas"}</button>
          <button class="link" data-l="restart">Escolher outra pasta</button></div>
        ${S.groups.map(g => groupCard(g, fmtBtns)).join("")}`;
      return;
    }
    if (S.step === "sending") {
      box.innerHTML = `<h1 class="title">Enviando...</h1><p class="small muted" style="margin:0">Não feche esta tela nem bloqueie o computador até terminar.</p>
        <div class="bar"><i style="width:${(S.progress * 100).toFixed(1)}%"></i></div><p class="small" id="lnow">${C.esc(S.now)}</p>
        <div class="list">${S.log.map(l => `<div class="row"><span class="name small">${C.esc(l.name)}</span><span class="pill ${l.ok ? "ok" : "bad"}">${l.ok ? "enviada" : "erro"}</span></div>`).join("")}</div>`;
      return;
    }
    if (S.step === "done") {
      const bad = S.log.filter(l => !l.ok);
      const left = (S.left || []), lf = (S.leftFiles || []);
      const leftHtml = (left.length || lf.length) ? `<div class="card" style="border-color:var(--bad)"><b style="color:var(--bad)">Atenção: ${left.length ? left.length + (left.length > 1 ? " músicas não subiram" : " música não subiu") : ""}${left.length && lf.length ? " e " : ""}${lf.length ? lf.length + (lf.length > 1 ? " vídeos ficaram de fora" : " vídeo ficou de fora") : ""}</b>
        ${left.map(g => `<div class="small"><b>${C.esc(g.name)}</b>: ${C.esc(g.why)}</div>`).join("")}
        ${lf.map(f => `<div class="small">${C.esc(f.name)}: ${C.esc(f.file)} (${C.esc(f.why)})</div>`).join("")}
        <p class="small muted" style="margin:0">Essa lista fica guardada no relatório até o próximo envio. Depois de corrigir, escolha a pasta de novo: o que já subiu fica de fora sozinho.</p></div>` : "";
      box.innerHTML = `<h1 class="title">${bad.length || left.length ? "Terminou, mas nem tudo subiu" : "Tudo enviado"}</h1>${leftHtml}
        <p class="small muted" style="margin:0">Toque em Abrir para conferir e corrigir uma música. Ao salvar, você volta para a lista das últimas enviadas (fica guardada no relatório, em "Últimas enviadas", até o próximo envio).</p>
        <div class="list">${S.log.map(l => `<div class="row"><span class="name small">${C.esc(l.name)}  <span class="pill fmt-${l.fmt || "trio"}">${l.fmt === "piano" ? "Piano" : "Trio"}</span>${l.ok ? "" : `<br><span class="small" style="color:var(--bad)">${C.esc(l.err)}</span>`}</span><span class="meta">${l.ok ? `<button class="btn sm primary" data-l="open" data-id="${C.esc(l.id)}">Abrir</button>` : `<span class="pill bad">erro</span>`}</span></div>`).join("")}</div>
        ${bad.length ? `<p class="small muted" style="margin:0">Pode escolher a mesma pasta de novo: o que já foi enviado fica de fora sozinho.</p>` : ""}
        ${S.log.some(l => l.ok) ? `<button class="btn" data-l="recent">Ver as enviadas no relatório (com as pendências)</button>` : ""}
        <button class="btn primary" data-l="close">Voltar ao painel</button><button class="btn" data-l="restart">Enviar outra pasta</button>`;
    }
  }

  function groupCard(g, fmtBtns) {
    const st = status(g); const RANK = { video: 0, letra: 1, sheet: 2, skip: 3 };
    const its = S.items.filter(i => i.gid === g.gid).sort((a, b) => RANK[a.type] - RANK[b.type] || (a.tone || "").localeCompare(b.tone || "") || a.file.name.localeCompare(b.file.name));
    const use = its.filter(i => i.type !== "skip"), nv = use.filter(i => i.type === "video").length, ns = use.filter(i => i.type === "sheet").length, nl = use.some(i => i.type === "letra");
    const resumo = [nv ? nv + (nv > 1 ? " vídeos" : " vídeo") : "", nl ? "letra" : "", ns ? ns + (ns > 1 ? " partituras" : " partitura") : ""].filter(Boolean).join(", ") || "nada novo";
    const open = g.open ?? !st.ok;
    const opts = (cur) => [["video", "Vídeo"], ["sheet", "Partitura"], ["letra", "Letra"], ["skip", "Ignorar"]].map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
    const gopts = cur => S.groups.map(x => `<option value="${x.gid}" ${x.gid === cur ? "selected" : ""}>${C.esc(x.name)}</option>`).join("") + `<option value="__new">Outra música (nova)...</option>`;
    return `<div class="card" style="${st.ok ? "" : st.idle ? "opacity:.7" : "border-color:var(--warn)"}">
      <div class="hrow spread"><span class="pill ${st.ok ? "ok" : st.idle ? "" : "warn"}">${C.esc(st.text)}</span>${g.exists ? `<span class="pill brass">já no catálogo</span>` : ""}</div>
      <label>Nome da música</label><input class="field" data-gname="${g.gid}" value="${C.esc(g.name)}">
      <div class="hrow" style="gap:10px;flex-wrap:wrap"><div class="tabs" role="radiogroup" style="flex:1;min-width:180px">${fmtBtns(g.fmt, `data-g="${g.gid}" data-gfmt`)}</div>
        <input class="field" style="width:110px" data-gbpm="${g.gid}" inputmode="numeric" placeholder="BPM" value="${C.esc(g.bpm || "")}" aria-label="BPM"></div>
      ${g.order.length > 1 ? `<div class="hrow small muted" style="flex-wrap:wrap;gap:6px">Ordem dos tons: ${g.order.map((t, i) => `<button class="btn sm ${i === 0 ? "primary" : ""}" data-l="first" data-g="${g.gid}" data-t="${C.esc(t)}" title="Passar para o começo">${C.esc(t)}</button>`).join("")}<span>(toque para passar para o começo)</span></div>` : ""}
      <details data-gopen="${g.gid}" ${open ? "open" : ""}><summary class="small muted" style="cursor:pointer">${C.esc(resumo)}${its.length > use.length ? "  ·  " + (its.length - use.length) + " de fora" : ""}  (ver arquivos)</summary>
      <div class="list" style="margin-top:8px">${its.map(i => `<div class="row" style="flex-wrap:wrap;row-gap:8px;${i.type === "skip" ? "opacity:.6" : ""}">
        <span class="name small" style="flex:1 1 100%;word-break:break-word">${C.esc(i.file.name)}  <span class="muted">${C.mb(i.file.size)}${i.h ? "  ·  " + i.h + "p" : ""}</span>${i.note ? `<br><span class="small" style="color:var(--warn)">${C.esc(i.note)}</span>` : ""}</span>
        <select class="field" style="width:auto;padding:6px 8px" data-ity="${i.id}" aria-label="Tipo">${opts(i.type)}</select>
        ${i.type === "video" || i.type === "sheet" ? `<input class="field" style="width:76px;padding:6px 8px" data-ito="${i.id}" value="${C.esc(i.tone)}" placeholder="Tom" aria-label="Tom">` : ""}
        ${i.type === "sheet" ? `<input class="field" style="flex:1;min-width:120px;padding:6px 8px" data-ila="${i.id}" value="${C.esc(i.label)}" aria-label="Nome do botão da partitura">` : ""}
        ${`<select class="field" style="width:auto;max-width:180px;padding:6px 8px" data-igr="${i.id}" aria-label="Música">${gopts(i.gid)}</select>`}
      </div>`).join("")}</div></details></div>`;
  }

  async function send() {
    const ready = S.groups.filter(g => status(g).ok);
    S.left = S.groups.filter(g => !status(g).ok && !status(g).idle).map(g => ({ name: g.name, why: status(g).text, files: S.items.filter(i => i.gid === g.gid).map(i => i.file.name + (i.type === "skip" ? " (de fora: " + (i.note || "ignorado") + ")" : "")) }));
    // vídeos de fora em músicas que subiram (ex.: 1080p, outro vídeo do mesmo tom)
    S.leftFiles = S.items.filter(i => i.type === "skip" && VIDEO_EXT.includes(extOf(i.file.name)) && ready.some(g => g.gid === i.gid)).map(i => ({ name: S.groups.find(g => g.gid === i.gid).name, file: i.file.name, why: i.note || "ignorado" }));
    const work = ready.map(g => ({ g, its: S.items.filter(i => i.gid === g.gid && i.type !== "skip") }));
    const total = work.reduce((a, w) => a + w.its.reduce((b, i) => b + i.file.size, 0), 0) || 1; let done = 0;
    S.busy = true; S.step = "sending"; S.log = []; S.progress = 0; render();
    let wake = null; try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch (e) {}
    for (const { g, its } of work) {
      const ex = findSong(g.name, g.fmt);
      const id = ex ? ex.id : C.slug(g.name) + (g.fmt === "piano" ? "-piano" : "");
      const keys = ex ? JSON.parse(JSON.stringify(ex.keys || [])) : [];
      keys.forEach(k => { k.sheets = C.sheetsOf(k); delete k.sheet; });
      let letra = ex ? ex.letra || null : null;
      const keyFor = t => { let k = keys.find(x => keyEq(x.key, t)); if (!k) { k = { key: t, video: null, sheets: [] }; keys.push(k); } return k; };
      try {
        for (const it of its) {
          S.now = g.name + ": enviando " + it.file.name; const p = box.querySelector("#lnow"); if (p) p.textContent = S.now;
          const ks = C.slug(it.tone) || "tom";
          const ext = extOf(it.file.name) || "pdf";
          const path = it.type === "video" ? `songs/${id}/${ks}-video.mp4`
            : it.type === "letra" ? `songs/${id}/letra.${ext}`
            : `songs/${id}/${ks}-partitura-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${ext}`;
          await C.upload(path, it.file, f => { S.progress = (done + f * it.file.size) / total; const b = box.querySelector(".bar i"); if (b) b.style.width = (S.progress * 100).toFixed(1) + "%"; });
          done += it.file.size;
          if (it.type === "video") keyFor(it.tone).video = path;
          else if (it.type === "letra") letra = path;
          else { const k = keyFor(it.tone); k.sheets = k.sheets.filter(s => C.norm(s.label) !== C.norm(it.label)); k.sheets.push({ label: it.label || "Partitura", path }); }
        }
        // ordem dos tons escolhida na conferência
        keys.sort((a, b) => { const ia = g.order.findIndex(t => keyEq(t, a.key)), ib = g.order.findIndex(t => keyEq(t, b.key)); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
        await C.saveSong(id, {
          name: ex ? ex.name : g.name, formacao: g.fmt, bpm: g.bpm || (ex && ex.bpm) || null, letra,
          keys: keys.filter(k => k.video).map(k => ({ key: k.key, video: k.video, sheets: k.sheets || [] }))
        });
        S.log.push({ name: g.name, ok: true, id, fmt: g.fmt });
      } catch (e) { console.warn(e); S.log.push({ name: g.name, ok: false, err: "Erro ao enviar: " + (e.code || e.message) }); }
      render();
    }
    try { if (wake) wake.release(); } catch (e) {}
    S.busy = false; S.step = "done";
    try {
      localStorage.setItem("cp-last-sent", JSON.stringify(S.log.filter(l => l.ok).map(l => ({ id: l.id, name: l.name, fmt: l.fmt, at: Date.now() }))));
      localStorage.setItem("cp-last-left", JSON.stringify({ at: Date.now(), songs: (S.left || []).concat(S.log.filter(l => !l.ok).map(l => ({ name: l.name, why: l.err }))), files: S.leftFiles || [] }));
    } catch (e) {}
    render();
  }

  // eventos
  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.l === "close") close();
    else if (b.dataset.l === "restart") { S.step = "pick"; S.items = []; S.groups = []; render(); }
    else if (b.dataset.l === "send") send();
    else if (b.dataset.l === "allfmt") { S.fmt = b.dataset.v; S.groups.forEach(g => { g.fmt = b.dataset.v; }); applyExisting(); render(); }
    else if (b.dataset.l === "open") { close(); C.openSong && C.openSong(b.dataset.id); }
    else if (b.dataset.l === "recent") { close(); C.openRecent && C.openRecent(); }
    else if (b.dataset.l === "first") { const g = group(b.dataset.g); g.order = [b.dataset.t, ...g.order.filter(t => t !== b.dataset.t)]; render(); }
    else if (b.dataset.fmt) { S.fmt = b.dataset.fmt; render(); }
    else if (b.dataset.gfmt) { const g = group(b.dataset.g); if (g) { g.fmt = b.dataset.gfmt; applyExisting(); render(); } }
  });
  root.addEventListener("change", e => {
    const t = e.target, d = t.dataset;
    if (t.id === "ldir" || t.id === "lfiles") { load([...t.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name }))); return; }
    const it = id => S.items.find(i => i.id === id);
    if (d.gname) { const g = group(d.gname); g.name = t.value.trim() || g.name; const ex = findSong(g.name, g.fmt); if (ex && ex.bpm && !g.bpm) g.bpm = ex.bpm; applyExisting(); }
    else if (d.gbpm) group(d.gbpm).bpm = t.value.trim();
    else if (d.ity) { const i = it(d.ity); i.type = t.value; delete i.auto; i.note = ""; if (i.type === "sheet" && !i.label) i.label = sheetLabel(i.file.name, group(i.gid).name); applyExisting(); }
    else if (d.ito) { const i = it(d.ito); i.tone = fixTone(t.value.trim()).replace(/^([fim])\s*-\s*/i, (_, g) => g.toUpperCase() + "-"); if (i.note === "escolha o tom") i.note = ""; applyExisting(); }
    else if (d.ila) { it(d.ila).label = t.value.trim(); applyExisting(); }
    else if (d.igr) {
      const i = it(d.igr);
      if (t.value === "__new") { const n = prompt("Nome da música:"); if (!n) return render(); const g = { gid: "g" + Date.now(), name: n.trim(), fmt: group(i.gid).fmt, bpm: "", order: [] }; S.groups.push(g); i.gid = g.gid; }
      else i.gid = t.value;
      applyExisting();
    } else return;
    render();
  });
  root.addEventListener("toggle", e => { const d = e.target.dataset && e.target.dataset.gopen; if (d) { const g = group(d); if (g) g.open = e.target.open; } }, true);
  // arrastar a pasta (computador)
  root.addEventListener("dragover", e => { if (S.step === "pick") { e.preventDefault(); const z = box.querySelector("#ldrop"); if (z) z.style.borderColor = "var(--bronze)"; } });
  root.addEventListener("dragleave", () => { const z = box.querySelector("#ldrop"); if (z) z.style.borderColor = ""; });
  root.addEventListener("drop", async e => { if (S.step !== "pick") return; if (!S.fmt) { e.preventDefault(); return C.toast("Escolha primeiro: Trio, Piano ou Misturadas."); } e.preventDefault(); load(await filesFromDrop(e.dataTransfer)); });

  render();
}

// usado nos testes
export const _test = { acervoPrefix, bpmIn, stripBpm, toneIn, songFromFile, sheetLabel, cleanSong, properName, setCtx: c => { C = c; } };
