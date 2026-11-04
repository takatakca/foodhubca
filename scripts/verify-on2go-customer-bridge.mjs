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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const on2go = path.resolve(process.env.ON2GO_WORKSPACE_ROOT || path.join(root, '../on2goca'));
const hubPort = Number(process.env.ON2GO_BRIDGE_HUB_PORT || 4891);
const sitePort = Number(process.env.ON2GO_BRIDGE_SITE_PORT || 4892);
const hub = `http://127.0.0.1:${hubPort}`;
const site = `http://127.0.0.1:${sitePort}`;
const output = process.env.ON2GO_BRIDGE_OUTPUT;
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
const sms = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/Messages.json')) { res.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  smsCode = new URLSearchParams(body).get('Body')?.match(/\b\d{6}\b/)?.[0];
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
try {
  if (database) rest = await startRestProxy({ target: database, port: Number(process.env.ON2GO_BRIDGE_REST_PROXY_PORT || 4893) });
  const hubEnvironment = {
    ...(rest ? { NEXT_PUBLIC_SUPABASE_URL: rest.url, SUPABASE_SERVICE_ROLE_KEY: databaseKey } : { FOODHUB_FORCE_MEMORY: 'true' }),
    FOODHUB_PUBLIC_URL: 'https://foodhub.on2go.ca',
    LIVE_CONNECTORS_GLOBAL_ENABLED: 'false', DASHBOARD_PASSWORD: crypto.randomBytes(24).toString('hex'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    TWILIO_ACCOUNT_SID: 'AC_local_only', TWILIO_AUTH_TOKEN: 'local-only', TWILIO_FROM: '+15145550000',
    TWILIO_BASE_URL: `http://127.0.0.1:${sms.address().port}`,
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
  async function context() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CA' });
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const local = url.origin === 'https://on2go.ca' ? site : url.origin === 'https://foodhub.on2go.ca' ? hub : null;
      if (!local) { await route.abort(); return; }
      try {
        const response = await route.fetch({ url: `${local}${url.pathname}${url.search}`, maxRedirects: 0 });
        if (url.pathname.startsWith('/api/public/on2go/')) network.push({ path: url.pathname, method: route.request().method(), status: response.status() });
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
  assert.equal(texts, 2, 'Only two local mock texts should be sent.');
  assert(network.some((r) => r.path.endsWith('/me/addresses') && r.method === 'PUT' && r.status === 200));
  assert(network.some((r) => r.path.endsWith('/me/favourites') && r.method === 'PUT' && r.status === 200));
  assert(!network.some((r) => r.status >= 400), 'No account request may silently fail.');
  if (output) {
    await otherPage.screenshot({ path: path.join(output, 'account-persistence-desktop.png'), fullPage: true });
    await otherPage.setViewportSize({ width: 390, height: 844 });
    await otherPage.screenshot({ path: path.join(output, 'account-persistence-mobile.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ mode: 'local-built-apps-with-isolated-sms', database: rest ? 'local-postgres-postgrest' : 'ephemeral-memory', durablePersistenceVerified: Boolean(rest), passed: results.length, results, network, externalTexts: 0, deploymentVerified: false }, null, 2));
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
