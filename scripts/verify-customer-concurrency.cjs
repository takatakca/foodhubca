#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This CommonJS proof loads the actual TypeScript modules through a scoped require hook. */
// Actual repository/customer modules on a disposable loopback PostgreSQL/PostgREST schema. No texts or providers.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const configured = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'].map((key) => process.env[key]).filter(Boolean);
assert(configured.length && process.env.SUPABASE_SERVICE_ROLE_KEY, 'An isolated loopback database and test service key are required.');
for (const value of configured) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password, 'This proof refuses remote databases.');
}
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
Module._extensions['.ts'] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};
process.env.FOODHUB_FORCE_MEMORY = 'false';
const transport = global.fetch;
const conditionalRequests = [];
global.fetch = async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const response = await transport(input, init);
  const requestUrl = new URL(url);
  if ((init?.method ?? input?.method) === 'PATCH' && requestUrl.pathname.endsWith('/fh_docs') && requestUrl.searchParams.get('updated_at')?.startsWith('eq.')) {
    conditionalRequests.push({ urlBytes: Buffer.byteLength(url), status: response.status });
  }
  return response;
};
async function run() {
  const { getRepo } = require('../lib/foodhub/repo.ts');
  const { CUSTOMERS, getCustomer, updateCustomer, upsertVerifiedCustomer, anonymiseCustomer, newCustomerId } = require('../lib/foodhub/customers/store.ts');
  const { collectionRevision, replaceCollection } = require('../lib/foodhub/customers/collections.ts');
  const { validateAddresses, validateFavourites } = require('../lib/foodhub/customers/profile.ts');
  const repo = getRepo(); assert.equal(repo.mode, 'supabase');
  const { customer } = await upsertVerifiedCustomer({ phone: '+15145550143', tenant: 'on2go' });
  const stored = await repo.getDoc(CUSTOMERS, customer.id); assert(stored);
  const results = await Promise.all(['A', 'B'].map((name) => repo.compareAndSwapDoc(CUSTOMERS, stored, { ...stored, data: { ...stored.data, name: `Synthetic device ${name}` } })));
  assert.deepEqual(results.sort(), [false, true]);
  const current = await getCustomer(customer.id);
  const revision = collectionRevision(current.favourites);
  const changes = await Promise.all(['first-device', 'second-device'].map((ref) => replaceCollection(current, { field: 'favourites', value: [...current.favourites, ref] }, revision)));
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  const conflict = changes.find((r) => r.status === 409);
  assert.equal(conflict.body.error, 'collection_changed');
  const fresh = await getCustomer(customer.id);
  const missing = ['first-device', 'second-device'].filter((ref) => !fresh.favourites.includes(ref));
  const merged = await replaceCollection(fresh, { field: 'favourites', value: [...fresh.favourites, ...missing] }, collectionRevision(fresh.favourites));
  assert.equal(merged.status, 200); assert.equal(merged.body.favourites.length, current.favourites.length + 2);
  const addressOwner = await getCustomer(customer.id);
  const address = { street: '143 rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H4A 1E1' };
  const addressResult = await replaceCollection(addressOwner, { field: 'addresses', value: [address] }, collectionRevision(addressOwner.addresses));
  assert.equal(addressResult.status, 200);
  const addressRead = await getCustomer(customer.id);
  assert.equal(collectionRevision(addressRead.addresses), addressResult.body.addressesRevision);
  await updateCustomer(customer.id, (value) => ({ ...value, preferences: { ...value.preferences, offersEmail: true } }));
  const changed = await getCustomer(customer.id); assert(changed.preferences.offersEmail);
  assert.deepEqual(changed.favourites, merged.body.favourites);
  const claim = `customer-proof:${crypto.randomUUID()}`;
  await repo.setKv(claim, { a: 1, b: 2 });
  assert(await repo.compareAndSwapKv(claim, { b: 2, a: 1 }, { id: 'new-owner' }));
  assert.equal(await repo.compareAndSwapKv(claim, { a: 1, b: 2 }, { id: 'stale-owner' }), false);
  const beforeDelete = await repo.getDoc(CUSTOMERS, customer.id);
  await anonymiseCustomer(customer.id, 'Synthetic proof');
  assert.equal(await repo.compareAndSwapDoc(CUSTOMERS, beforeDelete, { ...beforeDelete, data: { ...beforeDelete.data, name: 'Must not reappear' } }), false);
  assert((await getCustomer(customer.id)).deletedAt);
  const again = await upsertVerifiedCustomer({ phone: '+15145550143', tenant: 'on2go' });
  assert(again.created); assert.notEqual(again.customer.id, customer.id);
  const sizeId = newCustomerId();
  let sizeProof;
  try {
    const at = new Date().toISOString();
    const synthetic = { id: sizeId, phone: '+15145550174', tenants: ['on2go'], lang: 'fr', marketingConsent: false, createdAt: at, verifiedAt: at, tokenVersion: 1, addresses: [], favourites: [] };
    const key = `ph:${crypto.createHash('sha256').update(`customer|${synthetic.phone}`).digest('hex').slice(0, 32)}`;
    await repo.putDocs(CUSTOMERS, [{ id: sizeId, key, at, data: synthetic }]);
    const addressInput = { addresses: Array.from({ length: 5 }, () => ({ label: '界'.repeat(40), street: '街'.repeat(120), unit: '室'.repeat(20), city: '城'.repeat(80), province: 'QC', postalCode: 'H4A 1E1', instructions: '示'.repeat(200) })) };
    const favouritesInput = { favourites: Array.from({ length: 50 }, (_, i) => `restaurant-${String(i).padStart(2, '0')}-` + 'x'.repeat(106)) };
    const addresses = validateAddresses(addressInput); const favourites = validateFavourites(favouritesInput);
    assert(addresses.ok); assert(favourites.ok);
    const addressBodyBytes = Buffer.byteLength(JSON.stringify({ ...addressInput, expectedRevision: collectionRevision([]) }));
    const favouritesBodyBytes = Buffer.byteLength(JSON.stringify({ ...favouritesInput, expectedRevision: collectionRevision([]) }));
    assert(addressBodyBytes <= 8192); assert(favouritesBodyBytes <= 8192);
    assert.equal((await replaceCollection(synthetic, { field: 'favourites', value: favourites.favourites }, collectionRevision([]))).status, 200);
    const withFavourites = await getCustomer(sizeId);
    assert.equal((await replaceCollection(withFavourites, { field: 'addresses', value: addresses.addresses }, collectionRevision([]))).status, 200);
    const maximum = await updateCustomer(sizeId, (cur) => ({ ...cur, name: 'Valid maximum profile' }));
    assert.equal(maximum.favourites.length, 50); assert.equal(maximum.addresses.length, 5);

    // Identical JSON after two intervening writes must not revive an old row version.
    const observed = await repo.getDoc(CUSTOMERS, sizeId); assert(observed.updatedAt);
    assert(await repo.compareAndSwapDoc(CUSTOMERS, observed, { ...observed, data: { ...observed.data, name: 'Temporary value' } }));
    const temporary = await repo.getDoc(CUSTOMERS, sizeId);
    assert(await repo.compareAndSwapDoc(CUSTOMERS, temporary, { ...temporary, data: observed.data }));
    assert.equal(await repo.compareAndSwapDoc(CUSTOMERS, observed, { ...observed, data: { ...observed.data, name: 'Stale edit' } }), false);
    assert.deepEqual((await repo.getDoc(CUSTOMERS, sizeId)).data, observed.data);

    // Preserve all six fractional digits when matching the observed row. A lagging
    // app clock still has to generate a strictly newer timestamp for the next row.
    const { supabaseAdmin } = require('../lib/supabase/server.ts');
    const future = new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, '.123456Z');
    const fixture = await supabaseAdmin().from('fh_docs').update({ updated_at: future }).eq('collection', CUSTOMERS).eq('id', sizeId);
    assert.ifError(fixture.error);
    const precise = await repo.getDoc(CUSTOMERS, sizeId); assert(/\.\d{6}/.test(precise.updatedAt));
    assert(await repo.compareAndSwapDoc(CUSTOMERS, precise, { ...precise, data: { ...precise.data, name: 'After precise version' } }));
    const newer = await repo.getDoc(CUSTOMERS, sizeId);
    const micros = (stamp) => BigInt(Date.parse(stamp)) * 1000n + BigInt((stamp.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
    assert(micros(newer.updatedAt) > micros(precise.updatedAt));
    await repo.deleteDocs(CUSTOMERS, [sizeId]);
    assert.equal(await repo.compareAndSwapDoc(CUSTOMERS, newer, { ...newer, data: observed.data }), false);
    assert.equal(await repo.getDoc(CUSTOMERS, sizeId), null);
    sizeProof = { addressBodyBytes, favouritesBodyBytes, perListLimitBytes: 8192, favourites: 50, addresses: 5 };
  } finally { await repo.deleteDocs(CUSTOMERS, [sizeId]); }
  assert(conditionalRequests.length > 0);
  assert(conditionalRequests.every((request) => request.status === 200 && request.urlBytes < 2048));
  const report = { ok: true, database: 'actual local PostgreSQL/PostgREST', checksPassed: 12,
    checks: ['one atomic winner from competing document updates', 'stale saved-list revision returns conflict', 'explicit fresh merge preserves both device changes',
      'PostgreSQL JSONB key ordering preserves address revision', 'profile changes preserve saved lists', 'conditional phone-claim replacement rejects stale owner',
      'stale profile cannot resurrect anonymised record', 'verification after deletion creates a new identity',
      'maximum valid Unicode addresses and fifty favourites remain editable without oversized URLs', 'a stale row version fails even when the original JSON is restored',
      'microsecond observed timestamps advance strictly despite a lagging clock', 'conditional updates never reinsert a deleted row'],
    sizeProof, maximumConditionalUrlBytes: Math.max(...conditionalRequests.map((request) => request.urlBytes)), externalTexts: 0, productionVerified: false };
  const at = process.argv.indexOf('--out'); if (at >= 0) { fs.mkdirSync(path.dirname(process.argv[at + 1]), { recursive: true }); fs.writeFileSync(process.argv[at + 1], JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => { global.fetch = transport; });
