// Automated accessibility check (docs/ACCESSIBILITY.md) — MASTER PLAN Phase 3 "Lighthouse accessibility >= 95".
//
// Starts the BUILT app the way scripts/foodhub-e2e.mjs does (`next start`, memory mode, every platform pointed at a
// local stand-in, owner password), signs in as the owner, then opens the key pages with Playwright + axe-core at phone
// (375×812) and desktop (1280×800) size. Rules: WCAG 2.0 / 2.1, levels A and AA.
//   - any serious or critical violation → exit 1 (each one printed with the elements it was found on);
//   - moderate and minor ones are printed, they do not fail the run.
// Then reduced motion: with prefers-reduced-motion: reduce, no CSS animation may still be running on those pages,
// except the new-order alert (data-motion="alarm", components/live/incoming.tsx), which must keep ringing.
// FOODHUB_A11Y_PAGES=alert,kitchen checks only the page states whose name holds one of those words (quicker while fixing).
//
// Needs a build first (`npm run build` or `npx next build --webpack`) and Chromium: `npx playwright install --only-shell chromium`.
// Ports: FOODHUB_A11Y_MOCK_PORT / FOODHUB_A11Y_APP_PORT (default 4797 / 4798; else FOODHUB_E2E_MOCK_PORT / _APP_PORT).
// Nothing leaves the machine: the platforms, Clover, texts and e-mails all answer from the local stand-in below.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const MOCK_PORT = Number(process.env.FOODHUB_A11Y_MOCK_PORT || process.env.FOODHUB_E2E_MOCK_PORT) || 4797;
const APP_PORT = Number(process.env.FOODHUB_A11Y_APP_PORT || process.env.FOODHUB_E2E_APP_PORT) || 4798;
const APP = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const PASSWORD = 'a11y-dashboard-pass';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/** Optional: also list axe's best-practice findings (landmarks, heading order…) as notes; they never fail the run. */
const BEST_PRACTICE = process.env.FOODHUB_A11Y_BEST_PRACTICE === '1';
/** Optional: only the page states whose name contains one of these words (comma-separated), e.g. "alert,kitchen". */
const ONLY = (process.env.FOODHUB_A11Y_PAGES || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
const picked = (pages) => (ONLY.length ? pages.filter((pg) => ONLY.some((w) => pg.name.toLowerCase().includes(w))) : pages);
/** Optional: a folder where a full-page screenshot of every scan is saved (to see what was checked). */
const SHOTS = process.env.FOODHUB_A11Y_SCREENSHOTS ? path.resolve(process.env.FOODHUB_A11Y_SCREENSHOTS) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const FAIL_IMPACTS = new Set(['serious', 'critical']);
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];
/** Made-up menu of the ordering page (no real ids). Brand taken from the seed catalog (data/actual/brands.json). */
const BRAND = 'Pi Pita';
const A11Y_MENU = {
  brandName: BRAND,
  categories: [
    { ref: 'a11y-mains', name: 'Mains', nameFr: 'Plats', sortOrder: 1 },
    { ref: 'a11y-drinks', name: 'Drinks', nameFr: 'Boissons', sortOrder: 2 },
  ],
  items: [
    { ref: 'a11y-pita', name: 'Chicken pita', nameFr: 'Pita au poulet', description: 'Grilled chicken, garlic sauce', descriptionFr: 'Poulet grillé, sauce à l’ail', price: 12.5, categoryRef: 'a11y-mains', available: true, allergens: ['wheat'], modifierGroupRefs: ['a11y-size', 'a11y-extra'] },
    { ref: 'a11y-plate', name: 'Shish plate', nameFr: 'Assiette shish', price: 18, categoryRef: 'a11y-mains', available: true, modifierGroupRefs: [] },
    { ref: 'a11y-juice', name: 'Juice', nameFr: 'Jus', price: 3, categoryRef: 'a11y-drinks', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'a11y-size', name: 'Size', nameFr: 'Format', min: 1, max: 1, modifiers: [
      { ref: 'a11y-reg', name: 'Regular', nameFr: 'Régulier', price: 0, available: true },
      { ref: 'a11y-lg', name: 'Large', nameFr: 'Grand', price: 3, available: true },
    ] },
    { ref: 'a11y-extra', name: 'Extras', nameFr: 'Extras', min: 0, max: 2, modifiers: [
      { ref: 'a11y-cheese', name: 'Cheese', nameFr: 'Fromage', price: 1, available: true },
      { ref: 'a11y-garlic', name: 'Garlic sauce', nameFr: 'Sauce à l’ail', price: 0.5, available: true },
    ] },
  ],
};

