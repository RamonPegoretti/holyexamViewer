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
  ? await run(sb.from('subjects').select('id, name, class_id, position').in('id', subjectIds), 'subjects')
  : [];

// Upcoming tests for my class(es).
const classIds = [...new Set(gradedSubjects.map((s) => s.class_id).filter(Boolean))];
// All subjects of my class(es), so upcoming tests in subjects without grades still get a name.
const subjects = classIds.length
  ? await run(sb.from('subjects').select('id, name, class_id, position').in('class_id', classIds), 'class subjects')
  : gradedSubjects;
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

// Weighted average per subject (approximation; the app may round or group differently).
const bySubject = {};
for (const g of grades) {
  const k = g.subject_id ?? 'none';
  (bySubject[k] ??= []).push(g);
}
const rows = Object.entries(bySubject)
  .map(([id, list]) => {
    const w = list.reduce((a, g) => a + (Number(g.weight) || 1), 0);
    const avg = list.reduce((a, g) => a + Number(g.value) * (Number(g.weight) || 1), 0) / w;
    return { name: subjById[id]?.name ?? 'Altro', pos: subjById[id]?.position ?? 999, avg, list };
  })
  .sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name));

const color = (v) => (v >= 5 ? 'good' : v >= 4 ? 'ok' : 'bad');

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
</style></head><body><main>
<h1>📚 Voti di Ramon</h1>
<div class="muted">Aggiornato: ${esc(new Date().toLocaleString('it-CH', { timeZone: 'Europe/Zurich' }))}</div>

<h2>Prossime verifiche</h2>
${upcoming.length ? upcoming.map((e) => `<div class="card">${esc(fmtDate(e.exam_date))} · <b>${esc(subjById[e.subject_id]?.name ?? '')}</b> ${esc(e.title)}</div>`).join('') : '<div class="card muted">Nessuna verifica in programma.</div>'}

<h2>Medie per materia</h2>
${rows.map((r) => `<details class="card"><summary><span>${esc(r.name)}</span><span class="avg ${color(r.avg)}">${r.avg.toFixed(2)}</span></summary>
<table>${r.list.map((g) => `<tr><td>${esc(fmtDate(g.date))} ${esc(g.description)}${g.recupero ? ' (recupero)' : ''}${Number(g.weight) && Number(g.weight) !== 1 ? ` <span class="muted">×${esc(g.weight)}</span>` : ''}</td><td class="${color(Number(g.value))}">${esc(g.value)}</td></tr>`).join('')}</table></details>`).join('') || '<div class="card muted">Ancora nessun voto.</div>'}
</main></body></html>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`OK: ${grades.length} grades, ${upcoming.length} upcoming tests.`);
