// Logs into HolyExam with your own account, reads YOUR grades (read-only)
// and writes a simple page to dist/index.html.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';

// Public values from the app's config.js (safe to share by design).
const SUPABASE_URL = 'https://tzeimuczwvpqysebswmx.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZWltdWN6d3ZwcXlzZWJzd214Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NzUxMTYsImV4cCI6MjEwNTI1MTExNn0.mdBBp8os2hdlRmYOsgcA72Wr7TikivPKvl4UibJRkJU';

const { HOLYEXAM_EMAIL, HOLYEXAM_PASSWORD } = process.env;
if (!HOLYEXAM_EMAIL || !HOLYEXAM_PASSWORD) {
  throw new Error('Set HOLYEXAM_EMAIL and HOLYEXAM_PASSWORD (GitHub secrets).');
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
  email: HOLYEXAM_EMAIL,
  password: HOLYEXAM_PASSWORD,
});
if (authErr) throw new Error('Login failed: ' + authErr.message);
const me = auth.user.id;

async function run(q, what) {
  const { data, error } = await q;
  if (error) throw new Error(`Could not load ${what}: ${error.message}`);
  return data ?? [];
}

// Only rows belonging to me.
const grades = await run(
  sb.from('grades')
    .select('id, subject_id, value, weight, date, description, semester, school_year, recupero, exam_id')
    .eq('user_id', me)
    .order('date', { ascending: false }),
  'grades'
);

const subjectIds = [...new Set(grades.map((g) => g.subject_id).filter(Boolean))];
const gradedSubjects = subjectIds.length
  ? await run(sb.from('subjects').select('id, name, class_id, position, category, period, is_group, parent_id, group_weight').in('id', subjectIds), 'subjects')
  : [];

// Upcoming tests for my class(es).
const classIds = [...new Set(gradedSubjects.map((s) => s.class_id).filter(Boolean))];
// All subjects of my class(es), so upcoming tests in subjects without grades still get a name.
const subjects = classIds.length
  ? await run(sb.from('subjects').select('id, name, class_id, position, category, period, is_group, parent_id, group_weight').in('class_id', classIds), 'class subjects')
  : gradedSubjects;
// TEMPORARY (to find how maturità subjects are marked): subject names and categories only, no grades.
console.log('Subjects (name | category | period | group):');
for (const s of [...subjects].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)))
  console.log(`  ${s.name} | ${s.category ?? '-'} | ${s.period ?? '-'} | ${s.is_group ? 'group' : s.parent_id ? 'in ' + (subjects.find((p) => p.id === s.parent_id)?.name ?? '?') : '-'}`);
const today = new Date().toISOString().slice(0, 10);
const upcoming = classIds.length
  ? await run(
      sb.from('exams')
        .select('title, exam_date, subject_id, kind')
        .in('class_id', classIds)
        .gte('exam_date', today)
        .order('exam_date'),
      'exams'
    )
  : [];

await sb.auth.signOut();

// ---------- build the page ----------
const subjById = Object.fromEntries(subjects.map((s) => [s.id, s]));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich' }) : '');

// Weight: missing = 1, 0 = does not count.
const weightOf = (g) => (g.weight === null || g.weight === undefined || g.weight === '' ? 1 : Number(g.weight));
function wavg(list) {
  const w = list.reduce((a, g) => a + weightOf(g), 0);
  return w > 0 ? list.reduce((a, g) => a + Number(g.value) * weightOf(g), 0) / w : null;
}
const groupBy = (list, key) => list.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const bySort = (a, b) => (a.position ?? 999) - (b.position ?? 999) || String(a.name).localeCompare(String(b.name));

// Recupero: a grade marked recupero becomes the grade of its exam; the other grades of that exam stop counting.
const recuperoExams = new Set(grades.filter((g) => g.recupero && g.exam_id).map((g) => g.exam_id));
for (const g of grades) g.replaced = !g.recupero && recuperoExams.has(g.exam_id);
const counted = (list) => list.filter((g) => !g.replaced);

// Maturità subjects: the full-year average uses only 2nd-semester grades.
// TODO: how a subject is marked as maturità is not known yet; until then every subject uses all grades.
const isMaturita = (subject) => false;

// Group average: average of the subjects in it, multiplied by their group_weight. Subjects without grades are skipped.
function groupAvg(children, pick) {
  const parts = children.map((c) => ({ v: pick(c), w: c.groupWeight })).filter((p) => p.v !== null && p.w > 0);
  const w = parts.reduce((a, p) => a + p.w, 0);
  return w > 0 ? parts.reduce((a, p) => a + p.v * p.w, 0) / w : null;
}
const mean = (vals) => ((vals = vals.filter((v) => v !== null)).length ? vals.reduce((a, v) => a + v, 0) / vals.length : null);

