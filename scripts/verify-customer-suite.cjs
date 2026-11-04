#!/usr/bin/env node
// Actual local app HTTP + durable PostgreSQL proof. Fictional fixtures only; never reads live credentials or writes production.
// Prerequisites: docker (cached postgres:16), built sibling LOY4LTY/REW4RD apps, local npm dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const apps = [
  { key: 'loy4lty', repo: path.resolve(process.env.CUSTOMER_SUITE_LOYALTY_REPO || path.join(root, '../LOY4LTY')), route: '/api/loyalty/customer-balance', schema: 'loyalty_proof' },
  { key: 'rew4rd', repo: path.resolve(process.env.CUSTOMER_SUITE_REWARDS_REPO || path.join(root, '../REW4RD')), route: '/api/cards/customer-balances', schema: 'rewards_proof' },
];
const { Pool } = createRequire(path.join(apps[0].repo, 'package.json'))('pg');
const runId = crypto.randomBytes(6).toString('hex');
const container = `customer-suite-proof-${runId}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-suite-proof-'));
const MID = 'MERCHANT0001'; const OTHER = 'MERCHANT0002'; const PHONE = '+15145550101';
const ref = (mid, phone) => crypto.createHash('sha256').update(`${mid}:${phone}`).digest('hex').slice(0, 32);
const password = crypto.randomBytes(24).toString('hex');
// Preserve tool/runtime networking and CA trust without inheriting any application/provider credentials.
function fixtureEnv() {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CODEX_PROXY_CERT'];
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password };
for (const k of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[k];
const docker = (...args) => {
  const r = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding: 'utf8', env: dockerEnv });
  if (r.status !== 0) throw new Error(`Local Docker command failed: ${args[0]}`);
  return r.stdout.trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function waitFor(fn, ms = 40_000) { const until = Date.now() + ms; while (Date.now() < until) { try { if (await fn()) return; } catch {} await sleep(200); } throw new Error('Local service readiness timeout'); }
function signed(app, extra = {}, now = Date.now()) {
  const body = JSON.stringify({ version: 1, app: app.key, purpose: 'customer.balance.read', requestId: crypto.randomUUID(), tenant: 'on2go', merchantId: MID, customerRef: ref(MID, PHONE), ...extra });
  const t = Math.floor(now / 1000);
  return { body, headers: { 'Content-Type': 'application/json', 'X-Takatak-App': 'foodhub', 'X-Takatak-Signature': `t=${t},v1=${crypto.createHmac('sha256', app.secret).update(`${t}.${body}`).digest('hex')}` } };
}
async function post(app, input = signed(app)) { const r = await fetch(app.url + app.route, { method: 'POST', ...input, signal: AbortSignal.timeout(5000) }); return { status: r.status, data: await r.json() }; }
async function start(app) {
  const log = fs.openSync(path.join(work, app.key + '.log'), 'a');
  app.child = spawn(process.execPath, ['.next/standalone/server.js'], { cwd: app.repo,
    env: { ...fixtureEnv(), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(app.port), DATABASE_URL: app.dbUrl,
      FOODHUB_URL: 'http://127.0.0.1:5990', FOODHUB_SUITE_SECRET: app.secret, FOODHUB_CUSTOMER_SUITE_MERCHANTS: JSON.stringify({ on2go: MID }),
      APP_BASE_URL: app.url, CLOVER_API_BASE: 'http://127.0.0.1:9', CLOVER_CLIENT_SECRET: 'synthetic-local-app-secret',
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'), TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', log, log] });
  fs.closeSync(log);
  await waitFor(async () => [200, 403].includes((await post(app)).status));
}
async function stop(app) {
  const child = app.child;if (!child || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  app.child = null;
}
async function seed(app) {
  const query = (sql, args) => app.pool.query(sql, args);
  const put = (collection, id, mid, data) => query('INSERT INTO app_docs(collection,id,merchant_id,at,data) VALUES($1,$2,$3,now(),$4)', [collection, id, mid, JSON.stringify(data)]);
  for (const mid of [MID, OTHER]) await put('_merchants', mid, mid, { merchantId: mid, name: 'Demo restaurant', status: 'active', accessToken: 'unusable-synthetic-fixture', installedAt: new Date().toISOString(), billing: null });
  if (app.key === 'loy4lty') {
    for (const [mid, points] of [[MID, 37], [OTHER, 999]]) await put('members', `${mid}:${PHONE}`, mid, { phone: PHONE, name: 'Synthetic member', points, lifetimePoints: points, cloverCustomerId: null, joinedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
  } else {
    const rows = [
      [MID, 'card-owner', 'A1Z9', ref(MID, PHONE), 2537, 'active'],
      [OTHER, 'card-foreign', 'B2Y8', ref(OTHER, PHONE), 9999, 'active'],
      [MID, 'card-other-customer', 'C3X7', ref(MID, '+15145550102'), 4500, 'active'],
      [MID, 'card-anonymous', 'D4W6', null, 1200, 'active'],
      [MID, 'card-disabled', 'E5V5', ref(MID, PHONE), 2300, 'disabled'],
    ];
    for (const [mid, id, last4, customerRef, balanceCents, status] of rows) await put('cards', crypto.createHash('sha256').update(id).digest('hex'), mid, { last4, customerRef, balanceCents, initialCents: balanceCents, status, issuedAt: new Date().toISOString(), cloverOrderId: null });
  }
}
async function snapshot(app) { return JSON.stringify((await app.pool.query('SELECT collection,id,merchant_id,data FROM app_docs ORDER BY collection,id')).rows); }
async function consumers() {
  const env = { ...fixtureEnv(), NODE_ENV: 'test', FOODHUB_FORCE_MEMORY: 'true', FOODHUB_PUBLIC_URL: 'http://127.0.0.1:5990',
    FOODHUB_CUSTOMER_SUITE_PROOF: '1', FOODHUB_CUSTOMER_SUITE_MERCHANTS: JSON.stringify({ on2go: MID }) };
  for (const app of apps) { env[`FOODHUB_SUITE_${app.key.toUpperCase()}_URL`] = app.url + '/api/suite/events'; env[`FOODHUB_SUITE_${app.key.toUpperCase()}_SECRET`] = app.secret; }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/customer-suite-live.test.ts', '--reporter=dot'], { cwd: root, env, stdio: 'inherit' });
    child.on('error', reject);child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Live adapter assertions failed')));
  });
}
(async () => {
  let admin;
  const checks = [];
  try {
    for (const app of apps) if (!fs.existsSync(path.join(app.repo, '.next/standalone/server.js'))) throw new Error(`Build ${app.key} first`);
    console.log('Starting isolated PostgreSQL 16 (no production access).');
    docker('run', '-d', '--rm', '--pull=never', '--name', container, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=suite_proof', '-p', '127.0.0.1::5432', 'postgres:16');
    const dbPort = Number(docker('port', container, '5432/tcp').split(':').pop());
    admin = new Pool({ host: '127.0.0.1', port: dbPort, user: 'postgres', password, database: 'suite_proof' });
    await waitFor(async () => { await admin.query('SELECT 1'); return true; });
    for (const app of apps) {
      await admin.query(`CREATE SCHEMA ${app.schema}`);
      app.port = await port();app.url = `http://127.0.0.1:${app.port}`;app.secret = crypto.randomBytes(32).toString('hex');
      const db = new URL(`postgres://postgres@127.0.0.1:${dbPort}/suite_proof`);db.password = password;db.searchParams.set('options', `-c search_path=${app.schema}`);app.dbUrl = db.toString();
      app.pool = new Pool({ connectionString: app.dbUrl });
      await start(app);await seed(app);app.before = await snapshot(app);
    }
    console.log('Two actual HTTP apps ready, with separate durable database schemas.');
    await consumers();checks.push('actual Food Hub adapters -> signed HTTP app routes -> PostgreSQL balances');
    for (const app of apps) {
      const signedOnce = signed(app);assert.equal((await post(app, signedOnce)).status, 200);
      assert.equal((await post(app, signed(app, { merchantId: OTHER }))).status, 403);
      assert.equal((await post(app, signed(app, {}, Date.now()-301000))).status, 401);
      await stop(app);await start(app);
      assert.equal((await post(app, signedOnce)).status, 409, 'request replay remains refused after restart');
      assert.equal(await snapshot(app), app.before, 'customer/funds records are unchanged');
      assert.equal((await post(app)).status, 200);
      checks.push(`${app.key}: tenant/merchant refusal, expired signature, replay persisted after real process restart, unchanged business records`);
    }
    await consumers();checks.push('all live adapter assertions repeated after both real app restarts');
    const report = { ok: true, database: 'PostgreSQL 16', appSchemas: 2, actualHttpApps: 2, realProcessRestarts: 2, liveAdapterAssertions: 12, checks, productionAccess: false,
      limits: 'Synthetic installed merchant/member/card fixtures. Food Hub verified-customer store in the consumer test uses memory; the two suite app ledgers and replay records use real PostgreSQL. No Clover OAuth, payment, redemption or production deployment certification.' };
    const output = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out')+1] : path.join(root, 'private/verification/customer-suite.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const app of apps) { await stop(app);await app.pool?.end(); }
    await admin?.end();try { docker('rm', '-f', container); } catch {}
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => { console.error('Customer suite proof failed:', e.message);process.exitCode = 1; });
