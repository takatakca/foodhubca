#!/usr/bin/env node
// Promo reels: short product clips (10, 15 or 20 s) of the real Food Hub console, recorded from the LOCAL demo build,
// for Facebook / Instagram reels (docs/PROMO_REELS.md). Nothing is posted or uploaded anywhere.
//
// Starts the BUILT app the way scripts/a11y-check.mjs and scripts/foodhub-e2e.mjs do (`next start`, memory mode, every
// platform, Clover, e-mail and text service pointed at a local stand-in), seeds made-up demo data only (first name +
// initial customers, 555 phone numbers, .test e-mails, demo store ids), then drives each screen with Playwright and
// records it with `recordVideo` (1080×1920 vertical, plus 1920×1080 landscape for the main shots). ffmpeg then trims
// each take to its exact length and writes H.264 MP4 at 30 fps, no audio, plus a poster PNG.
//
// Guards: the browser may only reach 127.0.0.1 (every other request is aborted), and every take is refused when the
// page text shows a protected or real-looking value (Po Poulet, a real platform store id from data/actual, a phone
// number outside 555, a gmail / takatak.ca / on2go address).
//
// Run:  npx next build --webpack && node scripts/promo-reels.mjs [--only kitchen,wall] [--vertical-only] [--out <dir>] [--serve]
//   --only     comma-separated shot keys (see SHOTS below); default: all
//   --out      output folder (default private/video/reels, git-ignored)
//   --serve    seed, print the address and keep running (to look around); no recording
//   --keep-raw keep the raw .webm takes next to the clips
//   --no-cuts  record only, do not cut the 5–8 s moments (CUTS in promo-reels-shots.mjs)
//   --cuts-only  no server, no recording: cut the 5–8 s moments again from the clips already in --out
// Names: <NNN>-<theme>-<seconds>s-<vertical|square|landscape>.mp4 (001–0xx clips, 101+ short cuts) + a poster .png each.
// Ports: FOODHUB_REELS_MOCK_PORT / FOODHUB_REELS_APP_PORT (default 5901 / 5902).
// ffmpeg: FFMPEG=<path>, else `ffmpeg` on PATH, else the ffmpeg-static package if it is installed (npm i --no-save ffmpeg-static@5.2.0).
// Chromium: `npx playwright install --only-shell chromium` once.
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const MOCK_PORT = Number(process.env.FOODHUB_REELS_MOCK_PORT) || 5901;
const APP_PORT = Number(process.env.FOODHUB_REELS_APP_PORT) || 5902;
const APP = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const OUT = path.resolve(opt('out') || process.env.FOODHUB_REELS_OUT || 'private/video/reels');
const ONLY = (opt('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const SERVE = flag('serve');
const KEEP_RAW = flag('keep-raw');
const VERTICAL_ONLY = flag('vertical-only');
const NO_CUTS = flag('no-cuts');
if (flag('cuts-only')) {
  const ff = resolveFfmpeg();
  if (!ff) { console.error('ffmpeg not found: set FFMPEG=<path>, put ffmpeg on PATH, or `npm i --no-save ffmpeg-static@5.2.0`.'); process.exit(1); }
  const { makeCuts, writeIndex } = await import('./promo-reels-shots.mjs');
  makeCuts({ FF: ff, ffmpeg, OUT, only: ONLY });
  console.log(`${writeIndex(OUT).length} file(s) listed in ${path.join(OUT, 'clips.json')}`);
  process.exit(0);
}
/**
 * The demo clock: a fixed-offset zone where it is about FOODHUB_REELS_HOUR (default 18 h, dinner service) right now, so the
 * kitchen clock and the order times show a normal service hour whatever time the recording runs. App and browser share it.
 */
const TZ = (() => {
  const want = Number(process.env.FOODHUB_REELS_HOUR ?? 18);
  let off = want - new Date().getUTCHours();
  if (off > 14) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? 'Etc/UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`; // Etc/GMT-10 = UTC+10
})();
const OWNER_EMAIL = 'proprietaire@demo-restaurant.test';

// ---------------- throwaway secrets for the local run (never real) ----------------
const PASSWORD = 'reels-demo-pass';
const UBER_SECRET = 'uber-client-secret-reels';
const DD_HOOK = 'dd-hook-reels';
const SKIP_HMAC = 'skip-hmac-reels';
const SCREENS_TOKEN = 'screens-agent-reels-token-0123456789';
const CLOVER_TOKEN = 'clover-token-reels';

// ---------------- what the takes may never show ----------------
const FORBIDDEN = [];
{
  // Real platform store ids from the seed files, plus Po Poulet NDG's DoorDash store.
  const ids = new Set(['27982486']);
  for (const f of ['data/actual/platform-stores-uber.json', 'data/actual/platform-stores-doordash.json']) {
    try {
      const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/store_id|business_id|^id$/i.test(k) && typeof x === 'string' && x.length >= 6) ids.add(x); walk(x); }
      };
      walk(JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch { /* file missing: fine */ }
  }
  for (const id of ids) FORBIDDEN.push({ why: `real store id ${id.slice(0, 4)}…`, re: new RegExp(id.replace(/[-]/g, '\\-')) });
  FORBIDDEN.push({ why: 'Po Poulet', re: /po\s*poulet/i });
  FORBIDDEN.push({ why: 'real e-mail domain', re: /@(gmail|hotmail|outlook|yahoo|takatak\.ca|on2go\.ca)\b/i });
}
/** A North American phone number whose exchange is not 555 (555-01xx is the range kept for fiction). */
const REAL_PHONE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-](\d{3})[\s.-](\d{4})\b/g;
function forbiddenIn(text) {
  const hits = FORBIDDEN.filter((f) => f.re.test(text)).map((f) => f.why);
  for (const m of text.matchAll(REAL_PHONE)) if (m[2] !== '555') hits.push(`phone number ${m[1]}-${m[2]}-…`);
  return hits;
}

