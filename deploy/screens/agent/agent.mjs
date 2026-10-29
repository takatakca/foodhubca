// Food Hub screen relay agent: watches ONE platform screen (a Chromium signed in to Uber Eats Orders, DoorDash Order
// Manager…) through Chrome's debugging port, and every 20 s tells Food Hub whether it is up and still signed in.
//   - Reads only the page address and title. Never clicks, never reads orders, never types anything.
//   - Reloads the page by itself when it is blank or crashed two checks in a row, and when Food Hub asks ("Reload").
//   - Never signs in: when the platform shows its sign-in page, it reports "login" and the owner signs in in the screen.
// Settings (environment): see docs/PLATFORM_SCREENS.md.
import { chromium } from 'playwright-core';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const FOODHUB_URL = env('FOODHUB_URL').replace(/\/+$/, '');
const TOKEN = env('FOODHUB_SCREENS_AGENT_TOKEN');
const SCREEN_ID = env('SCREEN_ID');
const START_URL = env('SCREEN_START_URL');
const CDP_URL = env('CDP_URL', 'http://127.0.0.1:9222');
const EVERY_MS = Math.max(10, Number(env('HEARTBEAT_SECONDS', '20')) || 20) * 1000;
const VERSION = 'agent-1.0.0';

if (!FOODHUB_URL || !TOKEN || !SCREEN_ID) {
  console.error('Missing FOODHUB_URL, FOODHUB_SCREENS_AGENT_TOKEN or SCREEN_ID.');
  process.exit(1);
}

/** Sign-in pages of the platforms (address host or path). */
const LOGIN = [/(^|\.)auth\.uber\.com$/i, /(^|\.)identity\.doordash\.com$/i, /\/(login|signin|sign-in|log-in|auth)(\/|$|\?)/i];
const looksLikeLogin = (u) => { try { const x = new URL(u); return LOGIN.some((re) => re.test(x.hostname) || re.test(x.pathname)); } catch { return false; } };

let browser = null;
let autoReloads = 0;
let badChecks = 0;

async function page() {
  if (!browser || !browser.isConnected()) browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith('devtools://'));
  if (pages.length) return pages[0];
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const p = await ctx.newPage();
  if (START_URL) await p.goto(START_URL, { timeout: 30_000 }).catch(() => {});
  return p;
}

async function inspect() {
  try {
    const p = await page();
    const url = p.url();
    const title = await Promise.race([p.title(), new Promise((_, rej) => setTimeout(() => rej(new Error('page frozen')), 8000))]);
    if (!url || url === 'about:blank' || url.startsWith('chrome-error://')) return { p, state: url.startsWith('chrome-error://') ? 'crashed' : 'blank', url, title };
    return { p, state: looksLikeLogin(url) ? 'login' : 'ok', url, title };
  } catch (e) {
    browser = null; // reconnect next time
    return { p: null, state: 'crashed', url: null, title: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function recover(p) {
  autoReloads++;
  try {
    if (p && START_URL && !p.url().startsWith('http')) await p.goto(START_URL, { timeout: 30_000 });
    else if (p) await p.reload({ timeout: 30_000 });
  } catch (e) { console.error('reload failed:', e instanceof Error ? e.message : e); }
}

async function tick() {
  const r = await inspect();
  badChecks = r.state === 'crashed' || r.state === 'blank' ? badChecks + 1 : 0;
  if (badChecks >= 2) { await recover(r.p); badChecks = 0; }
  try {
    const res = await fetch(`${FOODHUB_URL}/api/foodhub/screens/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ version: VERSION, screens: [{ id: SCREEN_ID, state: r.state, title: r.title, url: r.url, autoReloads }] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`Food Hub answered ${res.status}: ${body.error ?? ''}`); return; }
    if (body.unknown?.includes(SCREEN_ID)) console.error(`Food Hub does not know screen ${SCREEN_ID}: add it in Stores → Platform screens.`);
    for (const c of body.commands ?? []) if (c.id === SCREEN_ID && c.kind === 'reload' && r.p) await r.p.reload({ timeout: 30_000 }).catch(() => {});
  } catch (e) {
    console.error('heartbeat failed:', e instanceof Error ? e.message : e);
  }
}

console.log(`Screen agent ${VERSION} for ${SCREEN_ID} → ${FOODHUB_URL} (every ${EVERY_MS / 1000} s)`);
await tick();
setInterval(tick, EVERY_MS);
