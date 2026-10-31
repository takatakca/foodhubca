// Shot list and recorder for scripts/promo-reels.mjs (docs/PROMO_REELS.md). Each shot opens one screen of the real
// console (or a public page), waits until it has settled, then plays a short, human-paced timeline: eased scrolls, taps
// with a soft touch ring (no mouse cursor), a demo order arriving. The take is recorded with Playwright `recordVideo`;
// ffmpeg trims it to the exact length (10, 15 or 20 s) and writes H.264 / 30 fps / no audio, plus a poster PNG.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Viewports: CSS size × device scale = the video size, so text stays sharp. */
const VIEW = {
  vertical: { viewport: { width: 810, height: 1440 }, deviceScaleFactor: 4 / 3, size: { width: 1080, height: 1920 } },
  landscape: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, size: { width: 1920, height: 1080 } },
  phone: { viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, size: { width: 1080, height: 1920 }, isMobile: true, hasTouch: true },
};

// ---------------- page helpers (run inside the recorded page) ----------------
/** A soft ring where a finger touches the screen (headless Chromium draws no cursor), and no scrollbars. */
const TOUCH_RING = () => {
  const style = () => {
    const s = document.createElement('style');
    s.textContent = 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}'
      + '.reel-tap{position:fixed;z-index:2147483647;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;pointer-events:none;'
      + 'background:rgba(255,255,255,.35);border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 2px rgba(15,23,42,.35),0 6px 18px rgba(15,23,42,.35);'
      + 'animation:reel-tap .62s ease-out forwards}@keyframes reel-tap{0%{transform:scale(.55);opacity:1}70%{opacity:.85}100%{transform:scale(1.5);opacity:0}}';
    document.documentElement.appendChild(s);
  };
  if (document.documentElement) style(); else document.addEventListener('DOMContentLoaded', style);
  window.addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.className = 'reel-tap';
    d.style.left = `${e.clientX}px`; d.style.top = `${e.clientY}px`;
    document.documentElement.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }, true);
};