// ---------------- made-up demo data ----------------
const HIDE_BRANDS = ['Po Poulet'];
/** Brand kit accents (made up for the demo; the owner sets the real ones in Settings → Business). */
const ACCENTS = {
  // Hues away from the status colours (late red, waiting amber, ready green), as the brand kit asks. Cafe Bolon gets
  // its colour on camera (shot "brand-kit").
  'Pi Pita': '#00838f', 'PPP Pizzeria': '#3949ab', OOeuf: '#512da8', 'Nutrition Shake': '#0277bd', 'OCRÊPE': '#7b1fa2',
  'Gateau Montreal': '#ad1457', 'Mythos 2 Go': '#1565c0', 'Taco Mexican': '#455a64', 'Place Afrique': '#00695c',
  'Pita Libanais': '#283593', 'Pizza Inntime': '#880e4f',
};
/** Demo store mapping: [channel, demo store id, brand, kitchen, autoAccept]. Ids are obviously fake. */
const STORES = [
  ['uber_eats', 'demo-uber-pipita', 'Pi Pita', 'SAINT_LEONARD', true],
  ['doordash', 'demo-dd-pipita', 'Pi Pita', 'SAINT_LEONARD', true],
  ['skip', 'DEMO-SKIP-PIPITA', 'Pi Pita', 'SAINT_LEONARD', true],
  ['uber_eats', 'demo-uber-ppp', 'PPP Pizzeria', 'NDG_6284', true],
  ['doordash', 'demo-dd-ppp', 'PPP Pizzeria', 'NDG_6284', true],
  ['uber_eats', 'demo-uber-ooeuf', 'OOeuf', 'NDG_MAIN', true],
  ['skip', 'DEMO-SKIP-OOEUF', 'OOeuf', 'NDG_MAIN', true],
  ['doordash', 'demo-dd-nutri', 'Nutrition Shake', 'NDG_6284', true],
  ['uber_eats', 'demo-uber-crepe', 'OCRÊPE', 'HOCHELAGA', true],
  ['doordash', 'demo-dd-gateau', 'Gateau Montreal', 'NDG_MAIN', true],
  ['uber_eats', 'demo-uber-taco', 'Taco Mexican', 'HOCHELAGA', true],
  ['skip', 'DEMO-SKIP-MYTHOS', 'Mythos 2 Go', 'SAINT_LEONARD', true],
  ['doordash', 'demo-dd-bolon', 'Cafe Bolon', 'NDG_MAIN', true],
  // New orders on this one wait for a tap: the kitchen's new-order alert.
  ['doordash', 'demo-dd-pipita-live', 'Pi Pita', 'SAINT_LEONARD', false],
  ['uber_eats', 'demo-uber-ppp-live', 'PPP Pizzeria', 'NDG_6284', false],
];
const PEOPLE = [['Marie', 'L.'], ['Samir', 'K.'], ['Julie', 'T.'], ['Karim', 'B.'], ['Sophie', 'D.'], ['Alex', 'M.'], ['Nadia', 'R.'], ['Lucas', 'P.'], ['Emma', 'G.'], ['Yanis', 'H.'], ['Chloé', 'V.'], ['Omar', 'S.']];
/** Dishes per brand: [name, price $]. Made up, typical of each kind of restaurant. */
const DISHES = {
  'Pi Pita': [['Pita shish taouk', 12.99], ['Pita falafel', 10.99], ['Pita shawarma bœuf', 13.49], ['Assiette shish taouk', 17.99], ['Frites', 4.49], ['Pepsi', 2.25]],
  'PPP Pizzeria': [['Pizza Pepperoni 12"', 18.99], ['Pizza Toute garnie 12"', 21.49], ['Poutine classique', 9.99], ['Ailes de poulet (10)', 15.99]],
  OOeuf: [['Œufs bénédictine', 15.49], ['Crêpe fruits frais', 13.99], ['Omelette jambon fromage', 14.25], ['Café latte', 4.75]],
  'Nutrition Shake': [['Shake protéiné vanille', 9.49], ['Smoothie mangue', 8.99], ['Bol açaï', 12.49]],
  'OCRÊPE': [['Crêpe Nutella banane', 11.99], ['Crêpe jambon gruyère', 13.49], ['Chocolat chaud', 4.25]],
  'Gateau Montreal': [['Gâteau fraises (6 po)', 32.0], ['Tranche Forêt-Noire', 6.75], ['Macarons (6)', 12.0]],
  'Taco Mexican': [['Tacos al pastor (3)', 13.99], ['Burrito poulet', 14.49], ['Nachos guacamole', 10.99]],
  'Mythos 2 Go': [['Gyro poulet', 13.49], ['Souvlaki porc', 16.99], ['Salade grecque', 9.99]],
  'Cafe Bolon': [['Cappuccino', 4.5], ['Croissant amandes', 3.95], ['Sandwich végé', 10.49]],
};
const slugOf = (brand) => brand.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Menu ref and Clover item id of a demo dish (made up): orders carry the ref, so every line is linked to Clover. */
const dishRef = (brand, i) => `demo-${slugOf(brand)}-${i + 1}`;
const cloverRef = (brand, i) => `DEMOCLV${slugOf(brand).replace(/-/g, '').slice(0, 8).toUpperCase()}${i + 1}`;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = (n, len = 5) => Array.from({ length: len }, (_, i) => CODE_CHARS[(n * 7 + i * 13 + (n >> i)) % CODE_CHARS.length]).join('');

