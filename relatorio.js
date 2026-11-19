// Relatório do acervo: compara a lista completa (acervo.js) com o que já está no app
// e mostra o que falta em cada música (vídeo de algum tom, letra, partitura, BPM).
// Baixa tudo como planilha (CSV, abre no Excel e no Google Planilhas).
import { ACERVO_PIANO, ACERVO_TRIO } from "./acervo.js";

let C = null;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const TONE = /([A-G])(#|b|♯|♭)?(m)?(?![a-z])/;
const toneKey = s => { const m = String(s || "").match(TONE); return m ? (m[1] + (m[2] || "").replace("♯", "#").replace("♭", "b") + (m[3] || "")) : C.norm(s); };
const matchKey = s => C.slug(s).replace(/(^|-)ii($|-)/g, "$12$2").replace(/(^|-)(o|a|os|as)(-|$)/g, "$1$3").replace(/-+/g, "-").replace(/^-|-$/g, "");

function build() {
  const songs = C.getSongs(); const used = new Set(); const rows = [];
  for (const [fmt, list] of [["trio", ACERVO_TRIO], ["piano", ACERVO_PIANO]]) {
    for (const [name, tons, bpm] of list) {
      const s = songs.find(x => !used.has(x.id) && (x.formacao === "piano" ? "piano" : "trio") === fmt && matchKey(x.name) === matchKey(name));
      if (s) used.add(s.id);
      rows.push(row(fmt, name, tons.split("/").map(t => t.trim()).filter(t => t && t !== "—"), bpm, s));
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
  const has = new Set(keys.filter(k => k.video).map(k => toneKey(k.key)));
  r.foraTons = tons.filter(t => !has.has(toneKey(t)));
  r.letra = !!s.letra;
  r.semPart = fmt === "trio" ? keys.filter(k => !C.sheetsOf(k).length).map(k => k.key) : [];
  if (r.foraTons.length) r.falta.push("falta o tom " + r.foraTons.join(", "));
  if (!r.letra) r.falta.push("falta a letra");
  if (r.semPart.length) r.falta.push("falta partitura (" + r.semPart.join(", ") + ")");
  if (!r.bpm) r.falta.push("falta o BPM");
  if (soApp) r.falta.push("não achei na lista do acervo (confira o nome)");
  return r;
}

export function openRelatorio(ctx) {
  C = ctx;
  const S = Object.assign({ fmt: "all", sit: "pend", q: "", y: 0 }, ctx.state || {});
  const root = el("div", "lote"); root.style.cssText = "position:fixed;inset:0;z-index:30;background:var(--ink);overflow:auto";
  const box = el("div", "stack"); box.style.cssText = "max-width:760px;margin:0 auto;padding:calc(18px + env(safe-area-inset-top)) 18px calc(60px + env(safe-area-inset-bottom))";
  root.appendChild(box); document.body.appendChild(root); document.body.style.overflow = "hidden";
  const close = () => { root.remove(); document.body.style.overflow = ""; };

  function render() {
    const rows = build();
    const sum = f => { const all = rows.filter(r => r.fmt === f && !r.soApp), on = all.filter(r => r.inApp), ok = on.filter(r => !r.falta.length); return { all: all.length, on: on.length, ok: ok.length }; };
    const t = sum("trio"), p = sum("piano");
    const cnt = (f, test) => rows.filter(r => (f === "all" || r.fmt === f) && test(r)).length;
    const vis = rows.filter(r => (S.fmt === "all" || r.fmt === S.fmt)
      && (S.sit === "all" || (S.sit === "pend" && r.inApp && r.falta.length) || (S.sit === "fora" && !r.inApp) || (S.sit === "ok" && r.inApp && !r.falta.length)
        || (S.sit === "bpm" && r.inApp && !r.bpm) || (S.sit === "letra" && r.inApp && !r.letra) || (S.sit === "part" && r.semPart && r.semPart.length))
      && (!S.q || C.norm(r.name).includes(C.norm(S.q))))
      .sort((a, b) => C.norm(a.name).localeCompare(C.norm(b.name)));
    const tab = (k, v, l) => `<button type="button" role="radio" aria-selected="${S[k] === v}" data-rk="${k}" data-rv="${v}">${l}</button>`;
    const sit = [["pend", "Com pendência", cnt(S.fmt, r => r.inApp && r.falta.length)], ["fora", "Fora do app", cnt(S.fmt, r => !r.inApp)], ["ok", "Completas", cnt(S.fmt, r => r.inApp && !r.falta.length)],
      ["bpm", "Sem BPM", cnt(S.fmt, r => r.inApp && !r.bpm)], ["letra", "Sem letra", cnt(S.fmt, r => r.inApp && !r.letra)], ["part", "Sem partitura", cnt(S.fmt, r => r.semPart && r.semPart.length)], ["all", "Todas", cnt(S.fmt, () => true)]];
    box.innerHTML = `<div class="hrow spread"><h1 class="title">Relatório do acervo</h1><button class="btn sm" data-r="close">Fechar</button></div>
      <div class="card"><div class="hrow" style="gap:18px;flex-wrap:wrap">
        <div><b>Trio</b><div class="small muted">${t.on} de ${t.all} no app  ·  ${t.ok} completas</div></div>
        <div><b>Piano</b><div class="small muted">${p.on} de ${p.all} no app  ·  ${p.ok} completas</div></div></div>
        <p class="small muted" style="margin:0">Completa = todos os tons com vídeo, letra, BPM e, no Trio, partitura em cada tom. No Piano a partitura não é cobrada.</p>
        <button class="btn primary" data-r="csv">Baixar planilha</button></div>
      <div class="tabs" role="radiogroup">${tab("fmt", "all", "Todas")}${tab("fmt", "trio", "Trio")}${tab("fmt", "piano", "Piano")}</div>
      <div class="hrow" style="flex-wrap:wrap;gap:6px">${sit.map(([v, l, n]) => `<button class="btn sm ${S.sit === v ? "primary" : "ghost"}" data-rk="sit" data-rv="${v}">${l} (${n})</button>`).join("")}</div>
      <input class="field" id="rq" placeholder="Procurar música" value="${C.esc(S.q)}">
      <div class="list">${vis.map(r => `<div class="row" style="flex-wrap:wrap;row-gap:6px">
        <span class="name" style="flex:1 1 100%">${C.esc(r.name)}  <span class="pill fmt-${r.fmt}">${r.fmt === "trio" ? "Trio" : "Piano"}</span>${r.inApp ? "" : `  <span class="pill">fora do app</span>`}
          <br><span class="small muted" style="font-weight:500">Tons: ${(r.tons.length ? r.tons : r.appKeys).map(x => C.esc(x) + (r.foraTons.includes(x) ? " (falta)" : "")).join(" / ") || "não informados"}${r.inApp ? `  ·  Letra: ${r.letra ? "tem" : "falta"}${r.fmt === "trio" ? `  ·  Partitura: ${r.semPart.length ? "falta em " + r.semPart.map(C.esc).join(", ") : "tem"}` : ""}` : ""}</span>
          ${r.falta.length && r.inApp ? `<br><span class="small" style="color:var(--warn)">${C.esc(r.falta.join("; "))}</span>` : ""}</span>
        ${r.inApp ? `<button class="btn sm primary" data-r="open" data-id="${r.id}">Abrir</button>` : `<button class="btn sm" data-r="new" data-n="${C.esc(r.name)}" data-f="${r.fmt}" data-t="${C.esc(r.tons.join("/"))}" data-b="${C.esc(r.bpmSug)}">Cadastrar</button>`}
        ${r.inApp ? `<label class="small muted" style="display:flex;align-items:center;gap:6px">BPM <input class="field" style="width:80px;padding:6px 8px" inputmode="numeric" data-bpm="${r.id}" value="${C.esc(r.bpm)}" placeholder="${C.esc(r.bpmSug)}"></label>${!r.bpm && r.bpmSug ? `<button class="btn sm ghost" data-r="usebpm" data-id="${r.id}" data-v="${C.esc(r.bpmSug)}">Usar ${C.esc(r.bpmSug)}</button>` : ""}` : ""}
      </div>`).join("") || `<p class="muted">Nenhuma música aqui.</p>`}</div>`;
  }

  function csv() {
    const rows = build().sort((a, b) => a.fmt.localeCompare(b.fmt) * -1 || C.norm(a.name).localeCompare(C.norm(b.name)));
    const head = ["Música", "Formação", "No app", "Tons do acervo", "Tons no app", "Tons faltando", "Letra", "Partitura faltando (Trio)", "BPM", "Pendências"];
    const q = v => { v = String(v ?? ""); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head, ...rows.map(r => [r.name, r.fmt === "trio" ? "Trio" : "Piano", r.inApp ? "sim" : "não", r.tons.join(" / "), r.appKeys.join(" / "), r.foraTons.join(" / "),
      r.inApp ? (r.letra ? "tem" : "falta") : "", r.fmt === "trio" && r.inApp ? r.semPart.join(" / ") : "", r.bpm || (r.bpmSug ? r.bpmSug + " (do acervo)" : ""), r.inApp && !r.falta.length ? "completa" : r.falta.join("; ")])];
    const blob = new Blob(["﻿" + lines.map(l => l.map(q).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "acervo-clube-playback-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function saveBpm(id, v) {
    try { await C.saveBpm(id, v || null); const s = C.getSongs().find(x => x.id === id); if (s) s.bpm = v || null; C.toast(v ? "BPM salvo." : "BPM apagado."); render(); }
    catch (e) { console.warn(e); C.toast("Não consegui salvar o BPM."); }
  }

  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.r === "close") close();
    else if (b.dataset.r === "csv") csv();
    else if (b.dataset.r === "open") { const st = { fmt: S.fmt, sit: S.sit, q: S.q, y: root.scrollTop }; close(); C.openSong(b.dataset.id, st); }
    else if (b.dataset.r === "new") { const st = { fmt: S.fmt, sit: S.sit, q: S.q, y: root.scrollTop }; close(); C.newSong(b.dataset.n, b.dataset.f, b.dataset.t ? b.dataset.t.split("/") : [], b.dataset.b, st); }
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
  if (S.y) requestAnimationFrame(() => { root.scrollTop = S.y; });
}
