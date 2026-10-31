#!/usr/bin/env node
// TAKATAK Food Hub — crash-replay check, MASTER PLAN Phase 1 acceptance: "Killing the server between receiving an order
// and processing it loses nothing; the order is replayed." (docs/CRASH_REPLAY_E2E.md)
//
// Run:  npm run build && npm run verify:crash
// Needs a REAL Postgres behind PostgREST (memory mode forgets everything on a restart, so it cannot prove this):
//   FOODHUB_CRASH_POSTGREST_URL  PostgREST root on this machine, e.g. http://127.0.0.1:3000 (loopback only)
//   FOODHUB_CRASH_SERVICE_KEY    a service_role JWT for it (node scripts/e2e/postgrest.mjs service-jwt)
// Without them it SKIPS (exit 0) — CI provides both (.github/workflows/ci.yml, job "crash-replay").
//
// It boots the built app (`next start`) on that database against the same simulated platforms as verify:foodhub
// (scripts/e2e/platform-mock.mjs), then:
//   1. sends a signed Uber Eats order webhook; the app saves it in the webhook inbox and answers 200; the TEST-ONLY
//      delay hook (FOODHUB_E2E_PROCESS_DELAY_MS, lib/foodhub/e2e-hooks.ts) holds it in "processing"; the server is
//      KILLED (SIGKILL to its process group / taskkill /F /T) and restarted on the same database: the recovery runner
//      must process the saved webhook — exactly ONE order row, ONE Clover order, ONE kitchen ticket, ONE Uber accept;
//   2. lets a second order finish, kills the server, restarts it: nothing is processed again.
// FOODHUB_E2E_INBOX_STUCK_MS (same guard) makes "interrupted" mean 3 s instead of 2 minutes so the check is quick.
import { spawn, spawnSync } from 'node:child_process';
import { APP, APP_PORT, MOCK_PORT, appEnv, call, log, mock, sleep, uberWebhook, waitFor } from './e2e/platform-mock.mjs';
import { startRestProxy } from './e2e/postgrest.mjs';

const REST = String(process.env.FOODHUB_CRASH_POSTGREST_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.FOODHUB_CRASH_SERVICE_KEY || '');
if (!REST || !KEY) {
  console.log('SKIP  verify:crash needs a real Postgres behind PostgREST (FOODHUB_CRASH_POSTGREST_URL + FOODHUB_CRASH_SERVICE_KEY).');
  console.log('      Memory mode cannot survive a restart, so this proof runs in CI: Food Hub CI → "Crash replay (real Postgres)".');
  console.log('      To run it yourself, see docs/CRASH_REPLAY_E2E.md.');
  process.exit(0);
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(REST).hostname)) {
  console.error(`verify:crash refuses ${REST}: it writes test orders, so the database must be a throwaway one on this machine (127.0.0.1).`);
  process.exit(1);
}

const STUCK_MS = 3000; // "interrupted" after 3 s in this check (2 minutes in real life)
const PROXY_PORT = Number(process.env.FOODHUB_CRASH_PROXY_PORT) || APP_PORT + 1;
const RUN = Date.now().toString(36); // order ids unique per run, in case the same database is used twice