// ---------------- local stand-in for every outside service ----------------
const uberOrders = new Map(); // order id → Uber order body served at /uber/v2/eats/order/:id
let cloverSeq = 0;
const mail = []; // e-mails the app sent (sign-in codes for the demo owner)
let outsideCalls = 0;
const cloverItems = [
  { id: 'demo-clv-1', name: 'Pita Shish Taouk', price: 1299, available: true, categories: { elements: [{ id: 'demo-cat-1', name: 'Pitas', sortOrder: 1 }] }, modifierGroups: { elements: [] }, tags: { elements: [{ id: 'TAG-K' }] } },
  { id: 'demo-clv-2', name: 'Frites', price: 449, available: true, categories: { elements: [{ id: 'demo-cat-2', name: 'Accompagnements', sortOrder: 2 }] }, modifierGroups: { elements: [] }, tags: { elements: [{ id: 'TAG-K' }] } },
];
const cloverPayments = [
  { id: 'dp1', amount: 2450, tipAmount: 300, taxAmount: 319, result: 'SUCCESS', order: { id: 'DEMO-INSTORE-1' } },
  { id: 'dp2', amount: 1875, tipAmount: 200, taxAmount: 244, result: 'SUCCESS', order: { id: 'DEMO-INSTORE-2' } },
  { id: 'dp3', amount: 3220, tipAmount: 450, taxAmount: 419, result: 'SUCCESS', order: { id: 'DEMO-INSTORE-3' } },
];
const PLATFORM_COLOR = { doordash: '#eb1700', ubereats: '#06c167', skip: '#f36d00', other: '#7a869a' };
/**
 * The relay host's remote screen, as a neutral placeholder (a coloured dot, the slot, a clock): the real wall shows each
 * platform's own order page here. No platform screen and no platform name is ever filmed inside a tile.
 */
function relayPage(slot, platform) {
  const c = PLATFORM_COLOR[platform] ?? '#7a869a';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${slot}</title>
<style>html,body{margin:0;height:100%;background:#0b1220;color:#e8eefc;font:600 14px/1.3 system-ui,Segoe UI,Arial,sans-serif;overflow:hidden}
.w{height:100%;display:grid;place-items:center;background:radial-gradient(120% 80% at 50% 0%,${c}33,transparent 60%),repeating-linear-gradient(0deg,#ffffff06 0 1px,transparent 1px 28px)}
.c{text-align:center}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:6px;box-shadow:0 0 12px ${c}}
.s{font-size:clamp(22px,7vw,64px);font-weight:800;letter-spacing:-.02em}.p{opacity:.85;margin-top:4px;font-size:clamp(11px,2.6vw,18px)}
.k{margin-top:10px;font:500 clamp(10px,2vw,14px) ui-monospace,Consolas,monospace;opacity:.6}.d{position:absolute;right:8px;bottom:6px;font-size:10px;opacity:.45;letter-spacing:.08em}</style></head>
<body><div class="w"><div class="c"><div class="p"><span class="dot"></span>Tablette de commandes</div><div class="s">${slot.toUpperCase()}</div><div class="p">Order screen</div><div class="k" id="k"></div></div></div><div class="d">DÉMO</div>
<script>const k=document.getElementById('k');const f=()=>{k.textContent=new Date().toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit',second:'2-digit'})};f();setInterval(f,1000)</script></body></html>`;
}
const relayPlatform = new Map(); // slot → platform (filled after the screens are set up)

const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  outsideCalls += 1;
  const url = new URL(req.url, MOCK);
  const p = url.pathname;
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)); };
  const relay = p.match(/^\/relay\/(s\d{2})\/?$/);
  if (relay) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(relayPage(relay[1], relayPlatform.get(relay[1]) ?? 'other')); }
  if (p.startsWith('/uber/')) {
    if (p === '/uber/oauth/v2/token') return send(200, { access_token: 'uber-token-reels', expires_in: 2592000 });
    const order = p.match(/^\/uber\/v2\/eats\/order\/(.+)$/);
    if (order) return uberOrders.has(order[1]) ? send(200, uberOrders.get(order[1])) : send(404, {});
    const st = p.match(/^\/uber\/v1\/eats\/store\/([^/]+)\/status$/);
    if (st && req.method === 'GET') return send(200, { status: 'ONLINE' });
    if (/created-orders$/.test(p)) return send(200, { orders: [] });
    if (p === '/uber/v1/eats/stores') return send(200, { stores: [] });
    return send(204);
  }
  if (p.startsWith('/dd/')) {
    const det = p.match(/^\/dd\/api\/v1\/stores\/([^/]+)\/store_details$/);
    if (det) return send(200, { merchant_supplied_id: det[1], provider_name: 'takatak', current_deactivations: [] });
    return send(202, {});
  }
  if (p.startsWith('/skip/')) return send(p.includes('/order/') ? 200 : 202, {});
  if (p.startsWith('/clover/')) {
    if (p.endsWith('/atomic_order/orders')) { cloverSeq += 1; return send(200, { id: `DEMOCLV${cloverSeq}` }); }
    if (/\/orders\/[^/]+\/payments$/.test(p) && req.method === 'POST') return send(200, { id: `DEMOPAY${++cloverSeq}` });
    if (/\/v3\/merchants\/[^/]+\/orders\/[^/]+$/.test(p)) return send(200, { id: p.split('/').pop(), total: 0 });
    if (/\/v3\/merchants\/[^/]+\/orders$/.test(p)) return send(200, { elements: [] });
    if (p.endsWith('/tenders')) return send(200, { elements: [{ id: 'T-CASH', label: 'Cash' }] });
    if (p.endsWith('/order_types')) return send(200, { elements: [{ id: 'OT-DINE', label: 'Dine In' }] });
    if (p.endsWith('/devices')) return send(200, { elements: [{ id: 'DEMO-DEV-1', model: 'Clover_C503' }] });
    if (p.endsWith('/categories')) return send(200, { elements: [{ id: 'demo-cat-1', name: 'Pitas' }, { id: 'demo-cat-2', name: 'Accompagnements' }] });
    if (p.endsWith('/menus')) return send(200, { elements: [] });
    if (p.endsWith('/tags')) return send(200, { elements: [{ id: 'TAG-K', name: 'Cuisine', printers: { elements: [{ id: 'PR-1' }] } }] });
    if (p.endsWith('/tax_rates')) return send(200, { elements: [{ id: 'TX-1', name: 'TPS', rate: 500000, isDefault: true }, { id: 'TX-2', name: 'TVQ', rate: 997500, isDefault: true }] });
    if (p.endsWith('/print_event')) return send(200, { id: 'PE-demo', state: 'CREATED' });
    if (p.endsWith('/items')) return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverItems });
    if (p.endsWith('/modifier_groups')) return send(200, { elements: [] });
    if (p.endsWith('/payments')) return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverPayments });
    if (p.endsWith('/refunds')) return send(200, { elements: [] });
    if (/\/v3\/merchants\/[^/]+$/.test(p)) return send(200, { id: 'DEMOMERCHANT', name: 'Restaurant démo' });
    return send(200, { elements: [] });
  }
  if (p.startsWith('/resend/')) { try { const m = JSON.parse(raw); mail.push({ to: [].concat(m.to ?? []).join(','), text: String(m.text ?? '') }); } catch { /* not JSON */ } return send(200, { id: 're_reels' }); }
  if (p.startsWith('/twilio/')) return send(201, { sid: `SMreels${outsideCalls}`, status: 'queued' });
  return send(200, { ok: true });
});

