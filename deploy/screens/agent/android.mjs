// Food Hub screen relay agent, Android mode: watches ONE Android container (the platform's own Order Manager app,
// installed from the Play Store and signed in by the owner) through adb, and every 20 s tells Food Hub whether the
// app is in front, signed in, and how many of its notifications are waiting (a count, never their text).
//   - Reads only: device state, the package in front, the number of the app's notifications.
//   - Never taps, never types, never reads an order. "Reload" from Food Hub only brings the app back to the front;
//     "open" (a platform's address, when the owner switches the screen's channel) launches that platform's order app.
//   - Never signs in: when the app's sign-in screen is in front, it reports "login" and the owner signs in.
// Settings (environment): FOODHUB_URL, FOODHUB_SCREENS_AGENT_TOKEN, SCREEN_ID, ANDROID_PACKAGE, ADB_HOST (127.0.0.1),
// ADB_PORT (5555), HEARTBEAT_SECONDS (20). Contract: docs/ORDER_SCREENS_RESCUE.md (heartbeat v2).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ADB_COMMANDS, decideReport, deviceOnline, parseCount, parseFrontActivity } from './android-lib.mjs';
import { commandsFor, packageForUrl } from './commands.mjs';

const run = promisify(execFile);

/** The adb client: ADB_PATH, else the first "adb" (or adb.exe / adb.cmd on Windows) found on PATH. */
function findAdb() {
  const given = (process.env.ADB_PATH ?? '').trim();
  if (given) return given;
  const names = process.platform === 'win32' ? ['adb.exe', 'adb.cmd', 'adb.bat', 'adb'] : ['adb'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) { const p = path.join(dir, n); if (existsSync(p)) return p; }
  }
  return 'adb';
}
const ADB = findAdb();
// A .cmd/.bat shim (Windows) must run through cmd.exe, but WITHOUT shell:true: that would let cmd.exe interpret the
// `| grep … || true` of the on-device count as a host pipeline. Quote each argument and pass them verbatim instead.
const IS_SHIM = /\.(cmd|bat)$/i.test(ADB);
const winQuote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
function adbInvocation(args) {
  if (!IS_SHIM) return [ADB, args, {}];
  return ['cmd.exe', ['/d', '/s', '/c', `"${[winQuote(ADB), ...args.map(winQuote)].join(' ')}"`], { windowsVerbatimArguments: true }];
}
const env = (k, d = '') => (process.env[k] ?? d).trim();
const FOODHUB_URL = env('FOODHUB_URL').replace(/\/+$/, '');
const TOKEN = env('FOODHUB_SCREENS_AGENT_TOKEN');
const SCREEN_ID = env('SCREEN_ID');
// The order app this screen watches; an "open" from Food Hub (channel switched) moves it to that platform's app.
let PACKAGE = env('ANDROID_PACKAGE');
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
  const [file, argv, opts] = adbInvocation(['-s', target, ...args]);
  const { stdout } = await run(file, argv, { ...opts, timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function connect() {
  const [file, argv, opts] = adbInvocation(['connect', target]);
  try { await run(file, argv, { ...opts, timeout: 8000 }); } catch { /* reported as crashed below */ }
}

async function inspect() {
  const online = deviceOnline(await adb(ADB_COMMANDS.state).catch(() => ''));
  if (!online) { await connect(); return { online: false, front: null, notifications: 0 }; }
  let front = null, notifications = NaN;
  try { front = parseFrontActivity(await adb(ADB_COMMANDS.front)); }
  catch (e) { return { online: false, front: null, notifications: 0, error: e instanceof Error ? e.message : String(e) }; }
  // A failed count alone never turns a fine device into "crashed": the report keeps front/online, waiting becomes 0.
  try { notifications = parseCount(await adb(ADB_COMMANDS.notificationCount(PACKAGE), 12_000)); }
  catch (e) { console.error('notification count failed:', e instanceof Error ? e.message : e); }
  return { online: true, front, notifications };
}

/** Bring the order app back to the front. The only "action" this agent ever takes. */
async function toFront() {
  autoReloads++;
  try { await adb(ADB_COMMANDS.wake).catch(() => {}); await adb(ADB_COMMANDS.toFront(PACKAGE), 15_000); }
  catch (e) { console.error('to front failed:', e instanceof Error ? e.message : e); }
}

let busy = false;
/** One check at a time: a hung adb must not pile up ticks, duplicate heartbeats or inflate autoReloads. */
async function tick() {
  if (busy) return;
  busy = true;
  try { await check(); } finally { busy = false; }
}

async function check() {
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
    for (const c of commandsFor(body, SCREEN_ID)) {
      if (c.kind === 'refused') { console.error(c.reason); continue; }
      if (c.kind === 'open') {
        const pkg = packageForUrl(c.url);
        if (!pkg) { console.error('open: no order app for', c.url); continue; }
        if (pkg !== PACKAGE) console.log(`Channel switched: ${PACKAGE} → ${pkg}`);
        PACKAGE = pkg;
      }
      await toFront();
    }
  } catch (e) {
    console.error('heartbeat failed:', e instanceof Error ? e.message : e);
  }
}

console.log(`Screen agent ${VERSION} for ${SCREEN_ID} (${PACKAGE} on ${target}, adb: ${ADB}) → ${FOODHUB_URL} (every ${EVERY_MS / 1000} s)`);
await connect();
await tick();
setInterval(tick, EVERY_MS);
