// Food Hub screen relay agent, Android mode: watches ONE Android container (the platform's own Order Manager app,
// installed from the Play Store and signed in by the owner) through adb, and every 20 s tells Food Hub whether the
// app is in front, signed in, and how many of its notifications are waiting (a count, never their text).
//   - Reads only: device state, the package in front, the number of the app's notifications.
//   - Never taps, never types, never reads an order. "Reload" from Food Hub only brings the app back to the front.
//   - Never signs in: when the app's sign-in screen is in front, it reports "login" and the owner signs in.
// Settings (environment): FOODHUB_URL, FOODHUB_SCREENS_AGENT_TOKEN, SCREEN_ID, ANDROID_PACKAGE, ADB_HOST (127.0.0.1),
// ADB_PORT (5555), HEARTBEAT_SECONDS (20). Contract: docs/ORDER_SCREENS_RESCUE.md (heartbeat v2).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ADB_COMMANDS, countNotifications, decideReport, deviceOnline, parseFrontActivity } from './android-lib.mjs';

const run = promisify(execFile);
const env = (k, d = '') => (process.env[k] ?? d).trim();
const FOODHUB_URL = env('FOODHUB_URL').replace(/\/+$/, '');
const TOKEN = env('FOODHUB_SCREENS_AGENT_TOKEN');
const SCREEN_ID = env('SCREEN_ID');
const PACKAGE = env('ANDROID_PACKAGE');
const ADB_HOST = env('ADB_HOST', '127.0.0.1');
const ADB_PORT = env('ADB_PORT', '5555');
const EVERY_MS = Math.max(10, Number(env('HEARTBEAT_SECONDS', '20')) || 20) * 1000;
const VERSION = 'agent-android-1.0.0';

if (!FOODHUB_URL || !TOKEN || !SCREEN_ID || !PACKAGE) {
  console.error('Missing FOODHUB_URL, FOODHUB_SCREENS_AGENT_TOKEN, SCREEN_ID or ANDROID_PACKAGE.');
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(PACKAGE)) { console.error('ANDROID_PACKAGE is not a package name.'); process.exit(1); }

const target = `${ADB_HOST}:${ADB_PORT}`;
let autoReloads = 0;
let badChecks = 0;

async function adb(args, timeout = 8000) {
  const { stdout } = await run('adb', ['-s', target, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function connect() {
  try { await run('adb', ['connect', target], { timeout: 8000 }); } catch { /* reported as crashed below */ }
}

async function inspect() {
  try {
    const online = deviceOnline(await adb(ADB_COMMANDS.state).catch(() => ''));
    if (!online) { await connect(); return { online: false, front: null, notifications: 0 }; }
    const front = parseFrontActivity(await adb(ADB_COMMANDS.front));
    const notifications = countNotifications(await adb(ADB_COMMANDS.notifications, 12_000), PACKAGE);
    return { online: true, front, notifications };
  } catch (e) {
    return { online: false, front: null, notifications: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bring the order app back to the front. The only "action" this agent ever takes. */
async function toFront() {
  autoReloads++;
  try { await adb(ADB_COMMANDS.wake).catch(() => {}); await adb(ADB_COMMANDS.toFront(PACKAGE), 15_000); }
  catch (e) { console.error('to front failed:', e instanceof Error ? e.message : e); }
}

async function tick() {
  const r = await inspect();
  const report = decideReport({ id: SCREEN_ID, pkg: PACKAGE, online: r.online, front: r.front, notifications: r.notifications, autoReloads });
  badChecks = report.state === 'blank' ? badChecks + 1 : 0;
  if (badChecks >= 2) { await toFront(); badChecks = 0; }
  try {
    const res = await fetch(`${FOODHUB_URL}/api/foodhub/screens/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ version: VERSION, screens: [report] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`Food Hub answered ${res.status}: ${body.error ?? ''}`); return; }
    if (body.unknown?.includes(SCREEN_ID)) console.error(`Food Hub does not know screen ${SCREEN_ID}: add it in Stores → Platform screens.`);
    for (const c of body.commands ?? []) if (c.id === SCREEN_ID && c.kind === 'reload') await toFront();
  } catch (e) {
    console.error('heartbeat failed:', e instanceof Error ? e.message : e);
  }
}

console.log(`Screen agent ${VERSION} for ${SCREEN_ID} (${PACKAGE} on ${target}) → ${FOODHUB_URL} (every ${EVERY_MS / 1000} s)`);
await connect();
await tick();
setInterval(tick, EVERY_MS);
