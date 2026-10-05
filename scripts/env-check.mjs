// Checks environment for the TAKATAK Food Hub (direct channels — no aggregator).
// Reads .env.local automatically when present. Never prints secret values.
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const has = (k) => Boolean(process.env[k] && String(process.env[k]).trim());
const live = process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true';

const groups = {
  'Database (Supabase — without it data is kept in memory only)': ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  'Dashboard': ['DASHBOARD_PASSWORD', 'FOODHUB_PUBLIC_URL', 'CRON_SECRET'],
  'Clover POS': ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN'],
  'Uber Eats (direct)': ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET'],
  'DoorDash (direct)': ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET'],
  'SkipTheDishes (direct, JET Connect)': ['SKIP_JET_API_KEY', 'SKIP_WEBHOOK_HMAC_SECRET', 'SKIP_WEBHOOK_API_KEY'],
  'Too Good To Go (inbound only)': ['TGTG_WEBHOOK_SECRET'],
};

let blocking = 0;
for (const [title, keys] of Object.entries(groups)) {
  const missing = keys.filter((k) => !has(k));
  console.log(`${missing.length ? '⚠️ ' : '✅'} ${title}: ${missing.length ? 'missing ' + missing.join(', ') : 'configured'}`);
}
console.log(`\nLIVE_CONNECTORS_GLOBAL_ENABLED=${live ? 'true' : 'false'}`);
if (live && !has('DASHBOARD_PASSWORD')) {
  console.log('❌ Live mode requires DASHBOARD_PASSWORD (the dashboard refuses to serve without it).');
  blocking++;
}
if (has('DASHBOARD_PASSWORD') && !has('SESSION_SECRET')) {
  console.log('⚠️  SESSION_SECRET is not set: session cookies are signed with a key derived from DASHBOARD_PASSWORD. Set SESSION_SECRET (npm run setup generates one) so the password is not the signing secret.');
}
if (!live) console.log('Live mode is off: orders are received and shown, but nothing is sent to platforms.');
console.log('\nMissing credentials are warnings — each channel turns on by itself once its keys are added (npm run setup).');
process.exit(blocking ? 1 : 0);