function helpers(page, ctx) {
  const h = {
    ...ctx,
    page,
    wait: (ms) => page.waitForTimeout(ms),
    /** Eased scroll of the window by dy px over ms (easeInOutCubic, one frame at a time). */
    scrollBy: (dy, ms = 900) => page.evaluate(([dy, ms]) => new Promise((done) => {
      const y0 = window.scrollY; const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
      const step = (now) => { const t = Math.min(1, (now - t0) / ms); window.scrollTo(0, y0 + dy * ease(t)); if (t < 1) requestAnimationFrame(step); else done(); };
      requestAnimationFrame(step);
    }), [dy, ms]),
    /** Eased scroll so the element's top sits `offset` px under the top bar. */
    scrollTo: async (locator, { offset = 96, ms = 900 } = {}) => {
      const box = await locator.first().boundingBox();
      if (!box) return;
      await h.scrollBy(box.y - offset, ms);
    },
    /** Tap the middle of an element: a short pause on it, then the touch ring and the click. */
    tap: async (locator, { pause = 250 } = {}) => {
      const el = locator.first();
      await el.waitFor({ state: 'visible', timeout: 10000 });
      let box = await el.boundingBox();
      if (!box) throw new Error('tap: element has no box');
      // Off screen (or under the top bar): an eased scroll brings it to the upper third first, never a jump.
      const vh = page.viewportSize()?.height ?? 800;
      const pinned = await el.evaluate((n) => { for (let a = n; a; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') return true; } return false; });
      if (!pinned && (box.y < 72 || box.y + box.height > vh - 72)) {
        await h.scrollBy(box.y - vh / 3, 900);
        await page.waitForTimeout(250);
        box = await el.boundingBox();
        if (!box) throw new Error('tap: element has no box');
      }
      const x = box.x + box.width / 2; const y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps: 1 });
      await page.waitForTimeout(pause);
      await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
    },
  };
  return h;
}

// ---------------- the shots ----------------
// key, number, length (s), orientations, start path, poster time (s), setup before the clock starts, timeline.
export const SHOTS = [
  {
    key: 'kitchen-new-order', n: 1, seconds: 15, views: ['vertical', 'landscape'], path: '/kitchen', poster: 5.5,
    what: 'Kitchen screen: a new DoorDash order lands, the full-screen alert rings, one tap accepts it with a prep time.',
    async play(h, view) {
      const store = view === 'landscape' ? ['uber_eats', 'demo-uber-ppp-live', 'PPP Pizzeria'] : ['doordash', 'demo-dd-pipita-live', 'Pi Pita'];
      const before = Date.now();
      await h.wait(2200); // a calm board first
      await h.sendOrder(store[0], store[1], store[2], { items: 3, note: 'Extra sauce à l’ail, svp' });
      const alert = h.page.getByText('Nouvelle commande', { exact: false }).first();
      await alert.waitFor({ state: 'visible', timeout: 20000 });
      h.mark(Math.max(before, Date.now() - 2600)); // the clip opens 2.6 s before the alert
      await h.wait(4200);
      const chip = h.page.getByRole('button', { name: /^20/ }).first();
      if (await chip.isVisible().catch(() => false)) { await h.tap(chip); await h.wait(700); }
      await h.tap(h.page.getByRole('button', { name: /^Accepter ·/ }).first()); // the alert's button, not the card's behind it
      await h.wait(2400);
      await h.scrollBy(view === 'landscape' ? 260 : 420, 1400);
      await h.wait(3000);
    },
  },
  {
    key: 'screens-wall', n: 2, seconds: 20, views: ['vertical', 'landscape'], path: '/stores/screens', poster: 13,
    what: 'Stores → Platform screens: every Uber Eats, DoorDash and Skip order screen on one wall, 4, 8 then 16 at a time; screens with waiting orders glow.',
    async play(h) {
      h.mark();
      await h.wait(2200);
      const view = (n) => h.page.getByRole('radio', { name: String(n), exact: true }).first();
      await h.tap(view(4)); await h.wait(3800);
      await h.tap(view(8)); await h.wait(4200);
      await h.tap(view(16)); await h.wait(6500);
    },
  },
  {
    key: 'orders-board', n: 3, seconds: 15, views: ['vertical', 'landscape'], path: '/orders', poster: 7,
    what: 'Orders board: every platform and every brand live on one board, filters by status, one order opened.',
    popup: false,
    async play(h) {
      h.mark();
      await h.wait(1500);
      const o = await h.sendOrder('skip', 'DEMO-SKIP-MYTHOS', 'Mythos 2 Go', { items: 2 });
      await h.wait(1800);
      await h.tap(h.page.getByRole('button', { name: /^Prêtes/ }).first()); await h.wait(2200);
      await h.tap(h.page.getByRole('button', { name: /^Toutes/ }).first()); await h.wait(1500);
      await h.scrollBy(380, 1300); await h.wait(900);
      const card = h.page.getByRole('button').filter({ hasText: o.displayId || 'Mythos 2 Go' }).first();
      await h.tap(card); await h.wait(3500);
    },
  },
  {
    key: 'go-live-ring', n: 4, seconds: 15, views: ['vertical'], path: '/settings/go-live', poster: 5,
    what: 'Settings → Go-live: the progress ring fills as each step turns green, then the one-time celebration.',
    staged: 'The demo build runs without a database, so for this shot only the "Supabase database" step answers "connected" (as on a real install).',
    async before(page) {
      await page.route('**/api/foodhub/channels', async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, mode: 'supabase' } });
      });
      await page.route('**/api/foodhub/recon/fees', async (route) => {
        const res = await route.fetch();
        const json = await res.json().catch(() => ({}));
        await route.fulfill({ response: res, json: { ...json, fees: { ...(json.fees ?? {}), confirmed: { uber_eats: true, doordash: true, skip: true } } } });
      });
    },
    // The clip opens while the page loads, so the ring fills and the celebration plays on camera.
    early: (page) => page.getByRole('heading', { name: 'Mise en service' }).first(),
    async play(h) {
      await h.wait(6000);
      await h.scrollBy(520, 1600); await h.wait(1400);
      await h.scrollBy(700, 1800); await h.wait(1300);
      await h.scrollBy(-1220, 1500); await h.wait(2000);
    },
  },
  {
    key: 'autopilot', n: 5, seconds: 15, views: ['vertical'], path: '/settings/autopilot', poster: 3,
    what: 'Settings → Autopilot: everything Food Hub does on its own, each rule in plain words, with its last run; new ones stay off until a manager turns them on.',
    popup: false,
    async play(h) {
      h.mark();
      await h.wait(2000);
      const sw = h.page.getByRole('switch').first();
      await h.tap(sw); await h.wait(2200);
      // Scroll the list, but stop before the "fixed rules" note at the bottom (it names the protected store).
      const note = await h.page.getByText(/Règles fixes/).first().boundingBox();
      const room = note ? Math.max(0, note.y - h.page.viewportSize().height - 80) : 1400;
      await h.scrollBy(Math.min(650, room / 2), 2200); await h.wait(1500);
      await h.scrollBy(Math.min(750, room / 2), 2400); await h.wait(2000);
    },
  },
  {
    key: 'brand-kit', n: 6, seconds: 15, views: ['vertical'], path: '/settings/business', poster: 10,
    // The brand list also shows the protected brand's (deactivated) chip: blurred, it never appears in a clip.
    blur: ['span:has(> button[aria-label^="Apparence de Po Poulet"])'],
    what: 'Settings → Business → brand kit: give a brand its colour and see it live on the order card, in the console and on the dark kitchen screen, then save.',
    popup: false,
    async play(h) {
      h.mark();
      await h.wait(1200);
      const look = h.page.getByRole('button', { name: /Apparence de Cafe Bolon/ }).first();
      await h.scrollTo(look, { offset: 520, ms: 1500 }); await h.wait(500);
      await h.tap(look); await h.wait(1700);
      const hex = h.page.getByPlaceholder('#1565D8').first();
      await h.tap(hex); await h.wait(300);
      await h.page.keyboard.press('Control+A');
      await h.page.keyboard.type('#5e35b1', { delay: 140 });
      await h.wait(3200);
      await h.tap(h.page.getByRole('button', { name: 'Enregistrer', exact: true }).last());
      await h.wait(3500);
    },
  },
  {
    key: 'brand-colours-kitchen', n: 11, seconds: 10, views: ['vertical'], path: '/kitchen', poster: 3,
    what: 'Kitchen screen with the brand kit on: each restaurant brand keeps its own colour stripe, so cooks know at a glance which brand an order belongs to.',
    async play(h) {
      h.mark();
      await h.wait(2000);
      await h.scrollBy(520, 1800); await h.wait(1600);
      await h.scrollBy(-520, 1800); await h.wait(2000);
    },
  },
  {
    key: 'ordering-page', n: 7, seconds: 15, views: ['phone'], path: '/commander/:slug', public: true, poster: 9,
    what: 'A brand’s own ordering page on a phone: menu, make it a meal, add to cart. The order goes straight to the kitchen and into Clover.',
    // The pickup line names the restaurant's street address: blurred for the demo.
    blur: ['header p'],
    async play(h) {
      h.mark();
      await h.wait(1600);
      await h.scrollBy(330, 1300); await h.wait(900);
      await h.tap(h.page.getByText('Pita shish taouk', { exact: true }).first()); await h.wait(1800);
      const trio = h.page.getByText(/Trio/).first();
      if (await trio.isVisible().catch(() => false)) { await h.tap(trio); await h.wait(1200); }
      await h.tap(h.page.getByRole('button', { name: /Ajouter/ }).last()); await h.wait(1600);
      const cartBtn = h.page.getByRole('button', { name: /panier/i }).last();
      if (await cartBtn.isVisible().catch(() => false)) { await h.tap(cartBtn); }
      await h.wait(3000);
    },
  },
  {
    key: 'kitchen-tablet-app', n: 8, seconds: 10, views: ['phone'], path: '/tablette', public: true, poster: 2,
    what: 'The kitchen tablet app page: one download, always on, rings loud, prints each new order.',
    async play(h) {
      h.mark();
      await h.wait(2200);
      await h.scrollBy(420, 1800); await h.wait(1500);
      await h.scrollBy(520, 1800); await h.wait(2500);
    },
  },
  {
    key: 'overview-connections', n: 9, seconds: 15, views: ['vertical', 'landscape'], path: '/', poster: 9, fullView: true,
    what: 'Overview: today’s sales, orders and stores at a glance, then the Connections strip (platforms, Clover, e-mail and texts, screens) all green.',
    staged: 'The demo build runs without a database, so for this shot only the database line of the Connections strip shows the answer of a real install ("La base de données lit et écrit.").',
    popup: false,
    async before(page) {
      await page.route('**/api/health', async (route) => {
        const res = await route.fetch();
        const j = await res.json();
        if (j?.checks?.database) j.checks.database = { status: 'ok', detail: 'Database reads and writes.', detailFr: 'La base de données lit et écrit.' };
        const all = Object.values(j?.checks ?? {}).map((c) => c?.status).filter(Boolean);
        if (j) j.status = all.includes('down') ? 'down' : all.includes('warn') ? 'degraded' : 'ok';
        await route.fulfill({ response: res, json: j });
      });
    },
    async play(h) {
      h.mark();
      await h.wait(2200);
      const more = h.page.getByRole('button', { name: /Voir plus de chiffres/ }).first();
      await h.scrollTo(more, { offset: 240, ms: 1500 }); await h.wait(500);
      await h.tap(more); await h.wait(1500);
      await h.scrollBy(560, 1800); await h.wait(1500);
      await h.scrollBy(560, 1800); await h.wait(3000);
    },
  },
  {
    key: 'sales-insights', n: 10, seconds: 15, views: ['vertical'], path: '/insights?period=today', poster: 3,
    what: 'Reports → Sales and trends: sales, orders, average basket, time to accept, uptime and orders received in Clover, by platform and by brand.',
    popup: false,
    async play(h) {
      h.mark();
      await h.wait(2500);
      await h.scrollBy(600, 2000); await h.wait(1600);
      await h.scrollBy(700, 2200); await h.wait(1600);
      await h.scrollBy(700, 2200); await h.wait(2500);
    },
  },
];

