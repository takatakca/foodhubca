// Channel readiness summary for the TAKATAK Food Hub (direct integrations only).
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const has = (k) => Boolean(process.env[k] && String(process.env[k]).trim());
const live = process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true';

const channels = [
  ['clover', 'Clover POS', ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN'], 'orders injected into Clover + menu import'],
  ['uber_eats', 'Uber Eats', ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET'], 'orders, accept/deny, menu, item 86, pause'],
  ['doordash', 'DoorDash', ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET'], 'orders, confirm, ready, menu, item 86, pause'],
  ['skip', 'SkipTheDishes (JET Connect)', ['SKIP_JET_API_KEY', 'SKIP_WEBHOOK_HMAC_SECRET'], 'orders, POS confirm/tablet fallback, menu, item 86, offline'],
  ['tgtg', 'Too Good To Go', ['TGTG_WEBHOOK_SECRET'], 'inbound bag orders only (no public API)'],
];
for (const [, label, keys, does] of channels) {
  const missing = keys.filter((k) => !has(k));
  const state = missing.length ? `needs ${missing.join(', ')}` : live ? 'LIVE' : 'ready (live switch off)';
  console.log(`${missing.length ? '⚠️ ' : '✅'} ${label.padEnd(28)} ${state}  — ${does}`);
}
