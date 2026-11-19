// Relatório do acervo: compara a lista completa (acervo.js) com o que já está no app
// e mostra o que falta em cada música (vídeo de algum tom, letra, partitura, BPM).
// Baixa tudo como planilha (CSV, abre no Excel e no Google Planilhas).
import { ACERVO_PIANO, ACERVO_TRIO } from "./acervo.js";
// músicas novas incluídas pelo próprio relatório ficam em config/acervo (campo extra) no Firestore
let EXTRA = [];
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let COUNT_LETRA = lsGet("cp-rel-letra") === "1"; // padrão: letra fora das pendências
const lastSent = () => { try { return JSON.parse(lsGet("cp-last-sent") || "[]"); } catch (e) { return []; } };
const listTrio = () => ACERVO_TRIO.concat(EXTRA.filter(e => e.fmt === "trio").map(e => [e.name, e.tons || "", e.bpm || ""]));
const listPiano = () => ACERVO_PIANO.concat(EXTRA.filter(e => e.fmt === "piano").map(e => [e.name, e.tons || "", e.bpm || ""]));

let C = null;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const TONE = /([A-G])(#|b|♯|♭)?(m)?(?![a-z])/;
const toneKey = s => { s = String(s || "").replace(/^\s*[FIM]\s*-\s*/, ""); const m = String(s || "").match(TONE); return m ? (m[1] + (m[2] || "").replace("♯", "#").replace("♭", "b") + (m[3] || "")) : C.norm(s); };
const matchKey = s => C.slug(s).replace(/(^|-)ii($|-)/g, "$12$2").replace(/(^|-)(o|a|os|as)(-|$)/g, "$1$3").replace(/-+/g, "-").replace(/^-|-$/g, "");

// ---------- correção de músicas que entraram com o nome errado ----------
const GW = { f: "F", fem: "F", feminina: "F", feminino: "F", i: "I", inter: "I", intermediaria: "I", intermediario: "I", m: "M", masc: "M", masculina: "M", masculino: "M" };
const GRANK = { F: 0, I: 1, M: 2 };
// "Acaso FEM PP" -> { base: "Acaso", g: "F", fmt: "piano" }; "Acaso F" -> { base: "Acaso", g: "F" }
const BPM_RE = /(?:^|[\s_|\-(\[])(?:(\d{2,3})\s*bpm|bpm\s*[:=]?\s*(\d{2,3}))(?=$|[\s_|\-)\].])/i;
function parseWrong(name) {
  const bm = String(name || "").match(BPM_RE); const bpm = bm ? (bm[1] || bm[2]) : "";
  name = String(name || "").replace(new RegExp(BPM_RE.source, "gi"), " ").replace(/\s*\|\s*/g, " ");
  let toks = String(name || "").split(/[\s_\-]+/).filter(Boolean), g = "", fmt = "";
  toks = toks.filter((t, i) => {
    const n = C.norm(t);
    if (n === "pp") { fmt = "piano"; return false; }
    if (n === "tp") { fmt = "trio"; return false; }
    if (GW[n] && (n.length > 1 || i === toks.length - 1 || i >= toks.length - 3)) { g = GW[n]; return false; }
    if (/^(720p\d*|1080p|fast|hd|playback|video|karaoke)$/.test(n)) return false;
    return true;
  });
  return { base: toks.join(" ").trim(), g, fmt, bpm };
}
const acervoAll = () => [...listTrio().map(a => ({ name: a[0], fmt: "trio" })), ...listPiano().map(a => ({ name: a[0], fmt: "piano" }))];
const sameKey = (a, b) => { const x = /^([FIM])-(.+)$/.exec(a) || [0, "", a], y = /^([FIM])-(.+)$/.exec(b) || [0, "", b]; return x[2].toLowerCase() === y[2].toLowerCase() && (!x[1] || !y[1] || x[1] === y[1]); };
// sugestão automática: qual música do acervo é esta
function suggest(s) {
  const p = parseWrong(s.name); const fmt = p.fmt || (s.formacao === "piano" ? "piano" : "trio");
  const same = acervoAll().find(a => a.fmt === fmt && matchKey(a.name) === matchKey(p.base));
  if (same) return { name: same.name, fmt: same.fmt, g: p.g };
  // mesma música só na outra formação: pode ser a versão Trio/Piano ainda não listada
  const other = acervoAll().find(a => a.fmt !== fmt && matchKey(a.name) === matchKey(p.base));
  return other ? { name: other.name, fmt: other.fmt, g: p.g, cross: true, own: fmt } : null;
}

let LOCAL = {};
function build() {
  const songs = C.getSongs().filter(x => LOCAL[x.id] !== null).map(x => LOCAL[x.id] || x).concat(Object.values(LOCAL).filter(x => x && !C.getSongs().some(y => y.id === x.id))); const used = new Set(); const rows = [];
  for (const [fmt, list] of [["trio", listTrio()], ["piano", listPiano()]]) {
    for (const [name, tons, bpm] of list) {
      const s = songs.find(x => !used.has(x.id) && (x.formacao === "piano" ? "piano" : "trio") === fmt && matchKey(x.name) === matchKey(name));
      if (s) used.add(s.id);
      rows.push(row(fmt, name, tons.split("/").map((t, i) => (t = t.trim()) && t !== "—" ? (fmt === "piano" ? "FIM"[i] + "-" + t : t) : "").filter(Boolean), bpm, s));
    }
  }
  for (const s of songs) if (!used.has(s.id)) rows.push(row(s.formacao === "piano" ? "piano" : "trio", s.name, [], "", s, true));
  return rows;
}
function row(fmt, name, tons, bpmAcervo, s, soApp) {
  const r = { fmt, name: s ? s.name : name, id: s ? s.id : null, inApp: !!s, soApp: !!soApp, tons, bpm: s && s.bpm ? String(s.bpm) : "", bpmSug: bpmAcervo || "", falta: [] };
  if (!s) { r.falta.push("não está no app"); r.appKeys = []; r.letra = false; r.semPart = []; r.foraTons = tons; return r; }
  const keys = s.keys || [];
  r.appKeys = keys.map(k => k.key);
  const vk = keys.filter(k => k.video).map(k => k.key);
  r.foraTons = tons.filter(t => !vk.some(k => sameKey(k, t)));
  r.letra = !!s.letra;
  // Trio: cada tom precisa de 2 partituras: a da melodia (nome com "melodia") e a sheet music (as outras)
  const isMel = sh => /melod/i.test(C.norm(sh.label || ""));
  r.semPart = [];
  if (fmt === "trio") for (const k of keys) {
    const sh = C.sheetsOf(k); const miss = [];
    if (!sh.some(x => !isMel(x))) miss.push("sheet music");
    if (!sh.some(isMel)) miss.push("melodia");
    if (miss.length) r.semPart.push(k.key + ": " + miss.join(" e "));
  }
  if (r.foraTons.length) r.falta.push("falta o tom " + r.foraTons.join(", "));
  if (!r.letra && COUNT_LETRA) r.falta.push("falta a letra");
  if (r.semPart.length) r.falta.push("falta partitura (" + r.semPart.join("; ") + ")");
  if (!r.bpm) r.falta.push("falta o BPM");
  if (soApp) r.falta.push("não está na lista do acervo");
  return r;
}

export function openRelatorio(ctx) {
  C = ctx;
  const S = Object.assign({ fmt: "all", sit: "pend", q: "", y: 0 }, ctx.state || {});
  const root = el("div", "lote"); root.style.cssText = "position:fixed;inset:0;z-index:30;background:var(--ink);overflow:auto";
  const box = el("div", "stack"); box.style.cssText = "max-width:760px;margin:0 auto;padding:calc(18px + env(safe-area-inset-top)) 18px calc(60px + env(safe-area-inset-bottom))";
  root.appendChild(box); document.body.appendChild(root); document.body.style.overflow = "hidden";
  const close = () => { root.remove(); document.body.style.overflow = ""; };
  const local = LOCAL = {}; // músicas já salvas nesta sessão (antes de o app receber a atualização)
  const songNow = id => local[id] || C.getSongs().find(x => x.id === id);

  // junta a música errada (src) na música certa do acervo (nome + formação) e apaga a errada
  async function merge(srcId, name, fmt) {
    const src = songNow(srcId); if (!src) return;
    const g = parseWrong(src.name).g;
    const ex = Object.values(local).filter(Boolean).concat(C.getSongs()).find(x => x && local[x.id] !== null && x.id !== srcId && (x.formacao === "piano" ? "piano" : "trio") === fmt && matchKey(x.name) === matchKey(name));
    const id = ex ? ex.id : C.slug(name) + (fmt === "piano" ? "-piano" : "");
    const keys = JSON.parse(JSON.stringify((ex && ex.keys) || [])); keys.forEach(k => { k.sheets = C.sheetsOf(k); delete k.sheet; });
    for (const k0 of src.keys || []) {
      const key = fmt === "piano" && g && !/^[FIM]-/.test(k0.key) ? g + "-" + k0.key : k0.key;
      let k = keys.find(x => sameKey(x.key, key));
      if (!k) { k = { key, video: null, sheets: [] }; keys.push(k); }
      if (!k.video && k0.video) k.video = k0.video;
      for (const sh of C.sheetsOf(k0)) if (!k.sheets.some(x => C.norm(x.label) === C.norm(sh.label))) k.sheets.push(sh);
    }
    if (fmt === "piano") keys.sort((a, b) => (GRANK[(a.key.match(/^([FIM])-/) || [])[1]] ?? 9) - (GRANK[(b.key.match(/^([FIM])-/) || [])[1]] ?? 9));
    const data = { name: ex ? ex.name : name, formacao: fmt, bpm: (ex && ex.bpm) || src.bpm || parseWrong(src.name).bpm || null, letra: (ex && ex.letra) || src.letra || null,
      keys: keys.filter(k => k.video).map(k => ({ key: k.key, video: k.video, sheets: k.sheets || [] })) };
    await C.saveSong(id, data); local[id] = { id, ...data };
    if (srcId !== id) { await C.deleteSong(srcId); local[srcId] = null; }
  }
  const wrongs = () => C.getSongs().filter(x => local[x.id] !== null && build().some(r => r.soApp && r.id === x.id));
  // tons do Piano sem F-/I-/M- no app: completa pela ordem do acervo (Feminina/Intermediária/Masculina)
  function genPlan() {
    const out = [];
    for (const x of C.getSongs()) {
      if (local[x.id] === null || x.formacao !== "piano") continue;
      const cur = local[x.id] || x; const a = listPiano().find(l => matchKey(l[0]) === matchKey(cur.name)); if (!a) continue;
      const tons = a[1].split("/").map(t => t.trim());
      let changed = false;
      const keys = (cur.keys || []).map(k => {
        if (/^[FIM]-/.test(k.key)) return k;
        const hits = tons.map((t, i) => t.toLowerCase() === String(k.key).trim().toLowerCase() ? i : -1).filter(i => i >= 0);
        if (hits.length !== 1) return k;
        changed = true; return { ...k, key: "FIM"[hits[0]] + "-" + String(k.key).trim() };
      });
      if (changed) out.push({ x: cur, keys: keys.sort((p, q) => (GRANK[(p.key.match(/^([FIM])-/) || [])[1]] ?? 9) - (GRANK[(q.key.match(/^([FIM])-/) || [])[1]] ?? 9)) });
    }
    return out;
  }
  async function genFix() {
    const plan = genPlan(); if (!plan.length) return;
    if (!confirm("Colocar F-, I- ou M- nos tons destas músicas do Piano?\n\n" + plan.map(o => o.x.name + ": " + o.keys.map(k => k.key).join(", ")).join("\n"))) return;
    S.busy = "Arrumando os tons..."; render();
    try { for (const o of plan) { const d = { name: o.x.name, formacao: "piano", bpm: o.x.bpm || null, letra: o.x.letra || null, keys: o.keys.map(k => ({ key: k.key, video: k.video, sheets: C.sheetsOf(k) })) }; await C.saveSong(o.x.id, d); local[o.x.id] = { id: o.x.id, ...d }; } C.toast("Pronto: " + plan.length + (plan.length > 1 ? " músicas arrumadas." : " música arrumada.")); }
    catch (e) { console.warn(e); C.toast("Parou com erro: " + (e.code || e.message)); }
    S.busy = ""; render();
  }
  // nomes fora do padrão (maiúsculas/acentos): usa a grafia do acervo ou só a primeira letra maiúscula
  const PROPER = ["Deus", "Maria", "João", "José", "Jesus", "Rio", "Ipanema", "Brasil", "Natal", "América", "Bahia", "Minas", "Itapuã", "Santo", "Amaro", "Odeon", "Saigon", "Luiza", "Madalena", "Beatriz", "Sampa", "Copacabana", "Senhora", "Nossa", "Índio", "Branca", "Gita", "Asa", "I", "II", "Love", "You"];
  function properName(name, fmt) {
    const hit = (fmt === "piano" ? listPiano() : listTrio()).find(a => matchKey(a[0]) === matchKey(name) && C.slug(a[0]).replace(/^(o|a|os|as)-/, "") === C.slug(name).replace(/^(o|a|os|as)-/, ""));
    if (hit) return hit[0];
    return String(name || "").trim().replace(/\s+/g, " ").split(" ").map((w, i) => {
      const p = PROPER.find(x => C.norm(x) === C.norm(w)); if (p && i > 0) return p;
      const lw = w.toLocaleLowerCase("pt-BR"); return i === 0 ? lw.charAt(0).toLocaleUpperCase("pt-BR") + lw.slice(1) : lw;
    }).join(" ");
  }
  const namePlan = () => C.getSongs().filter(x => local[x.id] !== null).map(x => local[x.id] || x)
    .map(x => ({ x, n: properName(x.name, x.formacao === "piano" ? "piano" : "trio") })).filter(o => o.n && o.n !== o.x.name && !parseWrong(o.x.name).g && !parseWrong(o.x.name).fmt && !parseWrong(o.x.name).bpm);
  async function nameFix() {
    const plan = namePlan(); if (!plan.length) return;
    if (!confirm("Arrumar o nome destas músicas?\n\n" + plan.map(o => o.x.name + "  →  " + o.n).join("\n"))) return;
    S.busy = "Arrumando os nomes..."; render();
    try { for (const o of plan) { const d = { name: o.n, formacao: o.x.formacao === "piano" ? "piano" : "trio", bpm: o.x.bpm || null, letra: o.x.letra || null, keys: (o.x.keys || []).map(k => ({ key: k.key, video: k.video, sheets: C.sheetsOf(k) })) }; await C.saveSong(o.x.id, d); local[o.x.id] = { id: o.x.id, ...d }; } C.toast("Nomes arrumados: " + plan.length + "."); }
    catch (e) { console.warn(e); C.toast("Parou com erro: " + (e.code || e.message)); }
    S.busy = ""; render();
  }
  // BPM que o acervo já conhece, para as músicas do app que ainda não têm
  const bpmPlan = () => build().filter(r => r.inApp && !r.bpm && r.bpmSug);
  async function bpmFill() {
    const plan = bpmPlan(); if (!plan.length) return;
    if (!confirm("Preencher o BPM destas músicas?\n\n" + plan.map(r => r.name + " (" + (r.fmt === "trio" ? "Trio" : "Piano") + "): " + r.bpmSug).join("\n"))) return;
    S.busy = "Preenchendo os BPMs..."; render();
    try { for (const r of plan) { await C.saveBpm(r.id, r.bpmSug); const x = songNow(r.id); if (x) x.bpm = r.bpmSug; } C.toast("BPM preenchido em " + plan.length + (plan.length > 1 ? " músicas." : " música.")); }
    catch (e) { console.warn(e); C.toast("Parou com erro: " + (e.code || e.message)); }
    S.busy = ""; render();
  }
  async function autoFix() {
    const list = wrongs().map(x => ({ x, sg: suggest(x) })).filter(o => o.sg && !o.sg.cross);
    if (!list.length) return C.toast("Não achei nenhuma para juntar sozinha. Use Juntar em cada uma.");
    if (!confirm("Juntar estas músicas nas certas e apagar as erradas?\n\n" + list.map(o => o.x.name + "  →  " + o.sg.name + " (" + (o.sg.fmt === "trio" ? "Trio" : "Piano") + ")").join("\n"))) return;
    S.busy = "Corrigindo..."; render();
    try { for (const o of list) await merge(o.x.id, o.sg.name, o.sg.fmt); C.toast("Pronto: " + list.length + (list.length > 1 ? " corrigidas." : " corrigida.")); }
    catch (e) { console.warn(e); C.toast("Parou com erro: " + (e.code || e.message)); }
    S.busy = ""; render();
  }

  function render() {
    const rows = build();
    const recent = new Set(lastSent().map(x => x.id));
    const sum = f => { const all = rows.filter(r => r.fmt === f && !r.soApp), on = all.filter(r => r.inApp), ok = on.filter(r => !r.falta.length); return { all: all.length, on: on.length, ok: ok.length }; };
    const t = sum("trio"), p = sum("piano");
    const cnt = (f, test) => rows.filter(r => (f === "all" || r.fmt === f) && test(r)).length;
    const vis = rows.filter(r => (S.fmt === "all" || r.fmt === S.fmt)
      && (S.sit === "all" || (S.sit === "recent" && r.id && recent.has(r.id)) || (S.sit === "wrong" && r.soApp) || (S.sit === "pend" && r.inApp && r.falta.length) || (S.sit === "fora" && !r.inApp) || (S.sit === "ok" && r.inApp && !r.falta.length)
        || (S.sit === "bpm" && r.inApp && !r.bpm) || (S.sit === "letra" && r.inApp && !r.letra) || (S.sit === "part" && r.semPart && r.semPart.length))
      && (!S.q || C.norm(r.name).includes(C.norm(S.q))))
      .sort((a, b) => C.norm(a.name).localeCompare(C.norm(b.name)));
    const tab = (k, v, l) => `<button type="button" role="radio" aria-selected="${S[k] === v}" data-rk="${k}" data-rv="${v}">${l}</button>`;
    const sit = [...(recent.size ? [["recent", "Últimas enviadas", cnt(S.fmt, r => r.id && recent.has(r.id))]] : []), ["pend", "Com pendência", cnt(S.fmt, r => r.inApp && r.falta.length)], ["fora", "Fora do app", cnt(S.fmt, r => !r.inApp)], ["ok", "Completas", cnt(S.fmt, r => r.inApp && !r.falta.length)],
      ["bpm", "Sem BPM", cnt(S.fmt, r => r.inApp && !r.bpm)], ["letra", "Sem letra", cnt(S.fmt, r => r.inApp && !r.letra)], ["part", "Sem partitura", cnt(S.fmt, r => r.semPart && r.semPart.length)], ["all", "Todas", cnt(S.fmt, () => true)]];
    box.innerHTML = `<div class="hrow spread"><h1 class="title">Relatório do acervo</h1><button class="btn sm" data-r="close">Fechar</button></div>
      <div class="card"><div class="hrow" style="gap:18px;flex-wrap:wrap">
        <div><b>Trio</b><div class="small muted">${t.on} de ${t.all} no app  ·  ${t.ok} completas</div></div>
        <div><b>Piano</b><div class="small muted">${p.on} de ${p.all} no app  ·  ${p.ok} completas</div></div></div>
        <p class="small muted" style="margin:0">Completa = todos os tons com vídeo, BPM${COUNT_LETRA ? ", letra" : ""} e, no Trio, duas partituras em cada tom: a sheet music e a da melodia (a da melodia precisa ter "melodia" no nome). No Piano a partitura não é cobrada.</p>
        <button class="btn sm ${COUNT_LETRA ? "primary" : "ghost"}" data-r="letratoggle">${COUNT_LETRA ? "Letra conta como pendência (toque para tirar)" : "Letra não conta como pendência (toque para contar)"}</button>
        <button class="btn primary" data-r="csv">Baixar planilha</button></div>
      ${S.busy ? `<div class="card"><b>${C.esc(S.busy)}</b></div>` : ""}
      ${(() => { const n = namePlan().length; return n ? `<div class="card" style="border-color:var(--warn)"><b>${n} ${n > 1 ? "músicas estão" : "música está"} com o nome fora do padrão (maiúsculas ou acentos)</b>
        <button class="btn primary" data-r="namefix">Arrumar ${n > 1 ? "os nomes" : "o nome"}</button></div>` : ""; })()}
      ${(() => { const n = bpmPlan().length; return n ? `<div class="card" style="border-color:var(--warn)"><b>Já sei o BPM de ${n} ${n > 1 ? "músicas que estão" : "música que está"} sem BPM no app</b>
        <button class="btn primary" data-r="bpmfill">Preencher ${n > 1 ? "os " + n + " BPMs" : "o BPM"}</button></div>` : ""; })()}
      ${(() => { const n = genPlan().length; return n ? `<div class="card" style="border-color:var(--warn)"><b>${n} ${n > 1 ? "músicas do Piano estão" : "música do Piano está"} com tom sem F-, I- ou M-</b>
        <p class="small muted" style="margin:0">Pela lista do acervo eu sei qual tom é o feminino, o intermediário e o masculino. Confere a lista e eu arrumo.</p>
        <button class="btn primary" data-r="genfix">Colocar F-, I- e M- nos tons</button></div>` : ""; })()}
      ${(() => { const w = rows.filter(r => r.soApp); if (!w.length) return ""; const auto = w.filter(r => { const g = suggest(songNow(r.id) || { name: r.name }); return g && !g.cross; }).length;
        return `<div class="card" style="border-color:var(--warn)"><b>${w.length} ${w.length > 1 ? "músicas do app não estão" : "música do app não está"} na lista do acervo</b>
          <p class="small muted" style="margin:0">Em cada uma, me diga: se é música nova, toque em "Sim, é nova" e ela entra na lista. Se entrou com o nome errado, escolha a música certa e toque em Juntar (vídeos, letras e partituras passam para a certa e a errada some). Ou Apagar.</p>
          ${auto ? `<button class="btn primary" data-r="autofix">Corrigir ${auto} automaticamente</button>` : ""}
          <button class="btn sm ghost" data-rk="sit" data-rv="wrong">Ver só essas (${w.length})</button></div>`; })()}
      <datalist id="acv">${acervoAll().map(a => `<option value="${C.esc(a.name)} (${a.fmt === "trio" ? "Trio" : "Piano"})">`).join("")}</datalist>
      <div class="tabs" role="radiogroup">${tab("fmt", "all", "Todas")}${tab("fmt", "trio", "Trio")}${tab("fmt", "piano", "Piano")}</div>
      <div class="hrow" style="flex-wrap:wrap;gap:6px">${sit.map(([v, l, n]) => `<button class="btn sm ${S.sit === v ? "primary" : "ghost"}" data-rk="sit" data-rv="${v}">${l} (${n})</button>`).join("")}</div>
      <input class="field" id="rq" placeholder="Procurar música" value="${C.esc(S.q)}">
      <div class="list">${vis.map(r => `<div class="row" style="flex-wrap:wrap;row-gap:6px">
        <span class="name" style="flex:1 1 100%">${C.esc(r.name)}  <span class="pill fmt-${r.fmt}">${r.fmt === "trio" ? "Trio" : "Piano"}</span>${r.inApp ? "" : `  <span class="pill">fora do app</span>`}
          <br><span class="small muted" style="font-weight:500">Tons: ${(r.tons.length ? r.tons : r.appKeys).map(x => C.esc(x) + (r.foraTons.includes(x) ? " (falta)" : "")).join(" / ") || "não informados"}${r.inApp ? `  ·  Letra: ${r.letra ? "tem" : "falta"}${r.fmt === "trio" ? `  ·  Partituras: ${r.semPart.length ? "falta " + r.semPart.map(C.esc).join("; ") : "sheet music e melodia em todos os tons"}` : ""}` : ""}</span>
          ${r.falta.length && r.inApp ? `<br><span class="small" style="color:var(--warn)">${C.esc(r.falta.join("; "))}</span>` : ""}</span>
        ${r.soApp ? (() => { const sg = suggest(songNow(r.id) || { name: r.name }); return `<div class="stack" style="flex:1 1 100%;gap:8px;padding:10px;border:1px solid var(--warn);border-radius:10px">
          ${sg && sg.cross ? `<b class="small">"${C.esc(sg.name)}" está no acervo do ${sg.fmt === "trio" ? "Trio" : "Piano"}, e aqui ela está como ${sg.own === "trio" ? "Trio" : "Piano"}. É a versão ${sg.own === "trio" ? "Trio" : "Piano"} dessa música?</b>`
            : sg ? `<b class="small">Parece ser "${C.esc(sg.name)}" (${sg.fmt === "trio" ? "Trio" : "Piano"}) com o nome errado. Ou é uma música nova?</b>` : `<b class="small">Essa música não está na minha lista do acervo. É uma música nova?</b>`}
          <div class="hrow" style="flex-wrap:wrap;gap:6px"><button class="btn sm ${sg && !sg.cross ? "" : "primary"}" data-r="addnew" data-id="${r.id}">${sg && sg.cross ? `Sim, é a versão ${sg.own === "trio" ? "Trio" : "Piano"}: incluir no acervo do ${sg.own === "trio" ? "Trio" : "Piano"}` : "Sim, é nova: incluir no acervo"}</button><button class="btn sm danger" data-r="del" data-id="${r.id}">Apagar</button></div>
          <div class="hrow" style="flex-wrap:wrap;gap:6px"><input class="field" style="flex:1;min-width:180px;padding:6px 8px" list="acv" data-fix="${r.id}" placeholder="Não, é esta música do acervo..." value="${sg ? C.esc(sg.name + " (" + (sg.fmt === "trio" ? "Trio" : "Piano") + ")") : ""}"><button class="btn sm ${sg && !sg.cross ? "primary" : ""}" data-r="join" data-id="${r.id}">Juntar</button></div></div>`; })() : ""}
        ${r.inApp ? `<button class="btn sm primary" data-r="open" data-id="${r.id}">Abrir</button>` : `<button class="btn sm" data-r="new" data-n="${C.esc(r.name)}" data-f="${r.fmt}" data-t="${C.esc(r.tons.join("/"))}" data-b="${C.esc(r.bpmSug)}">Cadastrar</button>`}
        ${r.inApp ? `<label class="small muted" style="display:flex;align-items:center;gap:6px">BPM <input class="field" style="width:80px;padding:6px 8px" inputmode="numeric" data-bpm="${r.id}" value="${C.esc(r.bpm)}" placeholder="${C.esc(r.bpmSug)}"></label>${!r.bpm && r.bpmSug ? `<button class="btn sm ghost" data-r="usebpm" data-id="${r.id}" data-v="${C.esc(r.bpmSug)}">Usar ${C.esc(r.bpmSug)}</button>` : ""}` : ""}
      </div>`).join("") || `<p class="muted">Nenhuma música aqui.</p>`}</div>`;
  }

  function csv() {
    const rows = build().sort((a, b) => a.fmt.localeCompare(b.fmt) * -1 || C.norm(a.name).localeCompare(C.norm(b.name)));
    const head = ["Música", "Formação", "No app", "Tons do acervo", "Tons no app", "Tons faltando", "Letra", "Partituras faltando (Trio: sheet music e melodia)", "BPM", "Pendências"];
    const q = v => { v = String(v ?? ""); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head, ...rows.map(r => [r.name, r.fmt === "trio" ? "Trio" : "Piano", r.inApp ? "sim" : "não", r.tons.join(" / "), r.appKeys.join(" / "), r.foraTons.join(" / "),
      r.inApp ? (r.letra ? "tem" : "falta") : "", r.fmt === "trio" && r.inApp ? r.semPart.join("; ") : "", r.bpm || (r.bpmSug ? r.bpmSug + " (do acervo)" : ""), r.inApp && !r.falta.length ? "completa" : r.falta.join("; ")])];
    const blob = new Blob(["﻿" + lines.map(l => l.map(q).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "acervo-clube-playback-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function saveBpm(id, v) {
    try { await C.saveBpm(id, v || null); const s = songNow(id); if (s) s.bpm = v || null; C.toast(v ? "BPM salvo." : "BPM apagado."); render(); }
    catch (e) { console.warn(e); C.toast("Não consegui salvar o BPM."); }
  }

  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.r === "close") close();
    else if (b.dataset.r === "csv") csv();
    else if (b.dataset.r === "open") { const st = { fmt: S.fmt, sit: S.sit, q: S.q, y: root.scrollTop }; close(); C.openSong(b.dataset.id, st); }
    else if (b.dataset.r === "new") { const st = { fmt: S.fmt, sit: S.sit, q: S.q, y: root.scrollTop }; close(); C.newSong(b.dataset.n, b.dataset.f, b.dataset.t ? b.dataset.t.split("/") : [], b.dataset.b, st); }
    else if (b.dataset.r === "autofix") autoFix();
    else if (b.dataset.r === "genfix") genFix();
    else if (b.dataset.r === "bpmfill") bpmFill();
    else if (b.dataset.r === "namefix") nameFix();
    else if (b.dataset.r === "letratoggle") { COUNT_LETRA = !COUNT_LETRA; lsSet("cp-rel-letra", COUNT_LETRA ? "1" : "0"); render(); }
    else if (b.dataset.r === "addnew") {
      const x = songNow(b.dataset.id); if (!x) return;
      const fmt = x.formacao === "piano" ? "piano" : "trio";
      const item = { name: x.name, fmt, tons: (x.keys || []).map(k => String(k.key).replace(/^[FIM]-/, "")).join("/"), bpm: x.bpm || "" };
      (async () => { try { EXTRA = EXTRA.filter(e => !(e.fmt === fmt && matchKey(e.name) === matchKey(x.name))).concat([item]); await C.saveExtras(EXTRA); C.toast("Incluí " + x.name + " no acervo do " + (fmt === "trio" ? "Trio" : "Piano") + "."); } catch (e) { console.warn(e); C.toast("Não consegui incluir: " + (e.code || e.message)); } render(); })();
    }
    else if (b.dataset.r === "join") {
      const v = (box.querySelector(`[data-fix="${b.dataset.id}"]`) || {}).value || ""; const m = v.match(/^(.*?)\s*\((Trio|Piano)\)\s*$/);
      const a = m && acervoAll().find(x => x.name === m[1] && x.fmt === m[2].toLowerCase());
      if (!a) return C.toast("Escolha a música certa na lista.");
      (async () => { S.busy = "Juntando..."; render(); try { await merge(b.dataset.id, a.name, a.fmt); C.toast("Juntei em " + a.name + "."); } catch (e) { console.warn(e); C.toast("Erro: " + (e.code || e.message)); } S.busy = ""; render(); })();
    }
    else if (b.dataset.r === "del") {
      const x = songNow(b.dataset.id); if (!x || !confirm("Apagar \"" + x.name + "\" do app?")) return;
      (async () => { try { await C.deleteSong(x.id); local[x.id] = null; C.toast("Apagada."); } catch (e) { C.toast("Erro: " + (e.code || e.message)); } render(); })();
    }
    else if (b.dataset.r === "usebpm") saveBpm(b.dataset.id, b.dataset.v);
    else if (b.dataset.rk) { S[b.dataset.rk] = b.dataset.rv; render(); }
  });
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.bpm) saveBpm(t.dataset.bpm, t.value.trim().replace(/\D/g, ""));
  });
  root.addEventListener("input", e => {
    if (e.target.id !== "rq") return; S.q = e.target.value; const pos = e.target.selectionStart; render();
    const f = box.querySelector("#rq"); f.focus(); try { f.setSelectionRange(pos, pos); } catch (er) {}
  });
  render();
  (async () => { try { EXTRA = (await C.getExtras()) || []; render(); } catch (e) { console.warn(e); } })();
  if (S.y) requestAnimationFrame(() => { root.scrollTop = S.y; });
}
