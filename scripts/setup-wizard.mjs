#!/usr/bin/env node
// TAKATAK Setup Wizard
// Run: npm run setup
// Asks for each credential, writes .env.local on YOUR machine only.
// Secrets never leave your computer. Press Enter to skip anything you
// don't have yet — you can re-run this wizard any time; existing values
// are kept unless you type a new one.

import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
// Buffered line reader: works when typing AND when answers are piped in (lines are never dropped).
const lineQueue = [];
const waiters = [];
let inputClosed = false;
rl.on('line', (line) => { const w = waiters.shift(); if (w) w(line); else lineQueue.push(line); });
rl.on('close', () => { inputClosed = true; while (waiters.length) waiters.shift()(''); });
function ask(prompt) {
  process.stdout.write(prompt);
  if (lineQueue.length) { const l = lineQueue.shift(); if (!process.stdin.isTTY) process.stdout.write('\n'); return Promise.resolve(l); }
  if (inputClosed) { process.stdout.write('\n'); return Promise.resolve(''); }
  return new Promise((resolve) => waiters.push(resolve));
}

const FILE = '.env.local';
const existing = {};
if (existsSync(FILE)) {
  for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) existing[m[1]] = m[2];
  }
  console.log('Found existing .env.local — current values are kept if you press Enter.\n');
}

const sections = [
  ['SUPABASE (required first — from supabase.com → your project → Settings → API)', [
    ['NEXT_PUBLIC_SUPABASE_URL', 'Project URL (https://xxxx.supabase.co)'],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon public key'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'service_role key (keep secret)'],
  ]],
  ['SIGN-IN (everyone signs in with a 6-digit code by email or SMS — no passwords to remember)', [
    ['FOODHUB_PUBLIC_URL', 'Public URL of your deployment, e.g. https://takatak-foodhub.vercel.app (sign-in links + webhook URLs)'],
    ['FOODHUB_OWNER_EMAIL', 'YOUR email — the first owner account can only be created with it (or with the recovery password)'],
    ['FOODHUB_OWNER_PHONE', 'Optional: YOUR cell, e.g. 514 555 0123 (same purpose, by SMS)'],
    ['DASHBOARD_PASSWORD', 'Recovery password — only for emergencies ("Sign in with the recovery password"). Type it yourself, never in chat'],
    ['FOODHUB_TRUST_PROXY', 'true when a reverse proxy (Caddy, Traefik, nginx, Cloudflare) sits in front of the app — sign-in throttling then keys on the real client address (automatic on Vercel; leave empty otherwise)'],
  ]],
  ['EMAIL (resend.com → API Keys; the From addresses must be on a domain verified in Resend)', [
    ['RESEND_API_KEY', 'Resend API key (re_...) — sends sign-in codes, invitations, alerts and reports'],
    ['AUTH_EMAIL_FROM', 'Sign-in From address, e.g. TAKATAK <connexion@yourdomain.com>'],
    ['REPORT_EMAIL_FROM', 'Reports From address, e.g. TAKATAK Rapports <rapports@yourdomain.com>'],
  ]],
  ['SMS + PHONE CALLS (twilio.com → Console: Account SID, Auth Token, and a Canadian phone number that can send SMS and make calls)', [
    ['TWILIO_ACCOUNT_SID', 'Account SID (AC...)'],
    ['TWILIO_AUTH_TOKEN', 'Auth Token'],
    ['TWILIO_FROM', 'Your Twilio number, e.g. +15145550123'],
    ['TWILIO_MESSAGING_SERVICE_SID', 'Optional: Messaging Service SID (MG...) if Twilio asks you to use one for Canadian SMS'],
  ]],
  ['ALERTS + AI (optional)', [
    ['ALERT_WEBHOOK_URL', 'Team chat incoming-webhook URL (Slack, Microsoft Teams, Google Chat or Discord) — alerts are posted there'],
    ['ANTHROPIC_API_KEY', 'Claude API key (console.anthropic.com) — explains each alert and powers the copilot; without it, built-in rules are used'],
  ]],
  ['CLOVER (clover.com → Account & Setup → API Tokens → create a token with Orders, Inventory, Payments and Merchant read/write)', [
    ['CLOVER_BASE_URL', 'Base URL [https://api.clover.com]', 'https://api.clover.com'],
    ['CLOVER_CLIENT_ID', 'Clover APP ID of your "TAKATAK Food Hub" app (developer dashboard → app → App Settings) — lets every Clover merchant connect in one click; leave empty to use API tokens only'],
    ['CLOVER_CLIENT_SECRET', 'Clover APP SECRET of that app (same screen, eye icon) — stays on the server'],
    ['FOODHUB_VIA_CLOVER', 'Optional: platforms linked to Clover DIRECTLY (Clover → Online ordering → Partners), e.g. doordash — their orders are read from Clover, nothing is sent to them by Food Hub'],
    ['CLOVER_ALLOWED_MERCHANTS', 'Optional: your other Clover merchant IDs (comma-separated) trusted when they open the app from Clover; any other merchant waits for your approval in Settings'],
    ['CLOVER_MERCHANT_ID', 'Merchant ID (13 characters, in your Clover dashboard URL)'],
    ['CLOVER_ACCESS_TOKEN', 'API token'],
    ['CLOVER_MERCHANT_TOKENS', 'Other locations, optional JSON {"MERCHANT_ID":"token",...}'],
    ['CLOVER_PRINT_DEVICE_ID', 'Optional: Clover device id that prints kitchen tickets (empty = merchant default printer)'],
    ['CLOVER_PRINT_DEVICES', 'Optional, several Clover merchants: {"MERCHANT_ID":"deviceId"} — one printer per merchant'],
    ['CLOVER_WEBHOOK_AUTH', 'Optional: Clover app webhook auth code (X-Clover-Auth, shown in the Clover developer dashboard after the webhook URL is verified) — makes 86 from Clover instant and removes a merchant when it uninstalls the app'],
  ]],
  ['PUBLIC PAGES (privacy policy, terms, support — the URLs you give the Clover App Market)', [
    ['FOODHUB_SUPPORT_EMAIL', 'Support email shown on /legal/support, /legal/privacy and /legal/terms'],
    ['FOODHUB_SUPPORT_PHONE', 'Optional: support phone number'],
    ['FOODHUB_PRIVACY_OFFICER', 'Optional: name and title of the person responsible for personal information (Québec Law 25) — default: the highest authority of the company'],
  ]],
  ['UBER EATS DIRECT (developer.uber.com → your app → needs eats.order + eats.store scopes approved)', [
    ['UBER_CLIENT_ID', 'Client ID'],
    ['UBER_CLIENT_SECRET', 'Client Secret (also verifies webhooks of older Uber apps; new ones use the generated UBER_WEBHOOK_SIGNING_KEY)'],
  ]],
  ['DOORDASH DIRECT (developer.doordash.com → Credentials; provider type comes from DoorDash after approval)', [
    ['DOORDASH_DEVELOPER_ID', 'Developer ID'],
    ['DOORDASH_KEY_ID', 'Key ID'],
    ['DOORDASH_SIGNING_SECRET', 'Signing secret'],
    ['DOORDASH_PROVIDER_TYPE', 'Provider type (given by DoorDash when Marketplace access is approved)'],
  ]],
  ['SKIPTHEDISHES DIRECT (JET Connect — Skip/Just Eat Takeaway integrations team gives you an API key)', [
    ['SKIP_JET_API_KEY', 'JET Connect API key (sent as X-Flyt-Api-Key)'],
    ['SKIP_JET_BASE_URL', 'JET Connect base URL [https://api.flytplatform.com]', 'https://api.flytplatform.com'],
  ]],
];