/** Every coach-mark id of the console (lib/help/content.ts), so none pops up during a take. */
const HELP_TIPS = (() => {
  try { return [...fs.readFileSync('lib/help/content.ts', 'utf8').matchAll(/^ {2}'([a-z0-9.-]+)': \{$/gm)].map((m) => m[1]); } catch { return []; }
})();

/** Length of a video in seconds (ffmpeg's "Duration:" line), or null. */
function videoSeconds(bin, file) {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

// ---------------- recorder ----------------
export async function runShots(ctx) {
  const { browser, APP, OUT, ONLY, KEEP_RAW, VERTICAL_ONLY, FF, ffmpeg, forbiddenIn, slug, TZ, call, signIn } = ctx;
  fs.mkdirSync(OUT, { recursive: true });
  const rawDir = path.join(OUT, '_raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const state = await signIn(browser);
  const shots = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.key));
  const made = [];
  const problems = [];
  for (const shot of shots) {
    for (const view of shot.views) {
      if (VERTICAL_ONLY && view === 'landscape') continue;
      const orient = view === 'landscape' ? 'landscape' : 'vertical';
      const name = `${String(shot.n).padStart(2, '0')}-${shot.key}-${shot.seconds}s-${orient}`;
      process.stdout.write(`  ${name} … `);
      try {
        const r = await take(shot, view, name);
        made.push({ ...r, shot, view, orient, name });
        console.log(`ok (${r.file})`);
      } catch (e) {
        problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
      }
      await settle();
    }
  }
  if (!KEEP_RAW) fs.rmSync(rawDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(made.map((m) => ({ file: path.basename(m.file), poster: path.basename(m.poster), seconds: m.shot.seconds, orientation: m.orient, key: m.shot.key, what: m.shot.what, staged: m.shot.staged ?? null })), null, 2));
  console.log(`\n${made.length} clip(s) in ${OUT}${problems.length ? `; ${problems.length} failed:\n  ${problems.join('\n  ')}` : ''}`);
  return problems.length ? 1 : 0;

  /** Every order nobody has looked at yet is marked seen, so one shot's order never pops up in the next one. */
  async function settle() {
    const orders = (await call('GET', '/api/foodhub/orders?limit=500')).json?.orders ?? [];
    for (const o of orders) {
      if (o.status === 'new') await call('POST', `/api/foodhub/orders/${o.id}`, { body: { action: 'accept' } });
      if (['new', 'accepted'].includes(o.status) && !o.timeline?.seenAt) await call('POST', `/api/foodhub/orders/${o.id}`, { body: { action: 'ack' } });
    }
  }

  async function take(shot, view, name) {
    const v = VIEW[view];
    const context = await browser.newContext({
      viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor, isMobile: v.isMobile ?? false, hasTouch: v.hasTouch ?? false,
      locale: 'fr-CA', timezoneId: TZ, storageState: shot.public ? undefined : state, colorScheme: 'light', reducedMotion: 'no-preference',
      recordVideo: { dir: rawDir, size: v.size },
    });
    // The owner's "full view" (Connections strip, store grid) for the shots that show it.
    if (shot.fullView) await context.addCookies([{ name: 'fh_view', value: 'full', url: APP }]);
    // Nothing but this machine: every other host is refused.
    await context.route('**/*', (route) => { const u = new URL(route.request().url()); return ['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:' ? route.continue() : route.abort(); });
    await context.addInitScript(TOUCH_RING);
    if (shot.blur?.length) {
      await context.addInitScript((css) => {
        const add = () => { const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st); };
        if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
      }, shot.blur.map((sel) => `${sel}{filter:blur(8px)!important}`).join(''));
    }
    await context.addInitScript(([popup, seen]) => {
      try {
        sessionStorage.setItem('takatak.bar.memory', '1');
        // Welcome already done and every coach mark already seen: the everyday console, no tips over the shot.
        for (const who of ['matthieu', 'owner']) localStorage.setItem(`takatak.help.v1:${who}`, JSON.stringify({ welcomed: true, seen, toursDone: [] }));
        localStorage.setItem('takatak.alerts.v1', JSON.stringify({ sound: false, popup, repeatSec: 3, desktop: false, volume: 1, loud: true }));
        localStorage.setItem('takatak.screens.wall.v1', JSON.stringify({ view: '4', page: 0, order: [], custom: [], tab: null }));
      } catch { /* private mode */ }
    }, [shot.popup !== false, HELP_TIPS]);
    const page = await context.newPage();
    const opened = Date.now();
    let start = null;
    let closed = Date.now();
    const watch = { timer: null, hits: new Set(), notes: new Set(), check: async () => {
      const text = await page.evaluate(visibleText).catch(() => '');
      for (const x of forbiddenIn(text)) watch.hits.add(x);
      if (/\b24\s?h\b|24\s?\/\s?7|24\s?heures/i.test(text)) watch.notes.add('"24 h"');
    } };
    try {
      if (shot.before) await shot.before(page);
      const target = shot.path.replace(':slug', slug);
      if (shot.early) {
        // The clip opens as soon as the page shows (entrance animations on camera).
        await page.goto(`${APP}${target}`, { waitUntil: 'commit', timeout: 30000 });
        await shot.early(page).waitFor({ state: 'visible', timeout: 20000 });
        start = Date.now() - 250;
      } else {
        await page.goto(`${APP}${target}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => Promise.race([
          Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
          new Promise((r) => setTimeout(r, 2500)),
        ]));
        if (shot.loaded) await shot.loaded(page);
        await page.waitForTimeout(600);
      }
      // What is ON SCREEN is read every 0.4 s for the whole take; one forbidden value refuses the clip.
      await watch.check();
      watch.timer = setInterval(() => { watch.check().catch(() => {}); }, 400);
      const h = helpers(page, { ...ctx, mark: (at = Date.now()) => { start = at; } });
      await shot.play(h, view);
      if (start === null) throw new Error('the timeline never marked its start');
      const left = start + shot.seconds * 1000 + 500 - Date.now();
      if (left > 0) await page.waitForTimeout(left);
      await watch.check();
    } finally {
      clearInterval(watch.timer);
      closed = Date.now();
      await context.close();
    }
    if (watch.hits.size) throw new Error(`refused: the screen showed ${[...watch.hits].join(', ')}`);
    if (watch.notes.size) console.log(`\n    note: the screen showed ${[...watch.notes].join(', ')} — check the clip`);
    const raw = await page.video()?.path();
    if (!raw || !fs.existsSync(raw)) throw new Error('no video recorded');
    // Where the clip starts in the raw take: the take ends when the context closes, so its start is "closed - length".
    const rawSeconds = videoSeconds(FF, raw);
    const videoStart = rawSeconds ? closed - rawSeconds * 1000 : opened;
    const file = path.join(OUT, `${name}.mp4`);
    const poster = path.join(OUT, `${name}.png`);
    const ss = Math.max(0, (start - videoStart) / 1000);
    ffmpeg(FF, ['-ss', ss.toFixed(3), '-i', raw, '-t', String(shot.seconds), '-an', '-vf', `fps=30,scale=${v.size.width}:${v.size.height}:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-movflags', '+faststart', file]);
    ffmpeg(FF, ['-ss', String(Math.min(shot.poster ?? 1, shot.seconds - 0.5)), '-i', file, '-frames:v', '1', poster]);
    const fresh = path.join(path.dirname(raw), `${name}.webm`);
    if (KEEP_RAW) fs.renameSync(raw, fresh); else fs.rmSync(raw, { force: true });
    return { file, poster };
  }

}

/** The text that is on screen right now: every text node with a visible box inside the viewport (form values too). */
function visibleText() {
  const out = [];
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    let blurred = false; // text under a blur filter cannot be read on screen
    for (let a = el; a && a !== document.body; a = a.parentElement) if (/blur\(/.test(getComputedStyle(a).filter)) { blurred = true; break; }
    if (blurred) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    if ([...range.getClientRects()].some(inView)) out.push(n.textContent);
  }
  for (const i of document.querySelectorAll('input, textarea')) if (i.value && inView(i.getBoundingClientRect())) out.push(i.value);
  return out.join('\n');
}
