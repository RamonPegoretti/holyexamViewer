// Popup notifications (web push) for the viewer.
//
// Phones sign up from the page; their sign-ups are kept in the shared-calendar Supabase project, in its own
// holyexam_* tables, reachable only through functions that check a token only this viewer knows.
// The token and the VAPID keys are derived from PAGE_PASSWORD, so no extra secret is needed
// (changing PAGE_PASSWORD means phones have to turn notifications on again).
//
//   node push.mjs plan   (build job, after fetch.mjs) decides what to notify; writes job outputs
//   node push.mjs send   (notify job, after the page is live) sends it and saves the new state
//
// Notifications never contain grades: only the subject, so nothing sensitive shows on a lock screen.
import { createHmac, createECDH } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';

export const PUSH_SUPABASE_URL = 'https://eqwxzvgglodkefwutapi.supabase.co';
// Public by design (shared-calendar's anon key); the holyexam_* functions check the token themselves.
export const PUSH_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxd3h6dmdnbG9ka2Vmd3V0YXBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MzQwNzQsImV4cCI6MjEwNzIxMDA3NH0.8UXUUiDNu4rnpJ7oUC3kcyDHh8SndWlrnONa0GQRbjU';

const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** VAPID key pair and Supabase token, all derived from the page password. */
export function pushKeys(password) {
  if (!password) return null;
  const mac = (label) => createHmac('sha256', password).update(label).digest();
  const d = (BigInt('0x' + mac('holyexam-vapid-v1').toString('hex')) % (P256_ORDER - 1n)) + 1n;
  const priv = Buffer.from(d.toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(priv), token: mac('holyexam-token-v1').toString('hex') };
}

async function rpc(fn, args) {
  const res = await fetch(`${PUSH_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: PUSH_SUPABASE_KEY, Authorization: `Bearer ${PUSH_SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} failed: HTTP ${res.status}`);
  return res.json();
}

const zurichDate = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }); // YYYY-MM-DD
const zurichHour = (d) => Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23' }));
const list = (names) => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1]);

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return console.log(`[${name}] ${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<__END__\n${value}\n__END__\n`);
}

async function plan(keys) {
  const { grades, subjects, exams } = JSON.parse(readFileSync('data.json', 'utf8'));
  const name = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  if (!(await rpc('holyexam_claim', { p_token: keys.token }))) throw new Error('Notification storage refused the token.');
  const state = (await rpc('holyexam_get_state', { p_token: keys.token })) ?? {};
  const messages = [];

  // New grades. The very first run only remembers what is already there.
  const ids = grades.map((g) => String(g.id));
  if (Array.isArray(state.seen)) {
    const seen = new Set(state.seen);
    const fresh = grades.filter((g) => !seen.has(String(g.id)));
    if (fresh.length) {
      const subj = [...new Set(fresh.map((g) => name[g.subject_id] ?? 'una materia'))];
      messages.push({
        title: fresh.length === 1 ? 'Nuovo voto 📚' : `${fresh.length} nuovi voti 📚`,
        body: `${fresh.length === 1 ? 'Nuovo voto' : 'Nuovi voti'} in ${list(subj)}. Apri l'app per vederlo.`,
        tag: 'voti', url: './#voti',
      });
    }
  }

  // Test reminders from 19:00 the evening before.
  const now = new Date();
  const reminded = new Set(state.reminded ?? []);
  if (zurichHour(now) >= 19) {
    const tomorrow = zurichDate(new Date(now.getTime() + 24 * 3600 * 1000));
    const due = exams.filter((e) => String(e.exam_date).slice(0, 10) === tomorrow && !reminded.has(String(e.id)));
    if (due.length) {
      messages.push({
        title: due.length === 1 ? 'Verifica domani ✏️' : `${due.length} verifiche domani ✏️`,
        body: due.length === 1 ? `${name[due[0].subject_id] ?? ''}: ${due[0].title}` : list(due.map((e) => name[e.subject_id] ?? e.title)),
        tag: 'verifiche', url: './#verifiche',
      });
      due.forEach((e) => reminded.add(String(e.id)));
    }
  }

  if (process.env.TEST_PUSH === 'true') {
    messages.push({ title: 'Prova 🔔', body: 'Le notifiche funzionano su questo telefono.', tag: 'prova', url: './' });
  }

  const next = { seen: ids, reminded: [...reminded].slice(-300) };
  const changed = JSON.stringify(next) !== JSON.stringify({ seen: state.seen, reminded: state.reminded ?? [] });
  console.log(`Notifications planned: ${messages.length}.`);
  setOutput('notify', messages.length || changed ? 'true' : 'false');
  setOutput('messages', JSON.stringify(messages));
  setOutput('state', JSON.stringify(next));
}

async function send(keys) {
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails('https://ramonpegoretti.github.io/holyexamViewer/', keys.publicKey, keys.privateKey);
  const messages = JSON.parse(process.env.MESSAGES || '[]');
  const subs = messages.length ? await rpc('holyexam_list_subscriptions', { p_token: keys.token }) : [];
  let ok = 0, gone = 0;
  for (const s of subs) {
    for (const m of messages) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(m), { TTL: 12 * 3600, urgency: 'normal' });
        ok++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await rpc('holyexam_remove_subscription', { p_token: keys.token, p_endpoint: s.endpoint });
          gone++;
          break;
        }
        console.log(`A notification could not be sent (HTTP ${e.statusCode ?? '?'}).`);
      }
    }
  }
  if (process.env.STATE) await rpc('holyexam_set_state', { p_token: keys.token, p_state: JSON.parse(process.env.STATE) });
  console.log(`Sent ${ok} notification(s) to ${subs.length} phone(s); ${gone} phone(s) no longer signed up.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = pushKeys(process.env.PAGE_PASSWORD);
  if (!keys) throw new Error('PAGE_PASSWORD is missing.');
  const mode = process.argv[2];
  if (mode === 'plan') await plan(keys);
  else if (mode === 'send') await send(keys);
  else throw new Error('Usage: node push.mjs plan|send');
}