const values = { ...existing };
for (const [title, fields] of sections) {
  console.log('\n=== ' + title + ' ===');
  for (const [key, label, fallback] of fields) {
    const current = values[key];
    const hint = current ? ' [saved value kept if empty]' : (fallback ? '' : '');
    const answer = (await ask(`${label}${hint}\n${key}= `)).trim();
    if (answer) values[key] = answer;
    else if (!current && fallback) values[key] = fallback;
  }
}

// Webhook secrets are generated automatically — you paste them into each platform's portal.
const { randomBytes } = await import('node:crypto');
for (const key of ['UBER_WEBHOOK_SIGNING_KEY', 'DOORDASH_WEBHOOK_SECRET', 'SKIP_WEBHOOK_HMAC_SECRET', 'SKIP_WEBHOOK_API_KEY', 'TGTG_WEBHOOK_SECRET', 'CRON_SECRET']) {
  if (!values[key]) values[key] = randomBytes(24).toString('hex');
}
// Signs every session and tablet cookie. Changing it signs everyone out (tablets must be enrolled again).
if (!values['SESSION_SECRET']) values['SESSION_SECRET'] = randomBytes(32).toString('hex');
values['ANTHROPIC_MODEL'] = values['ANTHROPIC_MODEL'] || 'claude-sonnet-5-5';
values['FOODHUB_WATCH_INTERVAL_S'] = values['FOODHUB_WATCH_INTERVAL_S'] || '30';
values['FOODHUB_TIMEZONE'] = values['FOODHUB_TIMEZONE'] || 'America/Toronto';
values['FOODHUB_CLOVER_AUTOPRINT'] = values['FOODHUB_CLOVER_AUTOPRINT'] || 'on';
values['FOODHUB_AUTO_COMPLETE_MIN'] = values['FOODHUB_AUTO_COMPLETE_MIN'] || '90';
// RC9 automation defaults (all can be turned off with "off")
values['FOODHUB_CLOVER_RECORD_PAYMENT'] = values['FOODHUB_CLOVER_RECORD_PAYMENT'] || 'on';
values['FOODHUB_CLOVER_ORDER_TYPES'] = values['FOODHUB_CLOVER_ORDER_TYPES'] || 'on';
values['FOODHUB_CLOVER_DELETE_CANCELLED'] = values['FOODHUB_CLOVER_DELETE_CANCELLED'] || 'on';
values['FOODHUB_CLOVER_INVENTORY_SYNC'] = values['FOODHUB_CLOVER_INVENTORY_SYNC'] || 'on';
values['FOODHUB_SCHEDULED_AFTER_MIN'] = values['FOODHUB_SCHEDULED_AFTER_MIN'] || '60';
console.log('\nWebhook secrets generated. They are shown (with the exact URLs) on the Channels screen');
console.log('of your dashboard — give them to each platform from there. Nothing to copy now.');
console.log('  Uber Eats  uses your Client Secret automatically (nothing to paste).');

