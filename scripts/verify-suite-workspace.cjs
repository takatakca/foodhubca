#!/usr/bin/env node
'use strict';

// Run from any directory: node scripts/verify-suite-workspace.cjs [workspace-root]
// Exercises the checked-out Food Hub and all nine suite implementations together.
// Real producers, consumers, routes and memory stores; in-process Request/Response
// transport only. No HTTP sockets, provider calls, credentials or repository writes.
// This verifies the shared contract, not deployment, TLS or database readiness.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hub = path.resolve(__dirname, '..');
const workspace = path.resolve(process.argv[2] || path.dirname(hub));
const repositories = ['C4ISSE', 'T4CTILE', '4CCOUNTING', 'TR4CKER', 'ST4FF', 'M4RKETING', 'LOY4LTY', 'REW4RD', 'CH4T'];

if (!process.argv.includes('--worker')) {
  let failed = 0;
  for (const repo of repositories) {
    const root = path.join(workspace, repo);
    if (!fs.existsSync(path.join(root, 'package.json'))) {
      console.error(`FAIL ${repo}: checkout missing at ${root}`);
      failed++;
      continue;
    }
    const run = spawnSync(process.execPath, [__filename, workspace, '--worker', repo], { encoding: 'utf8', timeout: 60_000 });
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.status !== 0) {
      console.error(`FAIL ${repo}: ${run.error?.message || run.stderr?.trim() || `exit ${run.status}`}`);
      failed++;
    }
  }
  console.log(`${repositories.length - failed}/${repositories.length} repository pairs passed`);
  process.exitCode = failed ? 1 : 0;
} else {
  verify(process.argv.at(-1)).catch((error) => { console.error(error.stack); process.exitCode = 1; });
}