// ---------------- helpers ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
const basic = `Basic ${Buffer.from(`owner:${PASSWORD}`).toString('base64')}`;
async function call(method, p, { body, auth = true, headers = {}, raw } = {}) {
  const res = await fetch(`${APP}${p}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: basic } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie') };
}
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 240)}`); return r; };
const cents = (x) => Math.round(x * 100);
const pick = (arr, i) => arr[i % arr.length];

function resolveFfmpeg() {
  const tryRun = (bin) => { try { return spawnSync(bin, ['-version'], { encoding: 'utf8' }).status === 0; } catch { return false; } };
  if (process.env.FFMPEG && tryRun(process.env.FFMPEG)) return process.env.FFMPEG;
  if (tryRun('ffmpeg')) return 'ffmpeg';
  try { const bin = createRequire(import.meta.url)('ffmpeg-static'); if (bin && tryRun(bin)) return bin; } catch { /* not installed */ }
  return null;
}
function ffmpeg(bin, args) {
  const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.stdout}`);
}

// ---------------- start the app (same way as scripts/a11y-check.mjs) ----------------
if (!fs.existsSync(path.join('.next', 'BUILD_ID'))) { console.error('No build found: run `npx next build --webpack` first.'); process.exit(1); }
const FF = SERVE ? null : resolveFfmpeg();
if (!SERVE && !FF) { console.error('ffmpeg not found: set FFMPEG=<path>, put ffmpeg on PATH, or `npm i --no-save ffmpeg-static@5.2.0`.'); process.exit(1); }
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(APP_PORT),
  FOODHUB_FORCE_MEMORY: 'true',
  FOODHUB_PUBLIC_URL: APP, // http on 127.0.0.1: the session cookie is not "Secure", so the browser keeps it
  FOODHUB_TIMEZONE: TZ,
  TZ, // the server renders times in the same zone as the browser (no flash of another hour)
  LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
  DASHBOARD_PASSWORD: PASSWORD,
  SESSION_SECRET: 'reels-session-secret-0123456789abcdef-local-only',
  CRON_SECRET: 'cron-reels',
  UBER_BASE_URL: `${MOCK}/uber`, UBER_AUTH_URL: `${MOCK}/uber/oauth/v2/token`, UBER_CLIENT_ID: 'uber-id-reels', UBER_CLIENT_SECRET: UBER_SECRET, UBER_WEBHOOK_SIGNING_KEY: 'uber-signing-reels',
  DOORDASH_BASE_URL: `${MOCK}/dd`, DOORDASH_DEVELOPER_ID: 'dd-dev-reels', DOORDASH_KEY_ID: 'dd-key-reels', DOORDASH_SIGNING_SECRET: Buffer.from('doordash-signing-secret-reels-32b').toString('base64'), DOORDASH_PROVIDER_TYPE: 'takatak_demo', DOORDASH_WEBHOOK_SECRET: DD_HOOK,
  SKIP_JET_BASE_URL: `${MOCK}/skip`, SKIP_JET_API_KEY: 'jet-api-key-reels', SKIP_WEBHOOK_HMAC_SECRET: SKIP_HMAC, SKIP_WEBHOOK_API_KEY: 'skip-notify-reels',
  TGTG_WEBHOOK_SECRET: 'tgtg-hook-reels',
  CLOVER_BASE_URL: `${MOCK}/clover`, CLOVER_MERCHANT_ID: 'DEMOMERCHANT', CLOVER_ACCESS_TOKEN: CLOVER_TOKEN, CLOVER_WEBHOOK_AUTH: 'clover-auth-reels',
  FOODHUB_SCREENS_AGENT_TOKEN: SCREENS_TOKEN,
  FOODHUB_MEDIA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fh-reels-media-')),
  RESEND_API_KEY: 're_reels', REPORT_EMAIL_FROM: 'Food Hub <rapports@demo-restaurant.test>', RESEND_BASE_URL: `${MOCK}/resend`,
  AUTH_EMAIL_FROM: 'Food Hub <connexion@demo-restaurant.test>',
  TWILIO_ACCOUNT_SID: 'AC_reels', TWILIO_AUTH_TOKEN: 'tw-reels', TWILIO_FROM: '+15145550199', TWILIO_BASE_URL: `${MOCK}/twilio`,
  ALERT_WEBHOOK_URL: `${MOCK}/chat`,
  FOODHUB_TABLET_APK_URL: 'https://github.com/takatakca/foodhubca/releases', // a link only: the page never fetches GitHub
  FOODHUB_WATCH_INTERVAL_S: '0',
};
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UBER_ACCESS_TOKEN', 'TGTG_SPEC_CONFIRMED', 'FOODHUB_CLOVER_AUTOPRINT', 'CLOVER_PRINT_DEVICE_ID', 'FOODHUB_SYNC_MIN_INTERVAL_S', 'FOODHUB_CLOVER_RECORD_PAYMENT', 'FOODHUB_CLOVER_ORDER_TYPES', 'FOODHUB_CLOVER_INVENTORY_SYNC', 'FOODHUB_CLOVER_DELETE_CANCELLED', 'FOODHUB_SCHEDULED_AFTER_MIN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'FOODHUB_INSECURE_SHOW_CODES', 'TWILIO_MESSAGING_SERVICE_SID', 'FOODHUB_OWNER_EMAIL', 'FOODHUB_OWNER_PHONE', 'FOODHUB_FEATURE_DELIVERY', 'FOODHUB_FEATURE_RETAIL', 'FOODHUB_FEATURE_ALCOHOL', 'FOODHUB_FEATURE_PHONE', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_ORDER_TYPES', 'FOODHUB_CLOVER_WEBSITE_POLL_S', 'FOODHUB_CLOVER_WEBSITE_CLOSE_MIN', 'FOODHUB_PUBLIC_HOME', 'FOODHUB_APP_MARKET_URL', 'FOODHUB_APP_MARKET_STATUS', 'FOODHUB_PUBLIC_LIVE_PLATFORMS', 'FOODHUB_PUBLIC_SAME_AS', 'NEXT_PUBLIC_CLOVER_APPS_LIVE', 'FOODHUB_FEATURE_MEV', 'FOODHUB_MEV', 'FOODHUB_MEV_TRIGGER', 'FOODHUB_MEV_CLOVER_NOTE', 'FOODHUB_MEV_SEND_RECEIPT', 'FOODHUB_MEV_USER', 'FOODHUB_MEV_TIMEOUT_MS', 'FOODHUB_TENANT_ID', 'FOODHUB_FEATURE_STOREFRONT', 'FOODHUB_TRUST_PROXY', 'VERCEL_URL', 'FOODHUB_SCREENS_VIEW_HOSTS', 'CLOVER_CLIENT_ID', 'CLOVER_CLIENT_SECRET', 'CLOVER_MERCHANT_TOKENS']) delete env[k];

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });
const up = await waitFor(async () => { try { return (await fetch(`${APP}/api/foodhub/channels`)).status > 0; } catch { return false; } }, 40000);
if (!up) { console.error('App did not start.\n', appLog.slice(-3000)); app.kill('SIGTERM'); mock.close(); process.exit(1); }

// ---------------- seed ----------------
const orderIds = []; // Food Hub order ids, oldest first
let orderSeq = 0;
function cart(brand, n) {
  const dishes = DISHES[brand] ?? DISHES['Pi Pita'];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const at = (orderSeq + i * 2) % dishes.length;
    if (lines.some((l) => l.ref === dishRef(brand, at))) continue;
    const [name, price] = dishes[at];
    lines.push({ name, price, qty: i === 0 && n > 1 ? 2 : 1, ref: dishRef(brand, at) });
  }
  return lines;
}
async function sendOrder(channel, storeId, brand, { items = 2, note = '' } = {}) {
  orderSeq += 1;
  const [first, last] = pick(PEOPLE, orderSeq);
  const lines = cart(brand, items);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = Math.round(subtotal * 0.14975 * 100) / 100;
  const code = shortCode(orderSeq + 11);
  const ext = channel === 'doordash' ? `${code}${shortCode(orderSeq + 3, 3)}-demo-${orderSeq}` : `demo-${channel}-${code}`;
  let r;
  if (channel === 'doordash') {
    r = await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: DD_HOOK }, body: {
      id: ext, delivery_short_code: code, store: { merchant_supplied_id: storeId }, consumer: { first_name: first, last_name: last }, subtotal: cents(subtotal), tax: cents(tax),
      special_instructions: note || undefined,
      categories: [{ name: 'Plats', items: lines.map((l) => ({ name: l.name, quantity: l.qty, price: cents(l.price), merchant_supplied_id: l.ref, extras: [] })) }] } });
  } else if (channel === 'skip') {
    const raw = JSON.stringify({
      id: ext, transmission_id: `tx-${ext}`, third_party_order_reference: `${code.slice(0, 4)}`, type: 'delivery-by-delivery-partner', posLocationId: storeId,
      items: lines.map((l) => ({ name: l.name, plu: l.ref, price: cents(l.price), quantity: l.qty, notes: '', children: [] })),
      created_at: String(Math.floor(Date.now() / 1000)), collect_at: String(Math.floor(Date.now() / 1000) + 1200), kitchen_notes: note,
      payment: { items_in_cart: { inc_tax: cents(subtotal + tax), tax: cents(tax) }, final: { inc_tax: cents(subtotal + tax), tax: cents(tax) } }, delivery: { first_name: first }, total: cents(subtotal + tax),
    });
    const hash = `HMAC-SHA256 t=${Date.now()},signature=${crypto.createHmac('sha256', SKIP_HMAC).update(raw).digest('base64')}`;
    r = await call('POST', '/api/foodhub/webhooks/skip/orders', { auth: false, raw, headers: { 'x-jet-connect-hash': hash } });
  } else {
    uberOrders.set(ext, {
      id: ext, display_id: code, store: { id: storeId, name: brand }, eater: { first_name: first },
      cart: { items: lines.map((l) => ({ id: l.ref, external_data: l.ref, title: l.name, quantity: l.qty,
        price: { unit_price: { amount: cents(l.price), currency_code: 'CAD' }, total_price: { amount: cents(l.price * l.qty), currency_code: 'CAD' }, base_unit_price: { amount: cents(l.price), currency_code: 'CAD' } }, selected_modifier_groups: [] })),
      special_instructions: note || undefined },
      payment: { charges: { sub_total: { amount: cents(subtotal), currency_code: 'CAD' }, tax: { amount: cents(tax) }, total: { amount: cents(subtotal + tax), currency_code: 'CAD' }, delivery_fee: { amount: 0 }, tip: { amount: 300 } } },
      type: 'DELIVERY_BY_UBER', placed_at: new Date().toISOString(), estimated_ready_for_pickup_at: new Date(Date.now() + 15 * 60000).toISOString(),
    });
    const raw = JSON.stringify({ event_type: 'orders.notification', event_id: `evt-${ext}`, meta: { resource_id: ext, status: 'pos', user_id: storeId }, resource_href: `${MOCK}/uber/v2/eats/order/${ext}` });
    r = await call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } });
  }
  if (r.status >= 300) throw new Error(`${channel} order ${ext}: ${r.status} ${r.text.slice(0, 200)}`);
  const o = await waitFor(async () => ((await call('GET', '/api/foodhub/orders?limit=500')).json?.orders ?? []).find((x) => x.externalOrderId === ext), 15000);
  if (!o) throw new Error(`order ${ext} did not arrive`);
  orderIds.push(o.id);
  return o;
}
const act = (id, action, extra = {}) => call('POST', `/api/foodhub/orders/${id}`, { body: { action, ...extra } });

async function heartbeat(waiting = {}) {
  const screens = [...relayPlatform.keys()].map((id) => ({
    id, state: 'ok', title: waiting[id] ? `(${waiting[id]}) Commandes` : 'Commandes', url: null, waiting: waiting[id] ?? 0,
  }));
  return call('POST', '/api/foodhub/screens/heartbeat', { auth: false, headers: { authorization: `Bearer ${SCREENS_TOKEN}` }, body: { version: 'reels-demo', screens } });
}
let beat = null;
const tablets = []; // device cookies of the enrolled kitchen tablets
/** The kitchen tablets say they are on (sound on, screen visible), like the tablet app does every 30 s. */
const tabletBeat = () => Promise.all(tablets.map((cookie) => call('POST', '/api/foodhub/devices/heartbeat', { auth: false, headers: { cookie }, body: { soundOn: true, visible: true, battery: 0.86, charging: true, screen: '/kitchen' } })));
const WAITING = { s02: 2, s09: 1 };

async function seed() {
  console.log('Seed (made-up demo data only)');
  const cat = must(await call('GET', '/api/foodhub/catalog'), 'catalog').json;
  for (const name of HIDE_BRANDS) await call('POST', '/api/foodhub/catalog', { body: { brand: { name, active: false } } });
  for (const [name, accent] of Object.entries(ACCENTS)) if (cat.brands.some((b) => b.name === name)) must(await call('POST', '/api/foodhub/catalog', { body: { brand: { name, active: true, accent } } }), `accent ${name}`);
  // Kitchens: neighbourhood names stay; street addresses are left out of the demo. Phones: the 555-01xx fiction range.
  for (const [i, l] of cat.locations.entries()) {
    must(await call('POST', '/api/foodhub/catalog', { body: { location: { code: l.code, name: l.name, address: '', city: l.city ?? 'Montréal', province: 'QC', postalCode: '', phone: `+1514555011${i}`, active: true } } }), `location ${l.code}`);
  }
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open: '11:00', close: '23:30' }]]));
  // Pi Pita (the ordering page) has no closing time in the demo: the page's "Ferme à …" label is drawn in the browser in
  // Montréal time, which would not match the demo clock's zone. It simply reads "Ouvert".
  const allDay = Object.fromEntries(Object.keys(week).map((d) => [d, [{ open: '00:00', close: '23:59' }]]));
  must(await call('PUT', '/api/foodhub/hours', { body: { hours: { locations: Object.fromEntries(cat.locations.map((l) => [l.code, week])), brands: { 'Pi Pita': allDay }, holidays: [] } } }), 'hours');
  // A small Clover-linked menu per demo brand (made-up dishes), so every order line is matched to a Clover item.
  for (const [brand, dishes] of Object.entries(DISHES)) {
    if (brand === 'Pi Pita') continue;
    must(await call('PUT', '/api/foodhub/menu', { body: { menu: {
      brandName: brand,
      categories: [{ ref: `demo-${slugOf(brand)}-menu`, name: 'Menu', nameFr: 'Menu', sortOrder: 1 }],
      items: dishes.map(([name, price], i) => ({ ref: dishRef(brand, i), posItemRef: cloverRef(brand, i), name, nameFr: name, price, categoryRef: `demo-${slugOf(brand)}-menu`, available: true, modifierGroupRefs: [] })),
      modifierGroups: [],
    } } }), `menu ${brand}`);
  }
  for (const [channel, channelStoreId, brandName, locationCode, autoAccept] of STORES) must(await call('POST', '/api/foodhub/stores', { body: { channel, channelStoreId, brandName, locationCode, autoAccept } }), `store ${channelStoreId}`);
  // Team: an owner account and a reachable manager with a PIN in every kitchen (fiction numbers, .test e-mails).
  await call('POST', '/api/foodhub/users', { body: { username: 'matthieu', name: 'Matthieu', role: 'owner', email: OWNER_EMAIL, phone: '+15145550101', locations: [] } });
  for (const [i, l] of cat.locations.entries()) {
    await call('POST', '/api/foodhub/users', { body: { username: `gerant${i + 1}`, name: `Gérant ${l.name.split(' ')[0]}`, role: 'manager', phone: `+1514555012${i}`, pin: `${4826 + i * 111}`.slice(0, 4), locations: [l.code] } });
    await call('POST', '/api/foodhub/users', { body: { username: `cuisine${i + 1}`, name: `Cuisine ${i + 1}`, role: 'operator', pin: `${5937 + i * 101}`.slice(0, 4), locations: [l.code] } });
    const dev = await call('POST', '/api/foodhub/devices', { body: { name: `Tablette ${l.name}`, locationCode: l.code } });
    if (dev.cookie) tablets.push(dev.cookie.split(';')[0]);
  }
  // Ordering page: Pi Pita's menu imported from (the stand-in) Clover, then edited (made-up dishes), and its page switched on.
  must(await call('POST', '/api/foodhub/menu/import', { body: { brand: 'Pi Pita' } }), 'menu import');
  must(await call('PUT', '/api/foodhub/menu', { body: { menu: {
    brandName: 'Pi Pita',
    categories: [
      { ref: 'demo-pitas', name: 'Pitas', nameFr: 'Pitas', sortOrder: 1 },
      { ref: 'demo-plates', name: 'Plates', nameFr: 'Assiettes', sortOrder: 2 },
      { ref: 'demo-sides', name: 'Sides & drinks', nameFr: 'Extras et boissons', sortOrder: 3 },
    ],
    items: [
      { ref: dishRef('Pi Pita', 0), posItemRef: cloverRef('Pi Pita', 0), name: 'Shish taouk pita', nameFr: 'Pita shish taouk', description: 'Grilled chicken, garlic sauce, pickles', descriptionFr: 'Poulet grillé, sauce à l’ail, cornichons', price: 12.99, categoryRef: 'demo-pitas', available: true, modifierGroupRefs: ['demo-combo'] },
      { ref: dishRef('Pi Pita', 1), posItemRef: cloverRef('Pi Pita', 1), name: 'Falafel pita', nameFr: 'Pita falafel', description: 'Falafel, hummus, tahini, vegetables', descriptionFr: 'Falafels, hummus, tahini, légumes', price: 10.99, categoryRef: 'demo-pitas', available: true, modifierGroupRefs: ['demo-combo'] },
      { ref: dishRef('Pi Pita', 2), posItemRef: cloverRef('Pi Pita', 2), name: 'Beef shawarma pita', nameFr: 'Pita shawarma bœuf', description: 'Marinated beef, tahini, onions', descriptionFr: 'Bœuf mariné, tahini, oignons', price: 13.49, categoryRef: 'demo-pitas', available: true, modifierGroupRefs: ['demo-combo'] },
      { ref: dishRef('Pi Pita', 3), posItemRef: cloverRef('Pi Pita', 3), name: 'Shish taouk plate', nameFr: 'Assiette shish taouk', description: 'Rice, salad, potatoes, garlic sauce', descriptionFr: 'Riz, salade, patates, sauce à l’ail', price: 17.99, categoryRef: 'demo-plates', available: true, modifierGroupRefs: [] },
      { ref: dishRef('Pi Pita', 4), posItemRef: cloverRef('Pi Pita', 4), name: 'Fries', nameFr: 'Frites', price: 4.49, categoryRef: 'demo-sides', available: true, modifierGroupRefs: [] },
      { ref: dishRef('Pi Pita', 5), posItemRef: cloverRef('Pi Pita', 5), name: 'Pepsi', nameFr: 'Pepsi', price: 2.25, categoryRef: 'demo-sides', available: true, modifierGroupRefs: [] },
    ],
    modifierGroups: [
      { ref: 'demo-combo', name: 'Make it a meal', nameFr: 'En faire un repas', min: 0, max: 1, modifiers: [
        { ref: 'demo-duo', name: 'Duo — drink', nameFr: 'Duo — breuvage', price: 2.5, available: true },
        { ref: 'demo-trio', name: 'Trio — fries + drink', nameFr: 'Trio — frites + breuvage', price: 5.42, available: true },
      ] },
    ],
  } } }), 'menu Pi Pita');
  const sf = must(await call('GET', '/api/foodhub/storefront/settings'), 'storefront').json;
  const pp = sf.brands.find((b) => b.name === 'Pi Pita');
  must(await call('PUT', '/api/foodhub/storefront/settings', { body: { enabled: true, brands: { 'Pi Pita': { enabled: true, slug: pp.slug, locationCode: 'SAINT_LEONARD', payOnline: false, payAtPickup: true, pickupMaxTotal: pp.pickupMaxTotal } } } }), 'storefront on');
  // Platform screens wall: 16 numbered screens on a local placeholder "relay host".
  must(await call('POST', '/api/foodhub/screens/setup', { body: { baseUrl: `${MOCK}/relay/`, locationCode: 'SAINT_LEONARD', counts: { doordash: 6, ubereats: 6, skip: 4 } } }), 'screens');
  for (const s of must(await call('GET', '/api/foodhub/screens'), 'screens list').json.screens) relayPlatform.set(s.id, s.platform);
  must(await heartbeat(WAITING), 'heartbeat');
  await tabletBeat();
  beat = setInterval(() => { heartbeat(WAITING).catch(() => {}); tabletBeat().catch(() => {}); }, 20_000);
  // Today's orders across platforms and brands, then moved along like a real service.
  const plan = STORES.filter((s) => s[4]);
  for (let i = 0; i < 16; i++) {
    const [channel, storeId, brand] = pick(plan, i * 5);
    await sendOrder(channel, storeId, brand, { items: 1 + (i % 3), note: i % 5 === 2 ? 'Sans oignons, svp' : '' });
  }
  for (const [i, id] of orderIds.entries()) {
    await act(id, 'ack');
    if (i < 7) { await act(id, 'ready'); await act(id, 'complete'); } else if (i < 10) await act(id, 'ready');
  }
  const o = must(await call('GET', '/api/foodhub/orders?limit=500'), 'orders').json.orders;
  const by = o.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});
  console.log(`  ${o.length} orders (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}); ordering page /commander/${pp.slug}; ${relayPlatform.size} screens`);
  return { slug: pp.slug };
}

/** Signs in as the demo owner (Matthieu) with a one-time code, like a person would; returns the browser session. */
async function signIn(b) {
  const ctx = await b.newContext();
  try {
    const before = mail.length;
    const start = await ctx.request.post(`${APP}/api/foodhub/auth/start`, { data: { contact: OWNER_EMAIL, lang: 'fr' } });
    const { challengeId } = await start.json();
    const m = await waitFor(async () => mail.slice(before).find((x) => x.to.includes(OWNER_EMAIL) && /\b\d{6}\b/.test(x.text)), 8000);
    const code = m?.text.match(/\b(\d{6})\b/)?.[1];
    if (!challengeId || !code) throw new Error(`demo owner sign-in: no code (${start.status()})`);
    const v = await ctx.request.post(`${APP}/api/foodhub/auth/verify`, { data: { challengeId, code } });
    if (!v.ok()) throw new Error(`demo owner sign-in refused: ${v.status()}`);
    return await ctx.storageState();
  } finally { await ctx.close(); }
}

let browser;
let exitCode = 0;
try {
  const { slug } = await seed();
  if (SERVE) {
    console.log(`\nServing: ${APP}  (sign in: owner / ${PASSWORD})  ordering page: ${APP}/commander/${slug}\nCtrl+C to stop.`);
    await new Promise((resolve) => { process.on('SIGINT', resolve); process.on('SIGTERM', resolve); });
  } else {
    const { runShots } = await import('./promo-reels-shots.mjs');
    browser = await chromium.launch();
    exitCode = await runShots({ browser, APP, OUT, ONLY, KEEP_RAW, VERTICAL_ONLY, NO_CUTS, FF, ffmpeg, forbiddenIn, sendOrder, act, call, sleep, waitFor, slug, TZ, signIn });
  }
} catch (e) {
  exitCode = 1;
  console.error(`\nPromo reels could not run: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  console.error(`\n--- app log ---\n${appLog.slice(-4000)}`);
} finally {
  if (beat) clearInterval(beat);
  await browser?.close().catch(() => {});
  app.kill('SIGTERM');
  mock.close();
}
console.log(`(${outsideCalls} calls answered by the local stand-in; nothing left the machine.)`);
process.exit(exitCode);
