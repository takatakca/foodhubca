// Built ON2GO + built Food Hub in a real browser, with an isolated local SMS transport.
// Run after building BOTH repositories. No real texts, provider accounts or deployment.
// The browser keeps the production origins so Food Hub's actual CORS checks still run;
// Playwright forwards those requests exclusively to the two local builds.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';
import { startRestProxy } from './e2e/postgrest.mjs';
import { runOrderingJourney } from './e2e/on2go-ordering-journey.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const on2go = path.resolve(process.env.ON2GO_WORKSPACE_ROOT || path.join(root, '../on2goca'));
const hubPort = Number(process.env.ON2GO_BRIDGE_HUB_PORT || 4891);
const sitePort = Number(process.env.ON2GO_BRIDGE_SITE_PORT || 4892);
const hub = `http://127.0.0.1:${hubPort}`;
const site = `http://127.0.0.1:${sitePort}`;
const output = process.env.ON2GO_BRIDGE_OUTPUT;
const ordering = process.env.ON2GO_BRIDGE_ORDERING === 'true';
const database = process.env.ON2GO_BRIDGE_POSTGREST_URL;
const databaseKey = process.env.ON2GO_BRIDGE_SERVICE_KEY;
assert(Boolean(database) === Boolean(databaseKey), 'Set both local PostgREST URL and service key, or neither.');
if (database) {
  const url = new URL(database);
  assert(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only an isolated loopback PostgREST database is allowed.');
}
if (output) fs.mkdirSync(output, { recursive: true });
assert(fs.existsSync(path.join(root, '.next/BUILD_ID')), 'Build Food Hub first.');
assert(fs.existsSync(path.join(on2go, 'out/connexion/index.html')), 'Build/export ON2GO first.');
const phone = '+15145559911';
let smsCode;
let texts = 0;
let verificationTexts = 0;
let cloverOrders = 0;
let kitchenTickets = 0;
const sms = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/clover/')) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { /* response below */ }
    let answer = {};
    if (url.pathname.endsWith('/atomic_order/orders') && req.method === 'POST') { cloverOrders++; assert(body.orderCart?.lineItems?.length); answer = { id: `LOCAL-CLOVER-${cloverOrders}` }; }
    else if (url.pathname.endsWith('/print_event') && req.method === 'POST') { kitchenTickets++; answer = { id: `LOCAL-TICKET-${kitchenTickets}` }; }
    else if (url.pathname.endsWith('/devices')) answer = { elements: [{ id: 'LOCAL-PRINTER' }] };
    else if (url.pathname.endsWith('/order_types')) answer = { elements: [] };
    else { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer)); return;
  }
  if (req.method !== 'POST' || !req.url.endsWith('/Messages.json')) { res.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  smsCode = new URLSearchParams(body).get('Body')?.match(/\b\d{6}\b/)?.[0];
  if (smsCode) verificationTexts++;
  texts++;
  res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ sid: `SM-local-${texts}` }));
});
await new Promise((resolve) => sms.listen(0, '127.0.0.1', resolve));
const children = [];
let log = '';
function start(cwd, args, extra = {}) {
  // Explicit allowlist: never inherit real service secrets or enable external connectors.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...extra };
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data) => { log = (log + data).slice(-12000); });
  child.stderr.on('data', (data) => { log = (log + data).slice(-12000); });
  children.push(child);
  return child;
}
const results = [];
const passed = (name) => { results.push(name); console.log(`PASS ${name}`); };
let browser;
let rest;
let orderingProof;
try {
  if (database) rest = await startRestProxy({ target: database, port: Number(process.env.ON2GO_BRIDGE_REST_PROXY_PORT || 4893) });
  const hubEnvironment = {
    ...(rest ? { NEXT_PUBLIC_SUPABASE_URL: rest.url, SUPABASE_SERVICE_ROLE_KEY: databaseKey } : { FOODHUB_FORCE_MEMORY: 'true' }),
    FOODHUB_PUBLIC_URL: 'https://foodhub.on2go.ca',
    LIVE_CONNECTORS_GLOBAL_ENABLED: 'false', DASHBOARD_PASSWORD: crypto.randomBytes(24).toString('hex'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    TWILIO_ACCOUNT_SID: 'AC_local_only', TWILIO_AUTH_TOKEN: 'local-only', TWILIO_FROM: '+15145550000',
    TWILIO_BASE_URL: `http://127.0.0.1:${sms.address().port}`,
    ...(ordering ? {
      CLOVER_BASE_URL: `http://127.0.0.1:${sms.address().port}/clover`, CLOVER_MERCHANT_ID: 'LOCAL-MERCHANT', CLOVER_ACCESS_TOKEN: 'local-only',
      FOODHUB_CLOVER_AUTOPRINT: 'true', CLOVER_PRINT_DEVICE_ID: 'LOCAL-PRINTER', FOODHUB_WATCH_INTERVAL_S: '0',
    } : {}),
  };
  let app = start(root, ['node_modules/next/dist/bin/next', 'start', '-p', String(hubPort), '-H', '127.0.0.1'], hubEnvironment);
  start(on2go, ['scripts/serve.mjs', 'out', String(sitePort)]);
  for (const url of [`${hub}/hub`, `${site}/connexion/`]) {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (children.some((child) => child.exitCode !== null)) throw new Error('Local server exited.');
      try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, `Local server not ready: ${url}`);
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  const network = [];
  let dropCheckout = false;
  async function context() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CA' });
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const local = url.origin === 'https://on2go.ca' ? site : url.origin === 'https://foodhub.on2go.ca' ? hub : null;
      if (!local) { await route.abort(); return; }
      try {
        const response = await route.fetch({ url: `${local}${url.pathname}${url.search}`, maxRedirects: 0 });
        if (url.pathname.startsWith('/api/public/on2go/') || url.pathname.startsWith('/api/storefront/')) network.push({ path: url.pathname, method: route.request().method(), status: response.status() });
        if (dropCheckout && url.pathname === '/api/storefront/checkout' && response.ok()) { dropCheckout = false; await route.abort('failed'); return; }
        await route.fulfill({ response });
      } catch { await route.abort(); }
    });
    return ctx;
  }
  async function signIn(page) {
    smsCode = undefined;
    await page.goto('https://on2go.ca/connexion/', { waitUntil: 'networkidle' });
    await page.locator('input[name="contact"]').fill(phone);
    await page.locator('form').filter({ has: page.locator('input[name="contact"]') }).locator('button[type="submit"]').click();
    await expect(page.locator('input[name="code"]')).toBeVisible();
    assert(smsCode, 'Real Food Hub code must reach the isolated SMS transport.');
    await page.locator('input[name="code"]').fill(smsCode);
    await page.waitForFunction(() => Boolean(localStorage.getItem('on2go_customer_v1')));
  }
  async function me(page) {
    return page.evaluate(async () => {
      const session = JSON.parse(localStorage.getItem('on2go_customer_v1'));
      const response = await fetch('https://foodhub.on2go.ca/api/public/on2go/me', { headers: { authorization: `Bearer ${session.token}` }, credentials: 'omit' });
      if (!response.ok) throw new Error(`Customer read failed: ${response.status}`);
      return response.json();
    });
  }
  const first = await context();
  const page = await first.newPage();
  await signIn(page);
  passed('actual ON2GO SMS form signs in through the actual Food Hub verification routes');
  await page.goto('https://on2go.ca/', { waitUntil: 'networkidle' });
  const save = page.getByRole('button', { name: /^Enregistrer ce restaurant/ }).first();
  await expect(save).toBeVisible();
  await save.click();
  await expect.poll(async () => (await me(page)).favourites.length).toBe(1);
  passed('restaurant saved in ON2GO persists to Food Hub, through CORS and the customer token');
  await page.goto('https://on2go.ca/compte/adresses/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Ajouter une adresse/ }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('123 rue Exemple');
  await page.getByLabel('Ville', { exact: true }).fill('Montréal');
  await page.getByLabel('Code postal', { exact: true }).fill('H4A1E1');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(async () => (await me(page)).addresses.length).toBe(1);
  assert.equal((await me(page)).addresses[0].postalCode, 'H4A 1E1');
  passed('structured Canadian address saves from the form with server-normalized postal code');
  await page.goto('https://on2go.ca/compte/preferences/', { waitUntil: 'networkidle' });
  await page.getByLabel('Offres et nouveautés par courriel', { exact: true }).check();
  await expect.poll(async () => (await me(page)).preferences.offersEmail).toBe(true);
  assert.equal((await me(page)).preferences.offersSms, false);
  passed('email preference persists independently while SMS marketing remains off');
  const second = await context();
  const otherPage = await second.newPage();
  await signIn(otherPage);
  await otherPage.goto('https://on2go.ca/compte/adresses/', { waitUntil: 'networkidle' });
  await expect(otherPage.getByText('123 rue Exemple', { exact: false })).toBeVisible();
  assert.equal((await me(otherPage)).favourites.length, 1);
  await otherPage.goto('https://on2go.ca/compte/preferences/', { waitUntil: 'networkidle' });
  await expect(otherPage.getByLabel('Offres et nouveautés par courriel', { exact: true })).toBeChecked();
  await expect(otherPage.getByLabel('Offres et nouveautés par texto', { exact: true })).not.toBeChecked();
  passed('a second empty browser signs in again and recovers server-side account data');
  if (ordering) {
    const admin = await browser.newContext();
    const login = await admin.request.post(`${hub}/api/foodhub/auth/login`, { data: { username: 'owner', password: hubEnvironment.DASHBOARD_PASSWORD } });
    assert(login.ok(), 'Local owner fixture login must succeed.');
    const put = async (endpoint, data) => {
      const response = await admin.request.put(`${hub}${endpoint}`, { data });
      assert(response.ok(), `Local fixture ${endpoint}: ${response.status()} ${await response.text()}`);
      return response.json();
    };
    const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => [day, [{ open: '00:00', close: '23:59' }]]));
    await put('/api/foodhub/hours', { hours: { locations: { NDG_MAIN: week }, brands: {}, holidays: [] } });
    const menu = {
      brandName: 'Pi Pita', categories: [{ ref: 'main', name: 'Mains', nameFr: 'Plats', sortOrder: 0 }],
      items: [{ ref: 'pita-local', name: 'Chicken pita', nameFr: 'Pita au poulet', categoryRef: 'main', price: 12.5, available: true, modifierGroupRefs: ['size', 'extra'] }],
      modifierGroups: [
        { ref: 'size', name: 'Size', nameFr: 'Format', min: 1, max: 1, modifiers: [{ ref: 'regular', name: 'Regular', nameFr: 'Régulier', price: 0, available: true }] },
        { ref: 'extra', name: 'Extras', min: 0, max: 2, modifiers: [{ ref: 'cheese', name: 'Cheese', nameFr: 'Fromage', price: 1, available: true }] },
      ],
    };
    await put('/api/foodhub/menu', { menu });
    await put('/api/foodhub/storefront/settings', { enabled: true, brands: { 'Pi Pita': { slug: 'pi-pita', enabled: true, locationCode: 'NDG_MAIN', payOnline: false, payAtPickup: true, pickupMaxTotal: 200 } } });
    const readOrders = async () => {
      const response = await admin.request.get(`${hub}/api/foodhub/delivery?days=1`);
      assert(response.ok()); return (await response.json()).orders;
    };
    orderingProof = await runOrderingJourney({
      page, passed, readOrders, phone, output,
      modifyMenu: async () => { menu.items[0].price = 16; await put('/api/foodhub/menu', { menu }); },
      dropNextCheckoutResponse: () => { dropCheckout = true; },
    });
    assert.equal(cloverOrders, 1, 'Response loss/retry must not create another Clover order.');
    assert.equal(kitchenTickets, 1, 'Response loss/retry must print one kitchen ticket.');
    const receipt = (await me(page)).orders[0];
    assert.equal(receipt.total, orderingProof.confirmedTotal);
    assert.equal(receipt.subtotal, 17);
    assert.equal(receipt.items[0].total, 17);
    assert.equal(receipt.items[0].modifiers[1]?.name || receipt.items[0].modifiers[0]?.name, 'Cheese');
    passed('the retry produces exactly one actual local Clover call, one kitchen ticket and one authenticated receipt with server totals');
    await admin.close();
  }
  if (rest) {
    const exited = new Promise((resolve) => app.once('exit', resolve));
    app.kill('SIGTERM');
    await exited;
    app = start(root, ['node_modules/next/dist/bin/next', 'start', '-p', String(hubPort), '-H', '127.0.0.1'], hubEnvironment);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      assert(app.exitCode === null, 'Restarted Food Hub exited.');
      try { if ((await fetch(`${hub}/hub`)).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, 'Food Hub must restart on the same database.');
    const restored = await me(otherPage);
    assert.equal(restored.addresses[0].street, '123 rue Exemple');
    assert.equal(restored.favourites.length, 1);
    assert.deepEqual(restored.preferences, { orderUpdates: true, offersSms: false, offersEmail: true });
    await otherPage.reload({ waitUntil: 'networkidle' });
    await expect(otherPage.getByLabel('Offres et nouveautés par courriel', { exact: true })).toBeChecked();
    passed('account data and the existing customer token survive a real Food Hub process restart on Postgres');
  }
  assert.equal(verificationTexts, 2, 'Only two local verification texts should be sent.');
  assert.equal(texts, ordering ? 3 : 2, 'Only verification texts and one order confirmation should be sent.');
  assert(network.some((r) => r.path.endsWith('/me/addresses') && r.method === 'PUT' && r.status === 200));
  assert(network.some((r) => r.path.endsWith('/me/favourites') && r.method === 'PUT' && r.status === 200));
  assert(!network.some((r) => r.path.startsWith('/api/public/on2go/') && r.status >= 400), 'No account request may silently fail.');
  if (output) {
    await otherPage.screenshot({ path: path.join(output, 'account-persistence-desktop.png'), fullPage: true });
    await otherPage.setViewportSize({ width: 390, height: 844 });
    await otherPage.screenshot({ path: path.join(output, 'account-persistence-mobile.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ mode: 'local-built-apps-with-isolated-sms', database: rest ? 'local-postgres-postgrest' : 'ephemeral-memory', durablePersistenceVerified: Boolean(rest), passed: results.length, results, network, orderingProof, cloverOrders, kitchenTickets, externalTexts: 0, deploymentVerified: false }, null, 2));
  }
  console.log(`${results.length} cross-repository browser checks passed; no real texts or deployed services used.`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-6000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  await new Promise((resolve) => sms.close(resolve));
  await rest?.close();
}