// Safety flags
values['AI_INGESTION_ENABLED'] = values['AI_INGESTION_ENABLED'] ?? 'true';
values['CONNECTOR_NETWORK_TIMEOUT_MS'] = values['CONNECTOR_NETWORK_TIMEOUT_MS'] ?? '15000';
const enable = (await ask('\nEnable LIVE connectors now? Only say yes after credentials are in. (yes/no) [no]: ')).trim().toLowerCase();
values['LIVE_CONNECTORS_GLOBAL_ENABLED'] = enable === 'yes' || enable === 'y' ? 'true' : (values['LIVE_CONNECTORS_GLOBAL_ENABLED'] ?? 'false');

const order = [
  'NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'LIVE_CONNECTORS_GLOBAL_ENABLED','AI_INGESTION_ENABLED','CONNECTOR_NETWORK_TIMEOUT_MS',
  'FOODHUB_PUBLIC_URL','FOODHUB_OWNER_EMAIL','FOODHUB_OWNER_PHONE','DASHBOARD_PASSWORD','SESSION_SECRET','FOODHUB_TRUST_PROXY','CRON_SECRET',
  'RESEND_API_KEY','AUTH_EMAIL_FROM','REPORT_EMAIL_FROM','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM','TWILIO_MESSAGING_SERVICE_SID',
  'ALERT_WEBHOOK_URL','ANTHROPIC_API_KEY','ANTHROPIC_MODEL','FOODHUB_WATCH_INTERVAL_S',
  'CLOVER_BASE_URL','CLOVER_CLIENT_ID','CLOVER_CLIENT_SECRET','CLOVER_WEB_URL','CLOVER_ALLOWED_MERCHANTS','FOODHUB_VIA_CLOVER','FOODHUB_CLOVER_PLATFORM_ORDERS','CLOVER_MERCHANT_ID','CLOVER_ACCESS_TOKEN','CLOVER_MERCHANT_TOKENS','CLOVER_PRINT_DEVICE_ID','CLOVER_PRINT_DEVICES','FOODHUB_CLOVER_AUTOPRINT','CLOVER_WEBHOOK_AUTH','FOODHUB_CLOVER_RECORD_PAYMENT','FOODHUB_CLOVER_DELETE_CANCELLED','FOODHUB_CLOVER_ORDER_TYPES','FOODHUB_CLOVER_INVENTORY_SYNC',
  'DOORDASH_BASE_URL','DOORDASH_DEVELOPER_ID','DOORDASH_KEY_ID','DOORDASH_SIGNING_SECRET','DOORDASH_PROVIDER_TYPE','DOORDASH_WEBHOOK_SECRET',
  'UBER_BASE_URL','UBER_CLIENT_ID','UBER_CLIENT_SECRET','UBER_WEBHOOK_SIGNING_KEY','UBER_WEBHOOK_SIGNING_KEY_2','UBER_ACCESS_TOKEN','UBER_REPORT_SCOPE',
  'SKIP_JET_API_KEY','SKIP_JET_BASE_URL','SKIP_WEBHOOK_HMAC_SECRET','SKIP_WEBHOOK_API_KEY','FOODHUB_TIMEZONE',
  'TGTG_WEBHOOK_SECRET','FOODHUB_AUTO_COMPLETE_MIN','FOODHUB_SCHEDULED_AFTER_MIN',
  'FOODHUB_SUPPORT_EMAIL','FOODHUB_SUPPORT_PHONE','FOODHUB_PRIVACY_OFFICER','FOODHUB_LEGAL_COMPANY','FOODHUB_LEGAL_ADDRESS','FOODHUB_LEGAL_UPDATED','FOODHUB_LEGAL_APPROVED',
];
const keys = [...new Set([...order, ...Object.keys(values)])];
const out = keys.filter(k => values[k] !== undefined).map(k => `${k}=${values[k]}`).join('\n') + '\n';
writeFileSync(FILE, out);
console.log(`\nSaved ${FILE}. Secrets stayed on this machine.`);
console.log('Next: npm run dev  →  open http://localhost:3000 → create your owner account with your email (a code is sent).');
console.log('Then Settings → Team (managers + PINs), Settings → Tablets (enrol each kitchen tablet), Settings → Platforms (webhook URLs + secrets).');
console.log('Watchtower when no screen is open: call /api/foodhub/cron/watch every minute with "Authorization: Bearer <CRON_SECRET>" (see docs/FOODHUB.md).');
console.log('For hosting (Vercel): copy these same values into Project → Settings → Environment Variables.');
rl.close();