// ---------------- local stand-in for every outside service (platforms, Clover, Twilio, Resend…) ----------------
const outside = [];
const mock = http.createServer(async (req, res) => {
  for await (const _chunk of req) { /* drain */ }
  const p = new URL(req.url, MOCK).pathname;
  outside.push(`${req.method} ${p}`);
  const body = p.startsWith('/clover/') ? { elements: [] } : p.startsWith('/twilio/') ? { sid: 'SM_a11y', status: 'queued' } : p.startsWith('/resend/') ? { id: 're_a11y' } : {};
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});

// ---------------- helpers ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
const basic = `Basic ${Buffer.from(`owner:${PASSWORD}`).toString('base64')}`;
async function call(method, p, { body, auth = true, headers = {} } = {}) {
  const res = await fetch(`${APP}${p}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: basic } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
}

// ---------------- start the app (same way as scripts/foodhub-e2e.mjs) ----------------
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(APP_PORT),
  FOODHUB_FORCE_MEMORY: 'true',
  FOODHUB_PUBLIC_URL: `http://127.0.0.1:${APP_PORT}`, // http: the session cookie is not "Secure", so the browser keeps it on 127.0.0.1
  FOODHUB_TIMEZONE: 'America/Toronto',
  LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
  DASHBOARD_PASSWORD: PASSWORD,
  CRON_SECRET: 'cron-a11y',
  UBER_BASE_URL: `${MOCK}/uber`, UBER_AUTH_URL: `${MOCK}/uber/oauth/v2/token`, UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-client-secret-a11y', UBER_WEBHOOK_SIGNING_KEY: 'uber-signing-key-a11y',
  DOORDASH_BASE_URL: `${MOCK}/dd`, DOORDASH_DEVELOPER_ID: 'dd-dev-a11y', DOORDASH_KEY_ID: 'dd-key-a11y', DOORDASH_SIGNING_SECRET: Buffer.from('doordash-signing-secret-a11y-32b!').toString('base64'), DOORDASH_PROVIDER_TYPE: 'takatak_a11y', DOORDASH_WEBHOOK_SECRET: 'dd-hook-a11y',
  SKIP_JET_BASE_URL: `${MOCK}/skip`, SKIP_JET_API_KEY: 'jet-api-key-a11y', SKIP_WEBHOOK_HMAC_SECRET: 'skip-hmac-a11y', SKIP_WEBHOOK_API_KEY: 'skip-notify-a11y',
  CLOVER_BASE_URL: `${MOCK}/clover`, CLOVER_MERCHANT_ID: 'MAINMERCHANT', CLOVER_ACCESS_TOKEN: 'clover-token-a11y',
  FOODHUB_MEDIA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fh-a11y-media-')),
  RESEND_API_KEY: 're_a11y', REPORT_EMAIL_FROM: 'TAKATAK Reports <reports@takatak.example>', RESEND_BASE_URL: `${MOCK}/resend`,
  AUTH_EMAIL_FROM: 'TAKATAK <connexion@takatak.example>',
  TWILIO_ACCOUNT_SID: 'AC_a11y', TWILIO_AUTH_TOKEN: 'tw-a11y', TWILIO_FROM: '+15140000000', TWILIO_BASE_URL: `${MOCK}/twilio`,
  ALERT_WEBHOOK_URL: `${MOCK}/chat`,
  FOODHUB_WATCH_INTERVAL_S: '0', // no background Watchtower: the pages are scanned in a steady state
};
// Same clean slate as the e2e: nothing from the developer's own .env may change what the pages show.
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UBER_ACCESS_TOKEN', 'TGTG_SPEC_CONFIRMED', 'SESSION_SECRET', 'FOODHUB_CLOVER_AUTOPRINT', 'CLOVER_PRINT_DEVICE_ID', 'FOODHUB_SYNC_MIN_INTERVAL_S', 'FOODHUB_CLOVER_RECORD_PAYMENT', 'FOODHUB_CLOVER_ORDER_TYPES', 'FOODHUB_CLOVER_INVENTORY_SYNC', 'FOODHUB_CLOVER_DELETE_CANCELLED', 'FOODHUB_SCHEDULED_AFTER_MIN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'FOODHUB_INSECURE_SHOW_CODES', 'TWILIO_MESSAGING_SERVICE_SID', 'FOODHUB_OWNER_EMAIL', 'FOODHUB_OWNER_PHONE', 'FOODHUB_FEATURE_DELIVERY', 'FOODHUB_FEATURE_RETAIL', 'FOODHUB_FEATURE_ALCOHOL', 'FOODHUB_FEATURE_PHONE', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_ORDER_TYPES', 'FOODHUB_CLOVER_WEBSITE_POLL_S', 'FOODHUB_CLOVER_WEBSITE_CLOSE_MIN', 'FOODHUB_PUBLIC_HOME', 'FOODHUB_APP_MARKET_URL', 'FOODHUB_APP_MARKET_STATUS', 'FOODHUB_PUBLIC_LIVE_PLATFORMS', 'FOODHUB_PUBLIC_SAME_AS', 'NEXT_PUBLIC_CLOVER_APPS_LIVE', 'FOODHUB_FEATURE_MEV', 'FOODHUB_MEV', 'FOODHUB_MEV_TRIGGER', 'FOODHUB_MEV_CLOVER_NOTE', 'FOODHUB_MEV_SEND_RECEIPT', 'FOODHUB_MEV_USER', 'FOODHUB_MEV_TIMEOUT_MS', 'FOODHUB_TENANT_ID', 'FOODHUB_FEATURE_STOREFRONT', 'FOODHUB_TRUST_PROXY', 'VERCEL_URL']) delete env[k];

if (!fs.existsSync(path.join('.next', 'BUILD_ID'))) {
  console.error('No build found: run `npm run build` (or `npx next build --webpack`) first.');
  mock.close();
  process.exit(1);
}
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });
const up = await waitFor(async () => { try { return (await fetch(`${APP}/api/foodhub/channels`)).status > 0; } catch { return false; } }, 30000);
if (!up) { console.error('App did not start.\n', appLog); app.kill('SIGTERM'); mock.close(); process.exit(1); }