// Never mix school years: one section per year, each with per-semester and whole-year averages.
const years = Object.entries(groupBy(grades, (g) => g.school_year ?? '?'))
  .sort(([a], [b]) => String(b).localeCompare(String(a)))
  .map(([year, yearGrades]) => {
    const semesters = [...new Set(yearGrades.map((g) => String(g.semester ?? '?')))].sort();
    const lastSem = semesters[semesters.length - 1];
    const subjectRow = (id, list) => {
      const s = subjById[id] ?? { name: 'Altro' };
      const c = counted(list);
      const bySem = Object.fromEntries(semesters.map((sem) => [sem, wavg(c.filter((g) => String(g.semester ?? '?') === sem))]));
      return {
        id, name: s.name, position: s.position, list,
        groupWeight: s.group_weight === null || s.group_weight === undefined ? 1 : Number(s.group_weight),
        bySem,
        year: isMaturita(s) ? bySem[lastSem] ?? null : wavg(c),
      };
    };
    // Top-level units: plain subjects, and groups made of their subjects.
    const units = {};
    for (const [id, list] of Object.entries(groupBy(yearGrades, (g) => g.subject_id ?? 'none'))) {
      const row = subjectRow(id, list);
      const parent = subjById[id]?.parent_id && subjById[subjById[id].parent_id];
      // Grades entered directly on a group count as one more subject inside it.
      const groupId = parent ? parent.id : subjById[id]?.is_group ? id : null;
      if (groupId) {
        const g = subjById[groupId];
        const u = (units[groupId] ??= { id: groupId, name: g.name, position: g.position, children: [] });
        u.children.push(row);
      } else {
        units[id] = row;
      }
    }
    const rows = Object.values(units).sort(bySort).map((u) => {
      if (!u.children) return u;
      u.children.sort(bySort);
      u.bySem = Object.fromEntries(semesters.map((sem) => [sem, groupAvg(u.children, (c) => c.bySem[sem])]));
      u.year = groupAvg(u.children, (c) => c.year);
      return u;
    });
    // Overall average: plain mean of the top-level units (a group counts as one subject).
    const overall = {
      bySem: Object.fromEntries(semesters.map((sem) => [sem, mean(rows.map((r) => r.bySem[sem]))])),
      year: mean(rows.map((r) => r.year)),
    };
    return { year, semesters, rows, overall };
  });

const color = (v) => (v === null ? 'muted' : v >= 5 ? 'good' : v >= 4 ? 'ok' : 'bad');
const fmtAvg = (v) => (v === null ? '–' : v.toFixed(2));

const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voti di Ramon</title>
<style>
:root{--bg:#0f1420;--card:#18202f;--text:#e8ecf3;--muted:#8b95a7;--good:#3ecf8e;--ok:#f5b942;--bad:#ff6b6b}
@media (prefers-color-scheme: light){:root{--bg:#f4f6fa;--card:#fff;--text:#1a2233;--muted:#667085}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.5rem;margin:0 0 4px}.muted{color:var(--muted);font-size:.85rem}
h2{font-size:1.1rem;margin:28px 0 10px}
.card{background:var(--card);border-radius:12px;padding:14px 16px;margin-bottom:10px}
details summary{display:flex;justify-content:space-between;cursor:pointer;list-style:none;font-weight:600}
.avg{font-variant-numeric:tabular-nums}.good{color:var(--good)}.ok{color:var(--ok)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:.9rem}
td{padding:6px 0;border-top:1px solid #8882}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.avgs{display:flex;gap:14px;font-variant-numeric:tabular-nums}.avgs small{color:var(--muted);font-weight:400;margin-right:3px}
.sub{border-top:1px solid #8883;padding:10px 0 0 10px;margin-top:10px}.sub summary{font-weight:500}
.replaced td{text-decoration:line-through;opacity:.5}.total .row{display:flex;justify-content:space-between;font-weight:700}
summary{gap:10px;align-items:baseline}
</style></head><body><main>
<h1>📚 Voti di Ramon</h1>
<div class="muted">Aggiornato: ${esc(new Date().toLocaleString('it-CH', { timeZone: 'Europe/Zurich' }))}</div>

<h2>Prossime verifiche</h2>
${upcoming.length ? upcoming.map((e) => `<div class="card">${esc(fmtDate(e.exam_date))} · <b>${esc(subjById[e.subject_id]?.name ?? '')}</b> ${esc(e.title)}</div>`).join('') : '<div class="card muted">Nessuna verifica in programma.</div>'}

${years.map((y) => {
  const avgs = (r) => `<span class="avgs">${y.semesters.map((s) => `<span><small>S${esc(s)}</small><span class="${color(r.bySem[s])}">${fmtAvg(r.bySem[s])}</span></span>`).join('')}<span><small>Anno</small><span class="${color(r.year)}">${fmtAvg(r.year)}</span></span></span>`;
  const gradeRows = (list) => list.map((g) => `<tr${g.replaced ? ' class="replaced"' : ''}><td>${esc(fmtDate(g.date))} ${esc(g.description)} <span class="muted">S${esc(g.semester ?? '?')}</span>${g.recupero ? ' <b>(recupero)</b>' : ''}${weightOf(g) !== 1 ? ` <span class="muted">×${esc(weightOf(g))}</span>` : ''}</td><td class="${color(Number(g.value))}">${esc(g.value)}</td></tr>`).join('');
  const subjectCard = (r, cls = 'card') => `<details class="${cls}"><summary><span>${esc(r.name)}${r.groupWeight !== undefined && cls === 'sub' && r.groupWeight !== 1 ? ` <span class="muted">×${esc(r.groupWeight)}</span>` : ''}</span>${avgs(r)}</summary><table>${gradeRows(r.list)}</table></details>`;
  return `<h2>Anno ${esc(y.year)}</h2>
<div class="card total"><div class="row"><span>Media generale</span>${avgs(y.overall)}</div></div>
${y.rows.map((r) => (r.children ? `<details class="card"><summary><span>${esc(r.name)} <span class="muted">(gruppo)</span></span>${avgs(r)}</summary>${r.children.map((c) => subjectCard(c, 'sub')).join('')}</details>` : subjectCard(r))).join('')}`;
}).join('') || '<div class="card muted">Ancora nessun voto.</div>'}
</main></body></html>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`OK: ${grades.length} grades, ${upcoming.length} upcoming tests.`);
