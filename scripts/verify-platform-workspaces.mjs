// Local browser acceptance: real built Food Hub, 54 synthetic tablet sessions,
// provider switching, hidden waiting alerts, scoped navigation and mobile layout.
// No provider sign-in or real orders. Run after npm run build.
// Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
// Optional: FOODHUB_WORKSPACE_SCREENSHOTS=/absolute/output/folder
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.FOODHUB_WORKSPACE_PORT || 4808);
const app = `http://127.0.0.1:${port}`;
const password = crypto.randomBytes(24).toString('hex');
const token = crypto.randomBytes(24).toString('hex');
const session = crypto.randomBytes(32).toString('hex');
const shots = process.env.FOODHUB_WORKSPACE_SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
let checks = 0;
const passed = (name) => { checks++; console.log(`PASS ${name}`); };
const relay = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html lang="en"><title>Synthetic tablet</title><body><h1>Local test tablet</h1><p>No provider account connected.</p></body></html>');
});
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
const relayUrl = `http://127.0.0.1:${relay.address().port}`;
// Only the local demo configuration goes into the app. Do not inherit deployment
// credentials that could accidentally enable email, sync or other provider calls.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  FOODHUB_FORCE_MEMORY: 'true', FOODHUB_PUBLIC_URL: app,
  LIVE_CONNECTORS_GLOBAL_ENABLED: 'false', DASHBOARD_PASSWORD: password,
  SESSION_SECRET: session, FOODHUB_SCREENS_AGENT_TOKEN: token,
};
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (data) => { serverLog = (serverLog + data).slice(-16000); });
server.stderr.on('data', (data) => { serverLog = (serverLog + data).slice(-16000); });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Food Hub exited before startup');
    try { if ((await fetch(`${app}/login`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, 'Food Hub did not start');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'en-CA' });
  await context.addInitScript(() => {
    localStorage.setItem('takatak.help.v1:owner', JSON.stringify({ welcomed: true, seen: [], toursDone: [] }));
    localStorage.setItem('takatak.screens.wall.v1', JSON.stringify({ view: 'list', order: [], page: 0, tab: null, custom: [] }));
  });
  const login = await context.request.post(`${app}/api/foodhub/auth/login`, { data: { username: 'owner', password } });
  assert(login.ok(), `Local recovery login: ${login.status()}`);
  const wrongProvider = await context.request.post(`${app}/api/foodhub/recon/imports`, { data: {
    fileName: 'synthetic-uber.csv', channel: 'doordash', contentBase64: Buffer.from(
      'Order ID,Workflow ID,Order Status,Order Date,Payout Date,Sales (excluding tax),Tax on Sales,Marketplace fee,Tax on Marketplace fee,Total payout\nA1,wf-1,Completed,2026-10-01,2026-10-08,20,2.99,-5,-0.75,17.24',
    ).toString('base64'),
  } });
  assert.equal(wrongProvider.status(), 400, 'A statement cannot be relabeled as another provider');
  assert.match((await wrongProvider.json()).error, /Uber Eats.*DoorDash/);
  const imports = await (await context.request.get(`${app}/api/foodhub/recon/imports`)).json();
  assert.equal(imports.imports.length, 0, 'Rejected statement creates no import');
  passed('real HTTP statement import rejects Uber data selected as DoorDash without saving it');
  const catalog = await (await context.request.get(`${app}/api/foodhub/catalog`)).json();
  const location = catalog.locations.find((l) => l.active).code;
  const setup = { baseUrl: relayUrl, locationCode: location, counts: { doordash: 18, ubereats: 18, skip: 18 } };
  const created = await (await context.request.post(`${app}/api/foodhub/screens/setup`, { data: setup })).json();
  assert.equal(created.created, 54);
  const repeated = await (await context.request.post(`${app}/api/foodhub/screens/setup`, { data: setup })).json();
  assert.equal(repeated.created, 0); assert.equal(repeated.kept.length, 54);
  passed('54 independent tablet records; repeated setup preserves accounts');
  const list = await (await context.request.get(`${app}/api/foodhub/screens`)).json();
  const report = { screens: list.screens.map((s) => ({ id: s.id, state: 'ok', waiting: s.id === 's37' ? 2 : 0 })) };
  const heartbeat = await context.request.post(`${app}/api/foodhub/screens/heartbeat`, { headers: { authorization: `Bearer ${token}` }, data: report });
  assert(heartbeat.ok());
  assert.equal((await heartbeat.json()).commands.length, 54);
  passed('authenticated relay heartbeat reports every screen and receives initial commands');

  const page = await context.newPage();
  await page.goto(`${app}/stores/screens`, { waitUntil: 'networkidle' });
  const workspace = page.getByRole('group', { name: /^(Workspace|Espace de travail)$/ });
  await expect(workspace).toBeVisible();
  await page.getByRole('button', { name: /^(Préparer les écrans|Set up screens)$/ }).click();
  const setupDialog = page.getByRole('dialog');
  const counts = setupDialog.locator('input[type="number"]');
  for (let i = 0; i < 3; i++) await expect(counts.nth(i)).toHaveValue('0');
  await expect(setupDialog.getByRole('button', { name: /^(Créer 0 écran\(s\)|Create 0 screen\(s\))$/ })).toBeDisabled();
  await setupDialog.getByRole('button', { name: /^(Annuler|Cancel)$/ }).click();
  passed('existing 54-account setup proposes no duplicate sessions');
  for (const [name, channel] of [['DoorDash', 'doordash'], ['Uber Eats', 'uber_eats'], ['Skip', 'skip']]) {
    await workspace.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`channel=${channel}`));
    await expect(workspace.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/18 (of 54 screens shown|écran\(s\) affiché\(s\) sur 54)/)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(18);
    if (shots && channel === 'doordash') await page.screenshot({ path: path.join(shots, 'tablets-doordash-18.png'), fullPage: true });
    passed(`${name} workspace shows its 18 tablets without requiring API store mappings`);
  }
  await workspace.getByRole('button', { name: 'DoorDash', exact: true }).click();
  // Waiting on another platform must remain visible, and jumping must change the
  // workspace rather than reassign or log out any account.
  await page.getByRole('button', { name: 'SkipTheDishes 1 (2)', exact: true }).click();
  await expect(page).toHaveURL(/channel=skip/);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('src', `${relayUrl}/s37/`);
  passed('a hidden Skip waiting alert opens the correct session from DoorDash');
  await workspace.getByRole('button', { name: 'Food Hub', exact: true }).click();
  await expect(page).not.toHaveURL(/channel=/);
  await page.getByRole('radio', { name: /^(Liste|List)$/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(54);
  passed('unified workspace restores all 54 accounts');

  await workspace.getByRole('button', { name: 'DoorDash', exact: true }).click();
  const orderLink = page.getByRole('navigation', { name: /^(Main menu|Menu principal)$/ }).getByRole('link', { name: /^(Orders|Commandes)$/ });
  await orderLink.click();
  await expect(page).toHaveURL(/\/orders\?.*channel=doordash/);
  await page.reload();
  await expect(workspace.getByRole('button', { name: 'DoorDash', exact: true })).toHaveAttribute('aria-pressed', 'true');
  passed('workspace selection follows navigation and reload');
  await page.goto(`${app}/money/tgtg?channel=doordash`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/Le journal de sacs appartient à Too Good To Go\.|The bag log belongs to Too Good To Go\./)).toBeVisible();
  passed('a dedicated TGTG workflow cannot show under a different provider');

  async function lateResponseCheck(screenPath, endpoint, update, currentText, staleText) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const pending = new Promise((resolve) => { started = resolve; });
    const pattern = `**/api/foodhub/${endpoint}?*`;
    await page.route(pattern, async (route) => {
      const channel = new URL(route.request().url()).searchParams.get('channels');
      const response = await route.fetch();
      const json = await response.json();
      update(json, channel);
      if (channel === 'doordash') { started(); await gate; }
      await route.fulfill({ response, json });
    });
    try {
      await page.goto(`${app}${screenPath}?channel=doordash`, { waitUntil: 'domcontentloaded' });
      await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error(`No scoped ${endpoint} request`)), 15000))]);
      await workspace.getByRole('button', { name: 'Skip', exact: true }).click();
      await expect(page.getByText(currentText, { exact: true }).filter({ visible: true })).toHaveCount(1);
      const arrived = page.waitForResponse((response) => response.url().includes(`/api/foodhub/${endpoint}?`) && new URL(response.url()).searchParams.get('channels') === 'doordash');
      release();
      await (await arrived).finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByText(currentText, { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText(staleText, { exact: true })).toHaveCount(0);
      passed(`${endpoint} ignores a late DoorDash response after switching to Skip`);
    } finally {
      release();
      // Poll/refresh requests can still be fulfilling here. Wait for their handlers
      // before removing interception, rather than aborting an in-flight route.
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
  await lateResponseCheck('/', 'command', (json, channel) => {
    json.kpis.deliveryOrders = channel === 'doordash' ? 99334455 : 88442211;
  }, '88442211', '99334455');
  await lateResponseCheck('/orders', 'orders', (json, channel) => {
    const marker = channel === 'doordash' ? 'STALE-DD' : 'CURRENT-SKIP';
    json.orders = [{ id: marker, displayId: marker, externalOrderId: marker, channel: channel || 'skip',
      status: 'new', locationCode: location, brandName: 'Synthetic test', createdAt: new Date().toISOString(),
      total: 10, subtotal: 10, tax: 0, fulfillment: 'pickup', lines: [], timeline: {}, actions: [] }];
  }, '#CURRENT-SKIP', '#STALE-DD');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1050 });
    await expect(workspace.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
    // Wait for the shell's responsive rail/padding transition after resizing.
    // A stationary overflow still fails the check.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5000 }).toBeLessThanOrEqual(width + 1);
    const scan = await new AxeBuilder({ page }).include('[aria-label="Espace de travail"], [aria-label="Workspace"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    assert.deepEqual(scan.violations.filter((v) => ['serious', 'critical'].includes(v.impact)), [], `workspace accessibility at ${width}`);
    if (shots) await page.screenshot({ path: path.join(shots, `workspace-${width}.png`), fullPage: true });
    passed(`workspace controls fit ${width}px and pass serious/critical WCAG checks`);
  }
  await context.close();
  console.log(`${checks} browser acceptance checks passed`);
} catch (error) {
  if (shots) {
    const failedPage = browser?.contexts()[0]?.pages()[0];
    if (failedPage) await failedPage.screenshot({ path: path.join(shots, 'workspace-failure.png'), fullPage: true }).catch(() => undefined);
  }
  console.error(error.stack || error);
  // Never print the app's full environment or generated secrets.
  console.error(serverLog.replaceAll(password, '[redacted]').replaceAll(token, '[redacted]').replaceAll(session, '[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((resolve) => relay.close(resolve));
}
