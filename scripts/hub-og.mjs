// Draws the share images of the public site (public/og/hub-fr.png, public/og/hub-en.png, 1200×630): the brand, the
// promise and a real still of the orders board (public/hub-media/, scripts/hub-media.mjs). Run: node scripts/hub-og.mjs
// Uses the pre-installed Chromium (PW_CHROMIUM, default /opt/pw-browsers/chromium) and the site's own font.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const font = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')).toString('base64');
const fontExt = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2')).toString('base64');

const WORDS = {
  fr: {
    eyebrow: 'Pour les restaurants qui utilisent Clover',
    title: 'Uber Eats, DoorDash et SkipTheDishes dans votre caisse Clover',
    sub: 'Un seul écran · écran de cuisine · menus et ruptures synchronisés',
    foot: 'Conçu à Montréal',
  },
  en: {
    eyebrow: 'For restaurants on Clover',
    title: 'Uber Eats, DoorDash and SkipTheDishes in your Clover register',
    sub: 'One screen · kitchen display · synced menus and sold-out items',
    foot: 'Built in Montréal',
  },
};

const html = (lang) => {
  const w = WORDS[lang];
  const shot = fs.readFileSync(path.join(ROOT, `public/hub-media/orders-${lang}-1280.webp`)).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: M; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 800; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F; }
@font-face { font-family: M; src: url(data:font/woff2;base64,${fontExt}) format('woff2'); font-weight: 200 800; unicode-range: U+0100-024F, U+1E00-1EFF; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: M, sans-serif; color: #fff;
  background: radial-gradient(700px 420px at 92% 110%, rgba(31,139,255,.45), transparent 70%), radial-gradient(520px 300px at 10% -10%, rgba(41,195,255,.14), transparent 70%), #060d1f; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px); background-size: 48px 48px; -webkit-mask-image: radial-gradient(ellipse at 30% 40%, #000 25%, transparent 75%); }
.left { position: absolute; left: 72px; top: 64px; width: 560px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 800; letter-spacing: -.01em; }
.brand span { color: #b8c4d3; font-weight: 600; }
.mark { width: 48px; height: 48px; border-radius: 999px; background: #1f8bff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 24px; box-shadow: 0 0 26px rgba(31,139,255,.6); }
.eyebrow { margin-top: 54px; color: #29c3ff; font-size: 17px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin-top: 16px; font-size: 50px; line-height: 1.08; font-weight: 800; letter-spacing: -.025em; }
.sub { margin-top: 22px; color: #b8c4d3; font-size: 21px; font-weight: 500; }
.foot { position: absolute; left: 72px; bottom: 50px; display: flex; gap: 14px; align-items: center; color: #b8c4d3; font-size: 19px; font-weight: 600; }
.foot b { color: #fff; }
.dot { width: 6px; height: 6px; border-radius: 9px; background: #29c3ff; }
.shot { position: absolute; left: 680px; top: 92px; width: 760px; border-radius: 14px; overflow: hidden; background: #fff;
  box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 40px 100px -20px rgba(31,139,255,.55), 0 10px 40px rgba(0,0,0,.55); }
.bar { height: 26px; background: #eef1f6; border-bottom: 1px solid #dde2ea; display: flex; align-items: center; gap: 6px; padding: 0 12px; }
.bar i { width: 9px; height: 9px; border-radius: 9px; background: #cfd5df; }
.shot img { display: block; width: 100%; }
</style></head><body><div class="grid"></div>
<div class="left">
  <div class="brand"><div class="mark">T</div><div>TAKATAK <span>Food Hub</span></div></div>
  <div class="eyebrow">${w.eyebrow}</div>
  <h1>${w.title}</h1>
  <div class="sub">${w.sub}</div>
</div>
<div class="foot"><b>foodhub.on2go.ca</b><span class="dot"></span>${w.foot}</div>
<div class="shot"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/webp;base64,${shot}"></div>
</body></html>`;
};

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const lang of ['fr', 'en']) {
  await page.setContent(html(lang), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(ROOT, `public/og/hub-${lang}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(out, `${Math.round(fs.statSync(out).size / 1024)} KB`);
}
await browser.close();
