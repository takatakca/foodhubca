#!/usr/bin/env node
// Disposable PostgreSQL/PostgREST and an HTTP wire receiver; no provider keys, app build or production service.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serviceRoleJwt, startRestProxy } from './e2e/postgrest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suffix = crypto.randomBytes(6).toString('hex');
const network = `control-plane-proof-${suffix}`;const postgres = `${network}-pg`;const rest = `${network}-rest`;
const password = crypto.randomBytes(24).toString('hex');const secret = crypto.randomBytes(32).toString('hex');
const masterKey = crypto.randomBytes(32).toString('hex');const masterId = crypto.randomUUID();
const base = Date.now();const received = new Map();const bodies = [];let dropped = false;
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password, PGRST_JWT_SECRET: secret };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
function docker(args, input) {
  const r = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { input, encoding: 'utf8', env: dockerEnv });
  if (r.status !== 0) throw new Error(`Disposable Docker operation failed (${args[0]})`);return r.stdout.trim();
}
function fixtureEnv() {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CODEX_PROXY_CERT'];
  return Object.fromEntries(allowed.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn) { const until = Date.now() + 40_000;while (Date.now() < until) { try { if (await fn()) return; } catch {}await pause(200); }throw new Error('Disposable service readiness timed out'); }
const receiver = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${masterKey}`) { res.writeHead(401).end();return; }
  let raw = '';for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' });res.end(JSON.stringify(data)); };
  if (req.url === '/api/v1/merchants/entitlements') {
    assert.equal(body.source_application, 'foodhub');assert.equal(body.local_vendor_id, 'synthetic-vendor');
    send(200, { ok: true, known: true, master_merchant_id: masterId, store_name: 'Synthetic restaurant group', marketplace_status: 'active',
      subscription_status: 'source-reported', subscription_plan: 'Synthetic source plan', synchronized_at: new Date(base).toISOString() });return;
  }
  if (req.url !== '/api/v1/events') { send(404, { ok: false });return; }
  assert.equal(req.headers['idempotency-key'], body.event_id);assert.equal(body.source_application, 'foodhub');
  const previous = received.get(body.event_id);bodies.push(raw);
  if (previous && previous.raw !== raw) { send(409, { ok: false });return; }
  if (!previous) received.set(body.event_id, { raw, id: crypto.randomUUID() });
  if (!dropped) { dropped = true;req.socket.destroy();return; }
  send(200, { ok: true, id: received.get(body.event_id).id, duplicate: !!previous, aggregate_type: body.aggregate_type, aggregate_id: body.aggregate_id });
});
let proxy;
try {
  docker(['network', 'create', network]);
  docker(['run', '-d', '--rm', '--pull=never', '--name', postgres, '--network', network, '-e', 'POSTGRES_PASSWORD', 'postgres:16']);
  await waitFor(() => { try { return docker(['exec', postgres, 'pg_isready', '-U', 'postgres']).includes('accepting'); } catch { return false; } });
  const roles = fs.readFileSync(path.join(root, 'scripts/e2e/supabase-roles.sql'), 'utf8');
  docker(['exec', '-i', postgres, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', `authenticator_password=${password}`], roles);
  docker(['exec', '-i', postgres, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], fs.readFileSync(path.join(root, 'supabase/foodhub.sql'), 'utf8'));
  // URI remains inside the throwaway Docker bridge; never inherit or read an application database URL.
  dockerEnv.PGRST_DB_URI = `postgres://authenticator:${password}@${postgres}:5432/postgres`;
  docker(['run', '-d', '--rm', '--pull=never', '--name', rest, '--network', network, '-e', 'PGRST_DB_URI', '-e', 'PGRST_JWT_SECRET', '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-p', '127.0.0.1::3000', 'postgrest/postgrest:v12.2.3']);
  const restPort = Number(docker(['port', rest, '3000/tcp']).split(':').pop());const serviceKey = serviceRoleJwt(secret);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${restPort}/fh_orders?select=id&limit=1`, { headers: { Authorization: `Bearer ${serviceKey}` } })).ok);
  // The existing helper expects an explicit free port; port 0 resolves from the HTTP server below for our proxy.
  const portServer = http.createServer();await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));const proxyPort = portServer.address().port;await new Promise((resolve) => portServer.close(resolve));
  proxy = await startRestProxy({ target: `http://127.0.0.1:${restPort}`, port: proxyPort });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));const masterUrl = `http://127.0.0.1:${receiver.address().port}`;
  const env = { ...fixtureEnv(), NODE_ENV: 'test', FOODHUB_CONTROL_PLANE_PROOF: '1', CONTROL_PLANE_PROOF_BASE: String(base), SUPABASE_URL: proxy.url, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    TAKATAK_CONTROL_PLANE_URL: masterUrl, TAKATAK_FOODHUB_API_KEY: masterKey, FOODHUB_TENANT_ID: 'synthetic-group',
    FOODHUB_CONTROL_PLANE_MERCHANTS: JSON.stringify({ instanceTenantId: 'synthetic-group', merchants: [{ localVendorId: 'synthetic-vendor', masterMerchantId: masterId, locationCodes: ['TEST_KITCHEN'] }] }) };
  for (const stage of ['1', '2']) {
    console.log(`Control-plane durable proof: fresh application test process ${stage}/2.`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/control-plane-live.test.ts', '--reporter=dot'], { cwd: root, env: { ...env, CONTROL_PLANE_PROOF_STAGE: stage }, stdio: 'inherit' });
      child.on('error', reject);child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Durable proof stage ${stage} failed`)));
    });
  }
  assert.equal(received.size, 2);assert.equal(bodies.length, 3);assert.equal(bodies[0], bodies[1]);
  const events = [...received.values()].map((r) => JSON.parse(r.raw));assert.deepEqual(events.map((e) => e.event_type).sort(), ['order.created', 'order.fulfilled']);
  const report = { ok: true, database: 'PostgreSQL 16 + PostgREST 12.2.3', freshApplicationProcesses: 2, receiver: 'isolated HTTP wire stand-in', receivedUniqueEvents: 2,
    eventRequests: 3, identicalLostAcknowledgementReplay: true, checks: ['nested JSON containment applied before limit', 'timestamp/id pagination with PostgREST UTC cursor',
      'durable observation cursor and frozen event body survive process restart', 'local ready/printed transition works after reporting failure', 'actual completion creates one fulfillment count', 'no customer or financial fields sent'],
    productionAccess: false, limits: 'Actual Food Hub repository/outbox modules use durable PostgreSQL. HTTP receiver is a fixture, not a production V1 deployment; unchanged actual V1 handlers are exercised separately by control-plane.test.ts. No live merchant connection, identity writes, billing or provider transaction is certified.' };
  const arg = process.argv.indexOf('--out');const output = arg >= 0 ? process.argv[arg + 1] : path.join(root, 'private/verification/control-plane.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');console.log(JSON.stringify(report, null, 2));
} finally {
  await proxy?.close();receiver.closeAllConnections();await new Promise((resolve) => receiver.close(() => resolve()));
  for (const name of [rest, postgres]) { try { docker(['rm', '-f', name]); } catch {} }
  try { docker(['network', 'rm', network]); } catch {}
}
