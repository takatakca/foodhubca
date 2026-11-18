// Stills of the real Food Hub console for the public landing, from a LOCAL demo build with fictional data: the
// promo-reels server (scripts/promo-reels.mjs --serve, branch chore/promo-reels) on 127.0.0.1:5912. Then
// node scripts/hub-media.mjs <out> turns them into the WebP files of public/hub-media/.
// Run: node scripts/hub-shots.mjs <out folder>   (REELS_APP, REELS_PASSWORD and REELS_DD_HOOK override the demo values)
// Guards: only 127.0.0.1 is reachable, and a shot is refused when its text shows a protected or real-looking value
// (Po Poulet, its store id, a personal address or a non-555 Montréal phone number).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright');

const APP = process.env.REELS_APP || 'http://127.0.0.1:5912';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = [/po\s*poulet/i, /popoulet/i, /27982486/, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, /\+?1?\s*\(?514\)?[\s-]?(?!555)\d{3}[\s-]?\d{4}/];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });

async function session(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: lang === 'fr' ? 'fr-CA' : 'en-CA', timezoneId: 'America/Toronto' });
  await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
  await ctx.addCookies([{ name: 'fh_lang', value: lang, url: APP }, { name: 'fh_view', value: 'full', url: APP }]);
  // The welcome card (TakTak) shows once per person: mark it as already seen, as after a first visit.
  await ctx.addInitScript(() => {
    for (const u of ['owner', 'Owner', 'anon']) localStorage.setItem(`takatak.help.v1:${u}`, JSON.stringify({ seen: [], welcomed: true, toursDone: [] }));
    sessionStorage.setItem('takatak.bar.memory', '1'); // the "demo mode" banner, hidden as a visitor would
  });
  const res = await ctx.request.post(`${APP}/api/foodhub/auth/login`, { data: { username: 'owner', password: process.env.REELS_PASSWORD || 'reels-demo-pass' } });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
  return ctx;
}

async function guard(page, name) {
  const text = await page.evaluate(() => document.body.innerText);
  const hit = FORBIDDEN.find((r) => r.test(text));
  if (hit) throw new Error(`${name}: refused, page shows ${hit}`);
}

/** A new order that waits for its "seen" tap covers every page: tap it, like the kitchen would, before a regular shot. */
async function clearPopups(page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByRole('button', { name: /^(Vu — en préparation|Seen — (cooking|preparing)|Accepter|Accept)/ }).first();
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(900);
  }
}

async function shot(ctx, name, url, { wait = 2500, full = false, clip, before, keepPopup = false } = {}) {
  const page = await ctx.newPage();
  await page.goto(`${APP}${url}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(wait);
  if (before) await before(page);
  if (!keepPopup) await clearPopups(page);
  await guard(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full, clip });
  console.log('saved', name);
  return page;
}

async function newDoorDashOrder(ctx, n) {
  const id = `HUB${n}DEMO-${Date.now() % 100000}`;
  const r = await ctx.request.post(`${APP}/api/foodhub/webhooks/doordash`, {
    headers: { authorization: process.env.REELS_DD_HOOK || 'dd-hook-reels' },
    data: {
      id, delivery_short_code: `HUB${n}`, store: { merchant_supplied_id: 'demo-dd-ppp' }, consumer: { first_name: 'Camille', last_name: 'R.' },
      subtotal: 3897, tax: 584, special_instructions: 'Extra sauce à l’ail',
      categories: [{ name: 'Plats', items: [
        { name: 'Pizza toute garnie 12"', quantity: 2, price: 1699, merchant_supplied_id: 'demo-ppp-1', extras: [] },
        { name: 'Ailes de poulet (10)', quantity: 1, price: 499, merchant_supplied_id: 'demo-ppp-2', extras: [] },
      ] }],
    },
  });
  console.log('order', id, r.status());
}

for (const lang of ['fr', 'en']) {
  const ctx = await session(lang);
  const sfx = lang === 'fr' ? '' : '-en';
  await shot(ctx, `orders-board${sfx}`, '/orders');
  await shot(ctx, `overview${sfx}`, '/');
  await shot(ctx, `insights${sfx}`, '/insights?period=today', { wait: 3500 });
  // The new order pop-up on the kitchen screen: open the kitchen, then a fictional DoorDash order arrives.
  const kitchen = await shot(ctx, `kitchen${sfx}`, '/kitchen', { wait: 3000 });
  await newDoorDashOrder(ctx, lang === 'fr' ? 1 : 2);
  await kitchen.waitForTimeout(6000);
  await guard(kitchen, 'kitchen-new-order');
  await kitchen.screenshot({ path: path.join(OUT, `kitchen-new-order${sfx}.png`) });
  console.log('saved', `kitchen-new-order${sfx}`);
  await ctx.close();
}

// The customer ordering page on a phone (public, no session).
for (const lang of ['fr', 'en']) {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: lang === 'fr' ? 'fr-CA' : 'en-CA' });
  await phone.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
  await phone.addCookies([{ name: 'fh_lang', value: lang, url: APP }]);
  await shot(phone, `ordering-phone${lang === 'fr' ? '' : '-en'}`, '/commander/pi-pita', { wait: 3000 });
  await phone.close();
}
await browser.close();
