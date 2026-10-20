// Puts my class tests into the shared calendar as my events (run after fetch.mjs).
// The calendar adds new tests, updates tests whose date or title changed, and removes
// tests that are gone from HolyExam; items made in the calendar app are never touched.
import { readFileSync } from 'node:fs';
import { pushKeys, rpc } from './push.mjs';

const keys = pushKeys(process.env.PAGE_PASSWORD);
if (!keys) throw new Error('PAGE_PASSWORD is missing.');

const { subjects, exams } = JSON.parse(readFileSync('data.json', 'utf8'));
const name = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const list = exams
  .filter((e) => e.id && e.exam_date)
  .map((e) => ({
    id: String(e.id),
    date: String(e.exam_date).slice(0, 10),
    title: [name[e.subject_id], e.title].filter(Boolean).join(': '),
    notes: [cap(e.kind), 'da HolyExam'].filter(Boolean).join(' · '),
  }));

const result = await rpc('holyexam_sync_exams', { p_token: keys.token, p_exams: list });
if (!result) throw new Error('The calendar refused the token.');
console.log(`Calendar: ${list.length} tests sent, ${result.changed} added or updated, ${result.removed} removed.`);
