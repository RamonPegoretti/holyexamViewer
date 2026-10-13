// Logs into HolyExam with your own account, reads YOUR grades (read-only)
// and writes a simple page to dist/index.html.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderPage } from './page.mjs';

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
const today = new Date().toISOString().slice(0, 10);
// All tests of my class(es), past and upcoming.
const exams = classIds.length
  ? await run(
      sb.from('exams')
        .select('id, title, exam_date, subject_id, kind')
        .in('class_id', classIds)
        .order('exam_date'),
      'exams'
    )
  : [];
const upcoming = exams.filter((e) => String(e.exam_date).slice(0, 10) >= today);

await sb.auth.signOut();

// ---------- build the page ----------
const subjById = Object.fromEntries(subjects.map((s) => [s.id, s]));

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

// Maturità subjects: each semester is a final grade of its own, so no year average is shown;
// in the yearly Media generale they count with their last-semester average only.
const isMaturita = (subject) => subject.category === 'maturita';

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
        id, name: s.name, position: s.position, category: s.category, list,
        groupWeight: s.group_weight === null || s.group_weight === undefined ? 1 : Number(s.group_weight),
        bySem,
        maturita: isMaturita(s),
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
        const u = (units[groupId] ??= { id: groupId, name: g.name, position: g.position, category: g.category, children: [] });
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
      u.maturita = u.children.every((c) => c.maturita);
      return u;
    });
    // Overall average: plain mean of the top-level units (a group counts as one subject).
    // 'neutra' subjects (Educazione fisica) do not count.
    const inOverall = rows.filter((r) => r.category !== 'neutra');
    const overall = {
      bySem: Object.fromEntries(semesters.map((sem) => [sem, mean(inOverall.map((r) => r.bySem[sem]))])),
      year: mean(inOverall.map((r) => r.year)),
    };
    return { year, semesters, lastSem, rows, overall };
  });

const html = renderPage({ years, exams, upcoming, grades, subjById, weightOf });

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
// The data behind the page (not the timestamp), so the workflow can tell whether anything changed.
// Kept outside dist/ so it is never published.
writeFileSync('data.json', JSON.stringify({ grades, subjects, exams }));
console.log(`OK: ${grades.length} grades, ${exams.length} tests (${upcoming.length} upcoming).`);
