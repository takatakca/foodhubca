// Food Hub screen relay agent: watches ONE platform screen (a Chromium signed in to Uber Eats Orders, DoorDash Order
// Manager…) through Chrome's debugging port, and every 20 s tells Food Hub whether it is up and still signed in.
//   - Reads only the page address and title. Never clicks, never reads orders, never types anything.
//   - Reloads its tracked page when it goes blank or crashes, or when Food Hub asks ("Reload").
//   - Never signs in: when the platform shows its sign-in page, it reports "login" and the owner signs in in the screen.
// Settings (environment): see docs/PLATFORM_SCREENS.md.
import { chromium } from 'playwright-core';
import { allowedUrl, commandsFor, matchScreenPage } from './commands.mjs';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const FOODHUB_URL = env('FOODHUB_URL').replace(/\/+$/, '');
const TOKEN = env('FOODHUB_SCREENS_AGENT_TOKEN');
const SCREEN_ID = env('SCREEN_ID');
const START_URL = env('SCREEN_START_URL');
const CDP_URL = env('CDP_URL', 'http://127.0.0.1:9222');
const EVERY_MS = Math.max(10, Number(env('HEARTBEAT_SECONDS', '20')) || 20) * 1000;
const VERSION = 'agent-1.0.1';

if (!FOODHUB_URL || !TOKEN || !SCREEN_ID) {
  console.error('Missing FOODHUB_URL, FOODHUB_SCREENS_AGENT_TOKEN or SCREEN_ID.');
  process.exit(1);
}

let browser = null;
let targetUrl = START_URL;
let trackedPage = null;
let autoReloads = 0;
let badChecks = 0;

async function connection() {
  if (!browser || !browser.isConnected()) browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
  return browser;
}

const isBlank = (url) => !url || url === 'about:blank';
const isCrash = (url) => url.startsWith('chrome-error://');

async function inspect() {
  let p = null;
  try {
    const active = await connection();
    const pages = active.contexts().flatMap((context) => context.pages());
    const match = pages.flatMap((tab) => {
      const page = matchScreenPage(targetUrl, tab.url());
      return page ? [{ ...page, tab }] : [];
    }).sort((a, b) => b.priority - a.priority || Number(b.tab === trackedPage) - Number(a.tab === trackedPage))[0];
    if (!match) {
      const url = trackedPage && pages.includes(trackedPage) ? trackedPage.url() : null;
      p = url !== null && (isBlank(url) || isCrash(url)) ? trackedPage : null;
      return { p, state: url && isCrash(url) ? 'crashed' : 'blank', url: null, title: null };
    }
    p = trackedPage = match.tab;
    const url = p.url();
    const title = await Promise.race([p.title(), new Promise((_, rej) => setTimeout(() => rej(new Error('page frozen')), 8000))]);
    // If it navigated while getting the title, recheck on the next heartbeat.
    if (url !== p.url()) return { p: null, state: 'blank', url: null, title: null };
    return { p, state: match.state, url, title };
  } catch (e) {
    return { p, state: 'crashed', url: null, title: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function recover(p) {
  if (!p || p.isClosed()) return;
  const url = p.url();
  try {
    if (matchScreenPage(targetUrl, url)) {
      autoReloads++;
      await p.reload({ timeout: 30_000 });
    } else if ((isBlank(url) || isCrash(url)) && allowedUrl(targetUrl)) {
      autoReloads++;
      await p.goto(targetUrl, { timeout: 30_000 });
    }
  } catch (e) { console.error('reload failed:', e instanceof Error ? e.message : e); }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await report(); } finally { running = false; }
}

async function report() {
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
    // reload, or open a platform's page (its sign-in page): the only two things Food Hub can ask. Nothing is clicked.
    let commandPage = r.p;
    for (const c of commandsFor(body, SCREEN_ID)) {
      if (c.kind === 'refused') { console.error(c.reason); continue; }
      const current = commandPage && !commandPage.isClosed() && matchScreenPage(targetUrl, commandPage.url()) ? commandPage : null;
      if (c.kind === 'reload') {
        if (current) await current.reload({ timeout: 30_000 }).catch(() => {});
      } else {
        // Never replace an unrelated tab. An explicit mode switch can open its own tab in the existing profile.
        const context = (await connection()).contexts()[0];
        commandPage = current ?? (await context?.newPage());
        if (!commandPage) continue;
        trackedPage = commandPage;
        targetUrl = c.url;
        await commandPage.goto(c.url, { timeout: 30_000 }).catch((e) => console.error('open failed:', e instanceof Error ? e.message : e));
      }
    }
  } catch (e) {
    console.error('heartbeat failed:', e instanceof Error ? e.message : e);
  }
}

console.log(`Screen agent ${VERSION} for ${SCREEN_ID} → ${FOODHUB_URL} (every ${EVERY_MS / 1000} s)`);
await tick();
setInterval(tick, EVERY_MS);