let passed = 0; let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ---- the database, read directly through PostgREST (never through the app under test) ----
async function rest(query) {
  const res = await fetch(`${REST}/${query}`, { headers: { authorization: `Bearer ${KEY}`, apikey: KEY, accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${res.status} on ${query}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const q = encodeURIComponent;
const inboxEntry = async (id) => (await rest(`fh_docs?collection=eq.webhook_inbox&id=eq.${q(id)}&select=key,data`))[0]?.data ?? null;
const orderRows = (externalId) => rest(`fh_orders?channel=eq.uber_eats&external_order_id=eq.${q(externalId)}&select=id,status,pos_order_id`);
const orderEvents = (orderId) => rest(`fh_order_events?order_id=eq.${q(orderId)}&select=type`);
const kv = async (key) => (await rest(`fh_kv?key=eq.${q(key)}&select=value`))[0]?.value ?? null;

// ---- what reached the simulated platforms since `mark` (index in the mock's request log) ----
const since = (mark, method, re) => log.slice(mark).filter((e) => e.method === method && re.test(e.path));
const cloverOrders = (mark) => since(mark, 'POST', /\/atomic_order\/orders$/);
const prints = (mark) => since(mark, 'POST', /\/print_event$/);
const uberAccepts = (mark, id) => since(mark, 'POST', new RegExp(`^/uber/v1/eats/orders/${id}/accept_pos_order$`));
const uberFetches = (mark, id) => since(mark, 'GET', new RegExp(`/uber/v2/eats/order/${id}$`));

// ---- the app process: start, hard kill, restart ----
let appLog = '';
let app = null;
const baseEnv = appEnv();
for (const k of ['FOODHUB_FORCE_MEMORY', 'SUPABASE_URL', 'FOODHUB_E2E_PROCESS_DELAY_MS', 'FOODHUB_E2E_INBOX_STUCK_MS']) delete baseEnv[k];
Object.assign(baseEnv, {
  // The test-only hooks act only with FOODHUB_E2E=1 and a run-time NODE_ENV other than production (e2e-hooks.ts).
  NODE_ENV: 'test',
  FOODHUB_E2E: '1',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  FOODHUB_WATCH_INTERVAL_S: '0', // no server timer unless a step turns it on (the restarts do)
});

function startApp(label, extra = {}) {
  const proc = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    env: { ...baseEnv, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // its own process group, so SIGKILL reaches every child
  });
  const keep = (d) => { appLog += String(d).split('\n').filter(Boolean).map((l) => `[${label}] ${l}\n`).join(''); };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  return proc;
}
const appUp = () => waitFor(async () => { try { return (await fetch(`${APP}/api/foodhub/channels`)).status > 0; } catch { return false; } }, 60_000);
const appDown = () => waitFor(async () => { try { await fetch(`${APP}/api/foodhub/channels`); return false; } catch { return true; } }, 15_000);

/** The crash: no shutdown hook, no after() callback, nothing gets to finish. */
async function hardKill(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  const exited = new Promise((r) => proc.once('exit', () => r()));
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
  else { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); } }
  await Promise.race([exited, sleep(10_000)]);
}

// ---------------- run ----------------
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const proxy = await startRestProxy({ target: REST, port: PROXY_PORT });
baseEnv.NEXT_PUBLIC_SUPABASE_URL = proxy.url;

try {
  console.log('\n0. Food Hub on a real Postgres (postgres + PostgREST, the pair Supabase runs)');
  check('PostgREST answers with the service_role key and the Food Hub schema is installed', Array.isArray(await rest('fh_orders?select=id&limit=1')));
  app = startApp('boot-1', { FOODHUB_E2E_PROCESS_DELAY_MS: '60000' });
  check('the built app starts on the database', !!(await appUp()), appLog.slice(-2000));
  const store = (await call('POST', '/api/foodhub/stores', { body: { channel: 'uber_eats', channelStoreId: 'uber-store-uuid-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' } })).json?.store;
  const storeRows = await rest('fh_channel_stores?channel=eq.uber_eats&channel_store_id=eq.uber-store-uuid-1&select=id');
  check('the app writes to Postgres, not to memory (store mapping row in fh_channel_stores)', !!store?.id && storeRows.length === 1, JSON.stringify({ store: store?.id, storeRows }));

  console.log('\n1. Server killed between the 200 and the end of processing → the order is replayed exactly once');
  const mid = `uber-crash-mid-${RUN}`;
  const midEvent = `evt-${mid}`;
  const mark1 = log.length;
  const hook1 = await uberWebhook(mid);
  // Within milliseconds of the 200: the entry is "processing" and the delay hook holds it there.
  const held = await waitFor(async () => { const e = await inboxEntry(midEvent); return e?.status === 'processing' ? e : null; }, 10_000);
  await hardKill(app); app = null;
  check('Uber got its 200 (the webhook was saved in the inbox before the answer)', hook1.status === 200, String(hook1.status));
  check('the server was killed while the entry was "processing" (test delay hook)', held?.status === 'processing' && held.attempts === 1, JSON.stringify(held && { status: held.status, attempts: held.attempts }));
  check('the server is really gone', !!(await appDown()));
  const atKill = await inboxEntry(midEvent);
  check('the saved webhook survived the kill (still "processing", never finished)', atKill?.status === 'processing' && atKill.attempts === 1, JSON.stringify(atKill && { status: atKill.status, attempts: atKill.attempts }));
  check('nothing reached the kitchen before the kill: no order row, no Clover order, no ticket', (await orderRows(mid)).length === 0 && cloverOrders(mark1).length === 0 && prints(mark1).length === 0 && uberFetches(mark1, mid).length === 0,
    JSON.stringify({ rows: (await orderRows(mid)).length, clover: cloverOrders(mark1).length, prints: prints(mark1).length }));

  await sleep(STUCK_MS + 500); // by the restart the entry counts as interrupted
  const restart1 = Date.now();
  app = startApp('boot-2', { FOODHUB_E2E_INBOX_STUCK_MS: String(STUCK_MS), FOODHUB_WATCH_INTERVAL_S: '15' });
  check('restarted on the same database', !!(await appUp()), appLog.slice(-2000));
  const replayed = await waitFor(async () => { const e = await inboxEntry(midEvent); return e?.status === 'done' ? e : null; }, 90_000);
  check('the recovery runner processed the saved webhook after the restart (2nd try, done, linked to its order)', replayed?.attempts === 2 && !!replayed.orderId, JSON.stringify(replayed && { status: replayed.status, attempts: replayed.attempts, result: replayed.result, lastError: replayed.lastError }));
  const last1 = await kv('recovery:last');
  check('…run by the restarted server\'s own timer (no person, no platform re-delivery)', last1?.trigger === 'timer' && Date.parse(last1.at) >= restart1, JSON.stringify(last1));
  const rows1 = await orderRows(mid);
  const posId = rows1[0]?.pos_order_id;
  check('exactly ONE order row, accepted', rows1.length === 1 && rows1[0].status === 'accepted' && rows1[0].id === replayed?.orderId, JSON.stringify(rows1));
  check('exactly ONE Clover order, the one on the order row', cloverOrders(mark1).length === 1 && !!posId && posId.startsWith('CLV'), JSON.stringify({ clover: cloverOrders(mark1).length, posId }));
  check('exactly ONE kitchen ticket printed, for that Clover order', prints(mark1).length === 1 && prints(mark1)[0].body?.orderRef?.id === posId, JSON.stringify(prints(mark1).map((p) => p.body?.orderRef?.id)));
  check('accepted on Uber exactly once, with the Clover order id', uberAccepts(mark1, mid).length === 1 && uberAccepts(mark1, mid)[0].body?.external_reference_id === posId);
  const events1 = rows1[0] ? await orderEvents(rows1[0].id) : [];
  check('no duplicate: no "duplicate_delivery" event, no unique-key error in the logs', !events1.some((e) => e.type === 'duplicate_delivery') && !/duplicate key|23505/i.test(appLog), JSON.stringify(events1.map((e) => e.type)));
  await hardKill(app); app = null;
  await appDown();

  console.log('\n2. Server killed after processing finished → nothing is processed again');
  const done = `uber-crash-done-${RUN}`;
  const doneEvent = `evt-${done}`;
  app = startApp('boot-3');
  check('started again on the database', !!(await appUp()), appLog.slice(-2000));
  const mark2 = log.length;
  const hook2 = await uberWebhook(done);
  const finished = await waitFor(async () => { const e = await inboxEntry(doneEvent); return e?.status === 'done' ? e : null; }, 30_000);
  check('Uber got its 200 and the order was processed live (done after one try)', hook2.status === 200 && finished?.attempts === 1, JSON.stringify(finished && { status: finished.status, attempts: finished.attempts }));
  const before = { rows: (await orderRows(done)).length, clover: cloverOrders(mark2).length, prints: prints(mark2).length, accepts: uberAccepts(mark2, done).length };
  check('one order row, one Clover order, one ticket, one Uber accept before the kill', Object.values(before).every((n) => n === 1), JSON.stringify(before));
  await hardKill(app); app = null;
  check('the server is really gone', !!(await appDown()));
  await sleep(STUCK_MS + 500);
  const restart2 = Date.now();
  app = startApp('boot-4', { FOODHUB_E2E_INBOX_STUCK_MS: String(STUCK_MS), FOODHUB_WATCH_INTERVAL_S: '15' });
  check('restarted on the same database', !!(await appUp()), appLog.slice(-2000));
  // Two recovery runs after the restart: the second only starts once the first has finished its sweep (recovery.ts).
  const firstRun = await waitFor(async () => { const l = await kv('recovery:last'); return l && Date.parse(l.at) >= restart2 ? l : null; }, 60_000);
  const secondRun = firstRun && await waitFor(async () => { const l = await kv('recovery:last'); return l && Date.parse(l.at) > Date.parse(firstRun.at) ? l : null; }, 60_000);
  check('the recovery runner ran (twice) after the restart, past the "interrupted" time', !!secondRun && Date.parse(firstRun.at) - Date.parse(finished?.updatedAt ?? '') >= STUCK_MS, JSON.stringify({ firstRun, secondRun }));
  const after = await inboxEntry(doneEvent);
  check('the finished entry was not processed again (still done, one try, untouched)', after?.status === 'done' && after.attempts === 1 && after.updatedAt === finished?.updatedAt, JSON.stringify(after && { status: after.status, attempts: after.attempts }));
  const afterCounts = { rows: (await orderRows(done)).length, clover: cloverOrders(mark2).length, prints: prints(mark2).length, accepts: uberAccepts(mark2, done).length };
  check('still exactly ONE order row, ONE Clover order, ONE ticket, ONE Uber accept', Object.values(afterCounts).every((n) => n === 1), JSON.stringify(afterCounts));

  const crashes = appLog.split('\n').filter((l) => /\[foodhub\] .* failed|Unhandled|TypeError|ReferenceError/.test(l) && !/kept in the inbox/.test(l));
  check('no background job crashed in any of the four boots', crashes.length === 0, crashes.slice(0, 3).join(' | '));
} catch (e) {
  failed += 1;
  console.log(`  FAIL  the check itself stopped: ${e instanceof Error ? e.stack : e}`);
} finally {
  await hardKill(app);
  mock.close();
  await proxy.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\n--- app log ---\n' + appLog.slice(-6000)); process.exit(1); }
process.exit(0);