let browser;
let exitCode = 0;
const problems = [];
try {
  // ---------------- seed: an ordering page that is open, and one new order in the kitchen ----------------
  console.log('Seed');
  const menu = await call('PUT', '/api/foodhub/menu', { body: { menu: A11Y_MENU } });
  if (menu.json?.ok !== true) throw new Error(`menu not saved: ${menu.status} ${menu.text.slice(0, 200)}`);
  const allDay = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open: '00:00', close: '23:59' }]]));
  const hours = await call('PUT', '/api/foodhub/hours', { body: { hours: { locations: { NDG_MAIN: allDay, NDG_6284: allDay, HOCHELAGA: allDay, SAINT_LEONARD: allDay }, brands: {}, holidays: [] } } });
  if (hours.status !== 200) throw new Error(`hours not saved: ${hours.status} ${hours.text.slice(0, 200)}`);
  const sf = await call('GET', '/api/foodhub/storefront/settings');
  const brand = sf.json?.brands?.find((b) => b.name === BRAND);
  if (!brand) throw new Error(`storefront settings: ${BRAND} missing (${sf.status})`);
  const save = await call('PUT', '/api/foodhub/storefront/settings', { body: { enabled: true, brands: { [BRAND]: { enabled: true, slug: brand.slug, locationCode: brand.locationCode, payOnline: false, payAtPickup: true, pickupMaxTotal: brand.pickupMaxTotal } } } });
  if (save.status !== 200) throw new Error(`storefront not switched on: ${save.status} ${save.text.slice(0, 200)}`);
  const slug = brand.slug;
  const order = await call('POST', '/api/storefront/checkout', { auth: false, headers: { origin: APP }, body: { slug, lang: 'fr', pay: 'pickup', customer: { name: 'Test Accessibilité', phone: '+15145550100' }, lines: [{ ref: 'a11y-pita', qty: 1, options: [{ group: 'a11y-size', ref: 'a11y-reg' }] }] } });
  console.log(`  ordering page /commander/${slug} open; test order ${order.json?.ok ? `#${order.json.number} placed` : `not placed (${order.status} ${order.text.slice(0, 120)})`}`);

  const PAGES = [
    { name: 'Sign-in', path: '/login', who: 'anon' },
    { name: 'Tablet app (/tablette)', path: '/tablette', who: 'anon' },
    { name: `Ordering page (/commander/${slug})`, path: `/commander/${slug}`, who: 'anon' },
    { name: 'Welcome dialog (first sign-in)', path: '/', who: 'first', dialog: true },
    { name: 'Console overview', path: '/', who: 'owner' },
    { name: 'Orders board', path: '/orders', who: 'owner' },
    { name: 'Kitchen (dark theme)', path: '/kitchen', who: 'owner', kitchen: true },
    { name: 'Go-live', path: '/settings/go-live', who: 'owner' },
    { name: 'Settings → Autopilot', path: '/settings/autopilot', who: 'owner' },
  ];

  browser = await chromium.launch();
  /**
   * A browser context: 'anon', or signed in as the owner (recovery sign-in → HttpOnly session cookie). 'owner' has
   * already met TakTak (the everyday console); 'first' is the owner's very first sign-in, with the welcome dialog open.
   */
  async function newContext(who, opts) {
    const ctx = await browser.newContext({ locale: 'fr-CA', timezoneId: 'America/Toronto', ...opts });
    if (who !== 'anon') {
      const r = await ctx.request.post(`${APP}/api/foodhub/auth/login`, { data: { username: 'owner', password: PASSWORD } });
      if (!r.ok()) throw new Error(`owner sign-in failed: ${r.status()}`);
    }
    // components/help/help-provider.tsx keeps "welcome seen" per person in localStorage.
    if (who === 'owner') await ctx.addInitScript(() => { try { localStorage.setItem('takatak.help.v1:owner', JSON.stringify({ welcomed: true, seen: [], toursDone: [] })); } catch { /* private mode */ } });
    return ctx;
  }
  /** One context per kind of visitor, made on first use. */
  function contexts(opts) {
    const made = {};
    return {
      for: async (who) => (made[who] ??= await newContext(who, opts)),
      close: async () => { for (const c of Object.values(made)) await c.close(); },
    };
  }
  /** Open a page and wait until it has settled: data loaded, entrance animations over (no half-faded text for contrast). */
  async function open(ctx, pg) {
    const page = await ctx.newPage();
    const res = await page.goto(`${APP}${pg.path}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 3000)),
    ]));
    await page.waitForTimeout(250);
    const landed = new URL(page.url()).pathname;
    if (!res || res.status() >= 400) problems.push(`${pg.name}: HTTP ${res?.status()}`);
    else if (landed !== pg.path) problems.push(`${pg.name}: landed on ${landed} instead of ${pg.path}`);
    if (pg.kitchen && !(await page.evaluate(() => document.documentElement.classList.contains('theme-kitchen')))) problems.push(`${pg.name}: the kitchen theme is not applied`);
    if (pg.dialog && !(await page.locator('[role="dialog"], [role="alertdialog"]').first().isVisible().catch(() => false))) problems.push(`${pg.name}: no dialog open`);
    return page;
  }
  /** CSS / script animations still running (transitions excluded), and whether each one is the new-order alert. */
  const runningAnimations = (page) => page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running' && !(typeof CSSTransition !== 'undefined' && a instanceof CSSTransition))
    .map((a) => {
      const el = a.effect?.target;
      const node = el instanceof Element ? el : null;
      const desc = node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}` : '(no element)';
      // Only the alarm element itself (its ringing frame), never what sits inside it.
      return { name: a.animationName || a.id || 'animation', desc, alarm: node?.getAttribute('data-motion') === 'alarm' };
    }));

  // ---------------- axe-core scans ----------------
  const results = []; // { page, viewport, counts, failing }
  async function scanAll(pages) {
  for (const vp of VIEWPORTS) {
    const ctx = contexts({ viewport: { width: vp.width, height: vp.height } });
    for (const pg of pages) {
      const page = await open(await ctx.for(pg.who), pg);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${vp.name}-${pg.who}${pg.path.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
      const moving = (await runningAnimations(page)).length; // context for the reduced-motion pass below
      const scan = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of scan.violations) counts[v.impact ?? 'minor'] += 1;
      const failing = scan.violations.filter((v) => FAIL_IMPACTS.has(v.impact));
      const shown = scan.violations.filter((v) => v.impact === 'moderate');
      console.log(`\n${pg.name} · ${vp.name} ${vp.width}×${vp.height} — critical ${counts.critical} · serious ${counts.serious} · moderate ${counts.moderate} · minor ${counts.minor}${moving ? ` (${moving} animation${moving > 1 ? 's' : ''} running with normal motion)` : ''}`);
      for (const v of [...failing, ...shown]) {
        console.log(`  ${FAIL_IMPACTS.has(v.impact) ? 'FAIL' : 'note'}  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element${v.nodes.length > 1 ? 's' : ''}) ${v.helpUrl}`);
        for (const n of v.nodes.slice(0, 6)) {
          const why = (n.failureSummary || '').split('\n').slice(1, 2).join(' ').trim();
          console.log(`        ${n.target.join(' ')}${why ? ` — ${why}` : ''}`);
        }
        if (v.nodes.length > 6) console.log(`        … and ${v.nodes.length - 6} more`);
      }
      if (BEST_PRACTICE) {
        const bp = await new AxeBuilder({ page }).withTags(['best-practice']).analyze();
        for (const v of bp.violations) console.log(`  note  [best practice · ${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      }
      results.push({ page: pg.name, viewport: vp.name, counts, failing: failing.length });
      await page.close();
    }
    await ctx.close();
  }
  }
  await scanAll(picked(PAGES));

  // ---------------- a new platform order: the alert pops up over the console ----------------
  // A made-up DoorDash store of the test brand (never a real store id), then one order on it. Clover is the local
  // stand-in, so the order stays "new": the pop-up with Accept / Refuse and its ringing frame (the new-order alert).
  const ddStore = await call('POST', '/api/foodhub/stores', { body: { channel: 'doordash', channelStoreId: 'a11y-dd-store', brandName: BRAND, locationCode: brand.locationCode } });
  const ddOrder = await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-a11y' }, body: { id: 'a11y-dd-order-1', store: { merchant_supplied_id: 'a11y-dd-store' }, consumer: { first_name: 'Test', last_name: 'A.' }, subtotal: 1250, tax: 187, categories: [{ name: 'Plats', items: [{ name: 'Pita au poulet', quantity: 1, price: 1250, merchant_supplied_id: 'a11y-pita', extras: [] }] }] } });
  const alertUp = ddStore.json?.store && ddOrder.status < 300 && await waitFor(async () => ((await call('GET', '/api/foodhub/orders?limit=50')).json?.orders ?? []).some((o) => o.externalOrderId === 'a11y-dd-order-1'), 10000);
  console.log(`
New DoorDash order on a test store: ${alertUp ? 'received' : `NOT received (store ${ddStore.status}, webhook ${ddOrder.status} ${ddOrder.text.slice(0, 120)})`}`);
  if (!alertUp) problems.push('the test platform order did not arrive: the new-order alert was not checked');
  const ALERT_PAGES = [
    { name: 'New-order alert · kitchen', path: '/kitchen', who: 'owner', kitchen: true, dialog: true },
    { name: 'New-order alert · orders board', path: '/orders', who: 'owner', dialog: true },
  ];
  if (alertUp) await scanAll(picked(ALERT_PAGES));

  // ---------------- reduced motion ----------------
  console.log('\nReduced motion (prefers-reduced-motion: reduce): no running CSS animation except the new-order alert, which keeps ringing');
  const motion = [];
  {
    const vp = VIEWPORTS[1];
    const ctx = contexts({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' });
    for (const pg of picked(alertUp ? [...PAGES, ...ALERT_PAGES] : PAGES)) {
      const page = await open(await ctx.for(pg.who), pg);
      await page.waitForTimeout(500);
      const running = await runningAnimations(page);
      const bad = running.filter((a) => !a.alarm);
      const alarm = running.length - bad.length;
      // On the new-order alert (desktop size: the ring is `sm:animate-ring`) the alarm itself must still ring: an alarm is
      // not decoration (app/globals.css, the one exception to the reduced-motion rule).
      const silenced = ALERT_PAGES.includes(pg) && alarm === 0;
      motion.push({ page: pg.name, bad: bad.length + (silenced ? 1 : 0), alarm });
      console.log(`  ${bad.length || silenced ? 'FAIL' : 'PASS'}  ${pg.name}${alarm ? ' (new-order alert still ringing: expected)' : ''}${silenced ? ' — the new-order alert stopped ringing' : ''}`);
      for (const a of bad.slice(0, 8)) console.log(`        ${a.name} on ${a.desc}`);
      await page.close();
    }
    await ctx.close();
  }

  // ---------------- summary ----------------
  console.log('\nSummary (violations = axe rules broken on the page; WCAG 2.1 A/AA)');
  console.log('  page                                     | viewport | critical | serious | moderate | minor');
  for (const r of results) console.log(`  ${r.page.padEnd(40).slice(0, 40)} | ${r.viewport.padEnd(8)} | ${String(r.counts.critical).padStart(8)} | ${String(r.counts.serious).padStart(7)} | ${String(r.counts.moderate).padStart(8)} | ${String(r.counts.minor).padStart(5)}`);
  const failingScans = results.filter((r) => r.failing > 0);
  const motionFails = motion.filter((m) => m.bad > 0);
  for (const p of problems) console.log(`  FAIL  ${p}`);
  if (failingScans.length || motionFails.length || problems.length) {
    exitCode = 1;
    console.log(`\nAccessibility check FAILED: ${failingScans.length} page scan(s) with serious/critical violations, ${motionFails.length} page(s) still animating with reduced motion, ${problems.length} page problem(s).`);
  } else {
    console.log(`\nAccessibility check passed: ${results.length} scans (${results.length / VIEWPORTS.length} page states × ${VIEWPORTS.length} sizes), 0 serious/critical violations; reduced motion respected on ${motion.length} pages.`);
  }
  console.log(`(${outside.length} calls answered by the local stand-in; nothing left the machine.)`);
} catch (e) {
  exitCode = 1;
  console.error(`\nAccessibility check could not run: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  console.error(`\n--- app log ---\n${appLog.slice(-4000)}`);
} finally {
  await browser?.close().catch(() => {});
  app.kill('SIGTERM');
  mock.close();
}
process.exit(exitCode);