async function verify(repository) {
  const appRoot = path.join(workspace, repository);
  // Use the installed, pinned TypeScript compiler to load the actual checked-out
  // server modules. Resolve each repo's @ alias relative to its own checkout.
  // A child per app keeps its module globals and memory store independent.
  const ts = require(path.join(hub, 'node_modules/typescript'));
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) {
      const root = parent?.filename.startsWith(`${appRoot}${path.sep}`) ? appRoot : hub;
      request = path.join(root, request.slice(2));
    }
    return resolve.call(this, request, parent, ...args);
  };
  for (const extension of ['.ts', '.tsx']) {
    Module._extensions[extension] = (module, file) => {
      const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
        fileName: file,
      });
      module._compile(compiled.outputText, file);
    };
  }

  process.env.NODE_ENV = 'test';
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  delete process.env.DATABASE_URL;
  delete process.env.FOODHUB_SUITE_CUSTOMER_SALT;
  for (const key of Object.keys(process.env)) {
    if (/^FOODHUB_SUITE_/.test(key)) delete process.env[key];
  }
  const { APP } = require(path.join(appRoot, 'lib/app.ts'));
  const { SUITE_APPS } = require(path.join(hub, 'lib/foodhub/suite/apps.ts'));
  assert.equal(SUITE_APPS.find((app) => app.repo === repository)?.key, APP.key, 'producer/consumer app identity');
  const secret = crypto.randomBytes(32).toString('hex');
  const otherSecret = crypto.randomBytes(32).toString('hex');
  const hubUrl = 'http://127.0.0.1:1';
  const appUrl = 'http://127.0.0.1:2/api/suite/events';
  process.env.FOODHUB_URL = hubUrl;
  process.env.FOODHUB_SUITE_SECRET = secret;
  process.env[`FOODHUB_SUITE_${APP.key.toUpperCase()}_URL`] = appUrl;
  process.env[`FOODHUB_SUITE_${APP.key.toUpperCase()}_SECRET`] = secret;
  process.env[`FOODHUB_SUITE_${APP.key.toUpperCase()}_EVENTS`] = 'app.event';

  const appSuite = require(path.join(appRoot, 'lib/suite.ts'));
  const appStore = require(path.join(appRoot, 'lib/core/store.ts'));
  const appRoute = require(path.join(appRoot, 'app/api/suite/events/route.ts')).POST;
  const hubSign = require(path.join(hub, 'lib/foodhub/suite/sign.ts'));
  const hubBus = require(path.join(hub, 'lib/foodhub/suite/bus.ts'));
  const hubRepo = require(path.join(hub, 'lib/foodhub/repo.ts')).getRepo();
  const hubEvents = require(path.join(hub, 'app/api/suite/v1/events/route.ts')).POST;
  const hubDirectory = require(path.join(hub, 'app/api/suite/v1/directory/route.ts')).GET;
  appStore.resetStore();
  assert.equal(appStore.getStore().mode, 'memory');

  const responses = [];
  let directoryRequest = null;
  let failNextAppDelivery = false;
  let failNextHubDelivery = false;
  const transport = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (req.url === appUrl && req.method === 'POST') {
      if (failNextAppDelivery) { failNextAppDelivery = false; return new Response('{}', { status: 503 }); }
      return appRoute(req);
    }
    if (req.url === `${hubUrl}/api/suite/v1/events` && req.method === 'POST') {
      if (failNextHubDelivery) { failNextHubDelivery = false; return new Response('{}', { status: 503 }); }
      const response = await hubEvents(req);
      responses.push({ status: response.status, body: await response.clone().json() });
      return response;
    }
    if (req.url.startsWith(`${hubUrl}/api/suite/v1/directory?`) && req.method === 'GET') {
      directoryRequest = req.clone();
      return hubDirectory(req);
    }
    throw new Error(`Unexpected network request: ${req.method} ${new URL(req.url).pathname}`);
  };
  globalThis.fetch = transport; // Every network operation is intercepted; no remote fallback.

  const event = { id: `contract-${APP.key}`, type: 'app.event', createdAt: new Date().toISOString(), source: 'foodhub', data: { type: 'workspace.contract_probe', data: {} } };
  const body = JSON.stringify(event);
  const appRequest = (raw, signature) => new Request(appUrl, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-takatak-app': 'foodhub', 'x-takatak-signature': signature } });

  // Food Hub's actual outbox producer -> this repository's real API + domain hook.
  assert.equal(await hubBus.queueEvent(event), 1);
  assert.equal(await hubBus.queueEvent(event), 0, 'outbox idempotency');
  assert.deepEqual(await hubBus.deliverOutbox(Date.now(), transport), { sent: 1, failed: 0, retrying: 0 });
  assert.equal((await appSuite.suiteStats()).received, 1);
  const replay = await appRoute(appRequest(body, hubSign.signSuite(secret, body)));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal((await appSuite.suiteStats()).received, 1, 'consumer does not process replay twice');
  assert.equal((await appRoute(appRequest(body + ' ', hubSign.signSuite(secret, body)))).status, 401, 'tampered hub body');
  assert.equal((await appRoute(appRequest(body, hubSign.signSuite(otherSecret, body)))).status, 401, 'wrong app secret');
  assert.equal((await appRoute(appRequest(body, hubSign.signSuite(secret, body, Date.now() - 301_000)))).status, 401, 'expired hub signature');
  failNextAppDelivery = true;
  assert.equal(await hubBus.queueEvent({ ...event, id: `${event.id}-retry` }), 1);
  const now = Date.now();
  assert.deepEqual(await hubBus.deliverOutbox(now, transport), { sent: 0, failed: 0, retrying: 1 });
  assert.deepEqual(await hubBus.deliverOutbox(now + 1000, transport), { sent: 0, failed: 0, retrying: 0 }, 'hub respects retry backoff');
  assert.deepEqual(await hubBus.deliverOutbox(now + 31_000, transport), { sent: 1, failed: 0, retrying: 0 });
  assert.equal((await appSuite.suiteStats()).received, 2, 'retry reaches consumer once');

  // Check tangible domain effects where this app consumes Food Hub orders.
  // The other six apps' hooks do not consume these events; their authenticated
  // transport/directory contracts are still exercised above and below.
  const mid = 'SYNTHETIC0001';
  if (['4CCOUNTING', 'T4CTILE', 'TR4CKER'].includes(repository)) {
    process.env[`FOODHUB_SUITE_${APP.key.toUpperCase()}_EVENTS`] = 'order.created,order.status_changed,app.event';
    const { order } = await hubRepo.insertOrderIfNew({
      channel: 'direct', marketplace: 'direct', externalOrderId: `workspace-${APP.key}`, displayId: 'SYNTHETIC-ORDER', channelStoreId: 'synthetic-store',
      brandName: 'Synthetic restaurant', customerName: 'Synthetic guest', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD',
      subtotal: 20, tax: 3, deliveryFee: 0, tip: 2, discount: 0, total: 25,
      lines: [{ name: 'Synthetic item', quantity: 1, unitPrice: 20, total: 20, modifiers: [] }], raw: {},
    });
    const payload = hubBus.orderView({ ...order, status: 'ready', posOrderId: 'SYNTHETIC-CLOVER-ORDER' }, () => mid);
    assert.equal('customerName' in payload, false, 'producer strips customer identity');
    if (repository === 'T4CTILE') {
      const { ORDERS } = require(path.join(appRoot, 'lib/domain/kiosk.ts'));
      await appStore.getStore().put(ORDERS, `${mid}:SYNTHETIC-CLOVER-ORDER`, mid, { number: 1, device: 'synthetic-kiosk', cloverOrderId: 'SYNTHETIC-CLOVER-ORDER', ready: false, at: new Date().toISOString() });
    }
    const domainEvent = { ...event, id: `domain-${APP.key}`, type: repository === 'TR4CKER' ? 'order.created' : 'order.status_changed', data: { order: payload } };
    assert.equal(await hubBus.queueEvent(domainEvent), 1);
    assert.deepEqual(await hubBus.deliverOutbox(Date.now(), transport), { sent: 1, failed: 0, retrying: 0 });
    if (repository === '4CCOUNTING') {
      const { PLATFORM } = require(path.join(appRoot, 'lib/domain/books.ts'));
      const docs = await appStore.getStore().list(PLATFORM, { merchantId: mid });
      assert.equal(docs.length, 1);
      assert.equal(docs[0].data.totalCents, 2500, 'real accounting hook records money in cents');
    } else if (repository === 'T4CTILE') {
      const { ORDERS } = require(path.join(appRoot, 'lib/domain/kiosk.ts'));
      assert.equal((await appStore.getStore().get(ORDERS, `${mid}:SYNTHETIC-CLOVER-ORDER`)).data.ready, true, 'real kiosk hook marks the matching order ready');
    } else {
      const { DELIVERIES } = require(path.join(appRoot, 'lib/domain/deliveries.ts'));
      const docs = await appStore.getStore().list(DELIVERIES, { merchantId: mid });
      assert.equal(docs.length, 1, 'real tracking hook creates one delivery');
      assert.equal(docs[0].data.source, 'foodhub');
    }
  }

  // This repository's real emitter -> Food Hub's real event route and directory.
  assert.equal((await appSuite.emitSuite('installed', { cloverMerchantId: mid, appUrl: 'https://app.example.test' }, 'installed-contract')).sent, true);
  let directory = await appSuite.suiteDirectory(mid);
  assert.equal(directory.find((app) => app.key === APP.key)?.installed, true);
  assert.equal(directory.find((app) => app.key === APP.key)?.url, 'https://app.example.test');
  assert.ok(directoryRequest, 'actual signed directory request captured');
  assert.equal((await hubDirectory(new Request(`${directoryRequest.url}&limit=1`, { headers: directoryRequest.headers }))).status, 401, 'query tampering invalidates app-generated GET signature');
  assert.equal((await appSuite.emitSuite('installed', { cloverMerchantId: mid }, 'installed-contract')).sent, true);
  assert.equal(responses.at(-1).body.forwardedTo, 0, 'duplicate application event');

  const outbound = JSON.stringify({ id: 'negative-contract', type: `${APP.key}.installed`, data: { cloverMerchantId: mid } });
  const hubRequest = (raw, signature, app = APP.key) => new Request(`${hubUrl}/api/suite/v1/events`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-takatak-app': app, 'x-takatak-signature': signature } });
  assert.equal((await hubEvents(hubRequest(outbound + ' ', appSuite.signSuite(secret, outbound)))).status, 401, 'tampered application body');
  assert.equal((await hubEvents(hubRequest(outbound, appSuite.signSuite(otherSecret, outbound)))).status, 401, 'wrong application secret');
  assert.equal((await hubEvents(hubRequest(outbound, appSuite.signSuite(secret, outbound, Date.now() - 301_000)))).status, 401, 'expired application signature');
  assert.equal((await hubEvents(hubRequest(outbound, appSuite.signSuite(secret, outbound), 'unknown'))).status, 401, 'unknown app identity');
  const forged = JSON.stringify({ id: 'forged-app', type: 'anotherapp.installed', data: { cloverMerchantId: mid } });
  assert.equal((await hubEvents(hubRequest(forged, appSuite.signSuite(secret, forged)))).status, 403, 'cannot announce another app');

  // Test real retry behavior, not only verification helpers.
  failNextHubDelivery = true;
  assert.equal((await appSuite.emitSuite('contract_probe', {}, 'retry-contract')).reason, 'kept for retry');
  assert.equal((await appSuite.suiteStats()).waiting, 1);
  assert.deepEqual(await appSuite.flushSuiteOutbox(), { sent: 1, left: 0 });
  assert.equal((await hubRepo.getKv(`suite:evt:app_${APP.key}_retry-contract`)) !== null, true);
  assert.equal((await appSuite.emitSuite('uninstalled', { cloverMerchantId: mid }, 'uninstalled-contract')).sent, true);
  appSuite.clearDirectoryCache();
  directory = await appSuite.suiteDirectory(mid);
  assert.equal(directory.find((app) => app.key === APP.key)?.installed, false);
  console.log(`PASS ${repository}: hub outbox -> app route; app emitter -> hub route; signed directory install/uninstall; replay, body/query tamper, identity, expiry and bidirectional retry checks`);
}
