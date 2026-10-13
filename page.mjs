// Builds the HTML page (dark, Italian, four views with a bottom tab bar) from the computed data.
// Everything here ends up encrypted by staticrypt, so it can contain grades.
import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('./logo.svg', import.meta.url), 'utf8').replace(/\s*\n\s*/g, '');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(logo);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) =>
  d ? new Date(d).toLocaleDateString('it-CH', { ...opts, timeZone: 'Europe/Zurich' }) : '';
const color = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'none' : v >= 5 ? 'good' : v >= 4 ? 'ok' : 'bad');
const fmtAvg = (v) => (v === null || v === undefined ? '–' : v.toFixed(2));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  materie: '<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"/></svg>',
  verifiche: '<svg viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 2v4M15 2v4"/></svg>',
  voti: '<svg viewBox="0 0 24 24"><path d="M5 5h14M5 12h14M5 19h9"/></svg>',
};

/**
 * @param {object} d
 * @param {Array} d.years       computed per-year data (newest first)
 * @param {Array} d.upcoming    upcoming exams
 * @param {object} d.subjById   subjects by id
 * @param {(g: object) => number} d.weightOf
 */
export function renderPage({ years, upcoming, subjById, weightOf }) {
  const updated = new Date().toLocaleString('it-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const subjName = (id) => subjById[id]?.name ?? 'Altro';

  const badge = (v, big = false) => `<span class="badge ${color(v)}${big ? ' big' : ''}">${fmtAvg(v)}</span>`;
  const chips = (r, semesters) =>
    `<div class="chips">${semesters.map((s) => `<span class="chip"><small>S${esc(s)}</small> <b class="${color(r.bySem[s])}">${fmtAvg(r.bySem[s])}</b></span>`).join('')}${
      r.maturita ? '<span class="chip tag">Maturità</span>' : `<span class="chip"><small>Anno</small> <b class="${color(r.year)}">${fmtAvg(r.year)}</b></span>`
    }</div>`;

  // The average that matters right now: current semester for maturità subjects, whole year otherwise.
  const mainAvg = (r, lastSem) => (r.maturita ? r.bySem[lastSem] : r.year);

  const gradeItem = (g, withSubject = false) => `<li class="grade${g.replaced ? ' replaced' : ''}">
  <span class="gval ${color(Number(g.value))}">${esc(g.value)}</span>
  <span class="gtext"><b>${withSubject ? esc(subjName(g.subject_id)) : esc(g.description || 'Voto')}</b>
  <small>${withSubject && g.description ? esc(g.description) + ' · ' : ''}${esc(fmtDate(g.date))}${weightOf(g) !== 1 ? ` · peso ${esc(weightOf(g))}` : ''}${g.recupero ? ' · <em>recupero</em>' : ''}${g.replaced ? ' · sostituito dal recupero' : ''}</small></span>
</li>`;

  const calculator = (r, y) => {
    const scope = (r.maturita ? r.list.filter((g) => String(g.semester ?? '?') === y.lastSem) : r.list).filter((g) => !g.replaced);
    const sum = scope.reduce((a, g) => a + Number(g.value) * weightOf(g), 0);
    const w = scope.reduce((a, g) => a + weightOf(g), 0);
    return `<div class="calc" data-sum="${sum}" data-w="${w}">
  <div class="calc-title">Quanto serve al prossimo voto?</div>
  <div class="calc-row">
    <label>Media voluta <select class="c-target">${[4, 4.5, 5, 5.5, 6].map((t) => `<option${t === 4 ? ' selected' : ''}>${t.toFixed(1)}</option>`).join('')}</select></label>
    <label>Peso <select class="c-weight">${[0.5, 1, 2, 3].map((t) => `<option${t === 1 ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
  </div>
  <div class="c-out"></div>
  <small class="muted">${r.maturita ? `Calcolato sul semestre ${esc(y.lastSem)}.` : "Calcolato sull'anno intero."}</small>
</div>`;
  };

  const subjectCard = (r, y, nested = false) => `<details class="subject${nested ? ' nested' : ''}">
  <summary><span class="sname">${esc(r.name)}${nested && r.groupWeight !== 1 ? ` <small class="muted">peso ${esc(r.groupWeight)}</small>` : ''}</span>${badge(mainAvg(r, y.lastSem))}</summary>
  ${chips(r, y.semesters)}
  <ul class="grades">${r.list.map((g) => gradeItem(g)).join('')}</ul>
  ${calculator(r, y)}
</details>`;

  const groupCard = (r, y) => `<details class="subject group">
  <summary><span class="sname">${esc(r.name)} <small class="muted">gruppo</small></span>${badge(mainAvg(r, y.lastSem))}</summary>
  ${chips(r, y.semesters)}
  ${r.children.map((c) => subjectCard(c, y, true)).join('')}
</details>`;

  const yearBlock = (y, content) => `<div class="year" data-year="${esc(y.year)}">${content}</div>`;

  // ---------- Home ----------
  const home = years.map((y) => {
    const all = y.rows.flatMap((r) => (r.children ? r.children : [r]));
    const graded = y.rows.filter((r) => r.category !== 'neutra' && mainAvg(r, y.lastSem) !== null);
    const insuff = graded.filter((r) => mainAvg(r, y.lastSem) < 4);
    const best = [...graded].sort((a, b) => mainAvg(b, y.lastSem) - mainAvg(a, y.lastSem))[0];
    const yearGrades = all.flatMap((r) => r.list).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const main = y.overall.bySem[y.lastSem];
    return yearBlock(y, `
<div class="hero">
  <div class="hero-label">Media generale · semestre ${esc(y.lastSem)}</div>
  <div class="hero-value ${color(main)}">${fmtAvg(main)}</div>
  ${chips({ ...y.overall, maturita: false }, y.semesters)}
</div>
<div class="stats">
  <div class="stat"><b>${yearGrades.length}</b><small>voti</small></div>
  <div class="stat"><b class="${insuff.length ? 'bad' : 'good'}">${insuff.length}</b><small>insufficienze</small></div>
  <div class="stat"><b class="${color(best ? mainAvg(best, y.lastSem) : null)}">${best ? fmtAvg(mainAvg(best, y.lastSem)) : '–'}</b><small>${best ? esc(best.name) : 'migliore'}</small></div>
</div>
${insuff.length ? `<div class="card warn"><b>Da recuperare:</b> ${insuff.map((r) => `${esc(r.name)} (${fmtAvg(mainAvg(r, y.lastSem))})`).join(', ')}</div>` : ''}
<h2>Ultimi voti</h2>
${yearGrades.length ? `<ul class="grades card">${yearGrades.slice(0, 5).map((g) => gradeItem(g, true)).join('')}</ul><a class="more" href="#voti">Tutti i voti →</a>` : '<div class="card muted">Ancora nessun voto.</div>'}`);
  }).join('');

  const examItem = (e) => `<li class="exam" data-date="${esc(e.exam_date)}">
  <div class="edate"><b>${esc(fmtDate(e.exam_date, { day: 'numeric' }))}</b><small>${esc(fmtDate(e.exam_date, { weekday: 'short' }))}</small></div>
  <div class="etext"><b>${esc(subjName(e.subject_id))}</b><small>${esc(e.title)}${e.kind ? ` · ${esc(cap(e.kind))}` : ''}</small></div>
  <span class="countdown"></span>
</li>`;

  const nextExam = upcoming[0]
    ? `<h2>Prossima verifica</h2><ul class="exams card">${examItem(upcoming[0])}</ul>`
    : '';

  // ---------- Materie ----------
  const materie = years.map((y) => yearBlock(y, `
<div class="legend muted">Il numero a destra è la media dell'anno; per le materie di maturità è la media del semestre ${esc(y.lastSem)} (ogni semestre conta come voto finale).</div>
${y.rows.map((r) => (r.children ? groupCard(r, y) : subjectCard(r, y))).join('')}`)).join('');

  // ---------- Verifiche ----------
  const byMonth = {};
  for (const e of upcoming) (byMonth[fmtDate(e.exam_date, { month: 'long', year: 'numeric' })] ??= []).push(e);
  const verifiche = upcoming.length
    ? Object.entries(byMonth).map(([m, list]) => `<h2>${esc(cap(m))}</h2><ul class="exams card">${list.map(examItem).join('')}</ul>`).join('')
    : '<div class="card muted">Nessuna verifica in programma.</div>';

  // ---------- Voti ----------
  const voti = years.map((y) => {
    const list = y.rows.flatMap((r) => (r.children ? r.children : [r])).flatMap((r) => r.list).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return yearBlock(y, list.length ? `<ul class="grades card">${list.map((g) => gradeItem(g, true)).join('')}</ul>` : '<div class="card muted">Ancora nessun voto.</div>');
  }).join('');

  const yearSelect = years.length > 1
    ? `<select id="year">${years.map((y) => `<option value="${esc(y.year)}">${esc(y.year)}</option>`).join('')}</select>`
    : years.length ? `<span class="muted">${esc(years[0].year)}</span>` : '';

  const views = [
    ['home', 'Home', `${home || '<div class="card muted">Ancora nessun voto.</div>'}${nextExam}`],
    ['materie', 'Materie', materie || '<div class="card muted">Ancora nessun voto.</div>'],
    ['verifiche', 'Verifiche', verifiche],
    ['voti', 'Voti', voti || '<div class="card muted">Ancora nessun voto.</div>'],
  ];

  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0f17">
<title>Voti di Ramon</title>
<link rel="icon" href="${favicon}">
<style>
:root{--bg:#0b0f17;--card:#161d2b;--card2:#1d2638;--line:#263046;--text:#e8ecf3;--muted:#8b95a7;--accent:#7c9cff;--good:#3ecf8e;--ok:#f5b942;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}
header{position:sticky;top:0;z-index:5;background:rgba(11,15,23,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:calc(10px + env(safe-area-inset-top)) 16px 10px}
.hwrap{max-width:720px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px}
header h1{font-size:1.15rem;margin:0}header .upd{font-size:.75rem;color:var(--muted)}
select{background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:inherit;font-size:.9rem}
main{max-width:720px;margin:0 auto;padding:16px 16px calc(90px + env(safe-area-inset-bottom))}
section{display:none}section.active{display:block}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 8px}
.card,.subject{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}
.muted{color:var(--muted)}.good{color:var(--good)}.ok{color:var(--ok)}.bad{color:var(--bad)}.none{color:var(--muted)}
.hero{background:linear-gradient(145deg,#1e2a45,#161d2b);border:1px solid var(--line);border-radius:18px;padding:18px;text-align:center}
.hero-label{color:var(--muted);font-size:.85rem}.hero-value{font-size:3rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;margin:4px 0 10px}
.hero .chips{justify-content:center}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center;min-width:0}
.stat b{display:block;font-size:1.3rem;font-variant-numeric:tabular-nums}.stat small{color:var(--muted);font-size:.75rem;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.warn{border-color:#5a2a2a;background:#2a1719;margin-top:10px;font-size:.9rem}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--card2);border-radius:999px;padding:3px 10px;font-size:.85rem;font-variant-numeric:tabular-nums}.chip small{color:var(--muted)}
.chip.tag{color:var(--accent)}
.subject summary{display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer;list-style:none;font-weight:600}
.subject summary::-webkit-details-marker{display:none}
.subject[open]>summary{margin-bottom:10px}
.subject.nested{background:var(--card2);margin:10px 0 0}
.badge{min-width:3.6em;text-align:center;border-radius:10px;padding:3px 8px;font-weight:700;font-variant-numeric:tabular-nums;background:var(--card2)}
.nested .badge{background:var(--card)}
.badge.good{background:rgba(62,207,142,.14)}.badge.ok{background:rgba(245,185,66,.14)}.badge.bad{background:rgba(255,107,107,.14)}
ul.grades,ul.exams{list-style:none;margin:0;padding:0}
ul.grades.card,ul.exams.card{padding:4px 14px}
.subject ul.grades{margin-top:10px}
.grade,.exam{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.grade:first-child,.exam:first-child{border-top:0}
.gval{min-width:2.4em;font-weight:800;font-size:1.1rem;text-align:center;font-variant-numeric:tabular-nums}
.gtext,.etext{display:flex;flex-direction:column;min-width:0;flex:1}.gtext small,.etext small{color:var(--muted);font-size:.8rem}
.replaced{opacity:.45}.replaced .gval{text-decoration:line-through}
.edate{display:flex;flex-direction:column;align-items:center;min-width:2.8em;background:var(--card2);border-radius:10px;padding:4px 6px}
.edate b{font-size:1.1rem;line-height:1.1}.edate small{color:var(--muted);font-size:.7rem;text-transform:uppercase}
.countdown{font-size:.8rem;color:var(--muted);white-space:nowrap}.countdown.soon{color:var(--ok);font-weight:700}
.calc{margin-top:12px;background:var(--card2);border-radius:12px;padding:10px 12px;font-size:.9rem}
.nested .calc{background:var(--card)}
.calc-title{font-weight:600;margin-bottom:6px}.calc-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.calc label{display:flex;align-items:center;gap:6px;color:var(--muted)}.c-out{font-size:1rem;margin-bottom:4px}
.legend{font-size:.8rem;margin:0 2px 12px}
.more{display:block;text-align:right;color:var(--accent);text-decoration:none;font-size:.9rem}
.brand{display:flex;align-items:center;gap:10px}.logo svg{width:38px;height:38px;display:block;filter:drop-shadow(0 4px 12px rgba(167,123,255,.45))}
.grad{background:linear-gradient(90deg,#7c9cff,#a77bff,#ff6fb1);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero{position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-40%;background:radial-gradient(circle at 30% 20%,rgba(124,156,255,.25),transparent 45%),radial-gradient(circle at 80% 90%,rgba(255,111,177,.18),transparent 45%);animation:drift 12s ease-in-out infinite alternate;pointer-events:none}
.hero>*{position:relative}
@keyframes drift{to{transform:translate(6%,-4%) rotate(8deg)}}
.hero-value{text-shadow:0 0 28px currentColor}
.subject{transition:border-color .2s}.subject[open]{border-color:#3a4670}
section.active{animation:fadein .25s ease}
@keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
nav a.active svg{filter:drop-shadow(0 0 6px rgba(124,156,255,.7))}
@media (prefers-reduced-motion:reduce){.hero::before,section.active{animation:none}}
nav{position:fixed;bottom:0;left:0;right:0;z-index:5;background:rgba(16,21,32,.95);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
nav .nwrap{max-width:720px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr)}
nav a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0 10px;color:var(--muted);text-decoration:none;font-size:.72rem}
nav a.active{color:var(--accent)}
nav svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
</style></head><body>
<header><div class="hwrap"><div class="brand"><span class="logo">${logo}</span><div><h1>Voti di <span class="grad">Ramon</span></h1><div class="upd">Aggiornato il ${esc(updated)}</div></div></div>${yearSelect}</div></header>
<main>
${views.map(([id, , content]) => `<section id="v-${id}" data-view="${id}">${content}</section>`).join('\n')}
</main>
<nav><div class="nwrap">${views.map(([id, label]) => `<a href="#${id}" data-nav="${id}">${icons[id]}${label}</a>`).join('')}</div></nav>
<script>
(function () {
  var views = ${JSON.stringify(views.map(([id]) => id))};
  function show() {
    var id = location.hash.slice(1);
    if (views.indexOf(id) < 0) id = 'home';
    document.querySelectorAll('section').forEach(function (s) { s.classList.toggle('active', s.dataset.view === id); });
    document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === id); });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show); show();

  var sel = document.getElementById('year');
  function showYear() {
    var y = sel ? sel.value : null;
    document.querySelectorAll('.year').forEach(function (b, i) {
      b.style.display = (y ? b.dataset.year === y : true) ? '' : 'none';
    });
  }
  if (sel) sel.addEventListener('change', showYear); showYear();

  // Count up the big average once, for a bit of fun.
  document.querySelectorAll('.hero-value').forEach(function (el) {
    var end = parseFloat(el.textContent); if (isNaN(end)) return;
    var t0 = null;
    function step(t) { t0 = t0 || t; var k = Math.min(1, (t - t0) / 700); el.textContent = (end * (1 - Math.pow(1 - k, 3))).toFixed(2); if (k < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  });

  // Countdown to each exam, computed when the page is opened.
  var today = new Date(); today.setHours(0, 0, 0, 0);
  document.querySelectorAll('.exam').forEach(function (e) {
    var p = e.dataset.date.slice(0, 10).split('-');
    var d = new Date(+p[0], p[1] - 1, +p[2]);
    var n = Math.round((d - today) / 86400000);
    var c = e.querySelector('.countdown');
    c.textContent = n < 0 ? 'passata' : n === 0 ? 'oggi' : n === 1 ? 'domani' : 'tra ' + n + ' giorni';
    if (n >= 0 && n <= 3) c.classList.add('soon');
    if (n < 0) e.style.display = 'none';
  });

  // Grade needed on the next test to reach the chosen average (scale 1–6).
  document.querySelectorAll('.calc').forEach(function (c) {
    var sum = +c.dataset.sum, w = +c.dataset.w, out = c.querySelector('.c-out');
    function calc() {
      var t = +c.querySelector('.c-target').value, nw = +c.querySelector('.c-weight').value;
      var need = (t * (w + nw) - sum) / nw;
      if (need <= 1) out.innerHTML = '<b class="good">Già raggiunta</b>, basta qualsiasi voto.';
      else if (need > 6) out.innerHTML = '<b class="bad">Non raggiungibile</b> con un solo voto.';
      else out.innerHTML = 'Serve almeno <b class="' + (need >= 5 ? 'bad' : need >= 4 ? 'ok' : 'good') + '">' + (Math.ceil(need * 4) / 4).toFixed(2) + '</b>';
    }
    c.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', calc); });
    calc();
  });
})();
</script>
</body></html>`;
}
