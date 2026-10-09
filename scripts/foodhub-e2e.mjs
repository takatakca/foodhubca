#!/usr/bin/env node
// TAKATAK Food Hub — end-to-end verification against simulated platforms (no aggregator).
// Run:  npm run build && npm run verify:foodhub        (add --demo to keep it running and click around)
// Starts mock Uber Eats / DoorDash / SkipTheDishes (JET Connect) / Clover servers, boots the real
// app against them, and drives every flow: signed webhooks → Clover → auto-accept, Skip tablet
// fallback, menu import + publish, 86ing, pausing, platform status sync, Clover in-store sales,
// the one-screen Command Center, and the Atlas-parity layer: sign-in + roles, store hours and
// holidays, category schedules, menu checks, scheduled publish, modifier 86, busy mode / prep time,
// courier pickup, cancel reasons, Clover ticket printing, reports (CSV/Excel/email/schedules),
// analytics and the activity log — and RC9: Clover bookkeeping (order types, paid at hand-off, cancelled
// orders removed), Clover → platforms 86/price sync, couriers, Skip missing items + backup flow, scheduled
// orders, payouts & reconciliation (Uber Reporting API, DoorDash/Skip statements, disputes, deposits,
// internal ledger), Too Good To Go bag log, French menus and the installable kitchen app — and RC10: sign-in by
// code or one-tap link (email via Resend, SMS via Twilio), kitchen tablets with staff PINs, manager approvals,
// the cancellation alarm and the Watchtower (incidents, kitchen-phone call, SMS / call / chat tests, copilot).
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Ports can be moved (FOODHUB_E2E_MOCK_PORT / FOODHUB_E2E_APP_PORT) so two checkouts can verify at the same time.
const MOCK_PORT = Number(process.env.FOODHUB_E2E_MOCK_PORT) || 4799;
const APP_PORT = Number(process.env.FOODHUB_E2E_APP_PORT) || 4800;
const APP = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const PASSWORD = 'e2e-dashboard-pass';
const UBER_SECRET = 'uber-client-secret-e2e';
const DD_SECRET_B64 = Buffer.from('doordash-signing-secret-e2e-32bytes!').toString('base64');
const DRIVE_SECRET_B64 = Buffer.from('doordash-drive-secret-e2e-32bytes!!').toString('base64');
const JET_API_KEY = 'jet-api-key-e2e';
const SKIP_HMAC = 'skip-hmac-secret-e2e';
const SKIP_NOTIFY_KEY = 'skip-notify-key-e2e';
const CLOVER_TOKEN = 'clover-token-e2e';
const CLOVER_APP_TOKEN = 'clover-app-token-e2e';
const RELAY_SECRET = 'relay-secret-e2e-0123456789abcdef';
const RELAY_CB_TOKEN = 'relay-callback-token-e2e';
const DEMO = process.argv.includes('--demo');

const log = [];
let cloverSeq = 0;
let twilioSeq = 0;

// ---------------- mock platform state ----------------
const uberStatus = new Map();   // store id → { status, offlineReason }
const ddDetails = new Map();    // msid → store_details body
const knownUberStores = new Set(['uber-store-uuid-1', 'uber-store-stl']);
const uberPosData = new Map();  // store id → this app's pos_data (after POST /pos_data)
const uberCreated = new Map();  // store id → orders waiting for an accept (GET created-orders)
const cloverPayments = [
  { id: 'p1', amount: 2500, tipAmount: 300, taxAmount: 326, result: 'SUCCESS', order: { id: 'INSTORE-1' } },
  { id: 'p2', amount: 1200, tipAmount: 0, taxAmount: 156, result: 'SUCCESS', order: { id: 'INSTORE-2' } },
  { id: 'p3', amount: 999, result: 'FAIL', order: { id: 'INSTORE-3' } },
  { id: 'p4', amount: 3907, result: 'SUCCESS', order: { id: 'CLV1' } }, // a delivery order Food Hub injected → must not be counted
];
const cloverRefunds = [{ id: 'r1', amount: 200, payment: { order: { id: 'INSTORE-2' } } }];
const cloverTenders = [{ id: 'T-CASH', label: 'Cash' }];
const cloverOrderTypes = [{ id: 'OT-DINE', label: 'Dine In' }];
const cloverOrderTotals = new Map(); // Clover order id → total (cents)
const cloverAtomicTitles = new Map(); // Clover order id → title Food Hub gave it
let cloverAtomicMode = 'ok'; // 'down' = Clover answers 503 to new orders (automatic retry checks)
let uberFetchFails = 0; // Uber order fetches to refuse for "uber-flaky-…" orders
// The merchant's Clover menus (Clover → Items → Menus): the DoorDash menu holds the items sold on DoorDash, at Clover × 1.20.
const cloverMenus = [{ id: 'MENU-POS', name: 'Default POS Menu', type: 'DEFAULT_POS_MENU' }, { id: 'MENU-DD', name: 'DoorDash (Po Poulet +20%)', type: 'OLO_MENU', channel: 'DoorDash' }];
const cloverMenuRows = { 'MENU-DD': [{ item: { id: 'clv-item-1' }, price: 1919 }, { item: { id: 'clv-item-2' }, price: 599 }, { item: { id: 'clv-item-4' }, price: 325, image_filename: 'clv-item-4.jpeg' }] };
let cloverObjSeq = 0;
const cloverNativeOrders = []; // orders created in Clover by Clover itself (its DoorDash integration, Clover Online Ordering)
const cloverTags = [{ id: 'TAG-K', name: 'Cuisine', printers: { elements: [{ id: 'PR-1' }] } }, { id: 'TAG-B', name: 'Bar', printers: { elements: [] } }];
const cloverTagLinks = []; // { item, tag }
const cloverItems = [
  { id: 'clv-item-1', name: 'Poulet Grillé', price: 1499, available: true, categories: { elements: [{ id: 'clv-cat-1', name: 'Plats', sortOrder: 1 }] }, modifierGroups: { elements: [{ id: 'grp-1' }] } },
  { id: 'clv-item-2', name: 'Frites', price: 499, available: true, categories: { elements: [{ id: 'clv-cat-2', name: 'Accompagnements', sortOrder: 2 }] }, modifierGroups: { elements: [] } },
  { id: 'clv-item-3', name: 'Hidden staff meal', price: 0, hidden: true },
];
let uberReportCsv = '';

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function verifyDoorDashJwt(auth) {
  const token = (auth || '').replace(/^Bearer\s+/i, '');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return false;
  const header = JSON.parse(b64urlDecode(h).toString());
  const payload = JSON.parse(b64urlDecode(p).toString());
  const expected = crypto.createHmac('sha256', Buffer.from(DD_SECRET_B64, 'base64')).update(`${h}.${p}`).digest();
  return header['dd-ver'] === 'DD-JWT-V1' && payload.aud === 'doordash' && payload.iss === 'dd-dev-e2e' && payload.kid === 'dd-key-e2e' && crypto.timingSafeEqual(expected, b64urlDecode(s));
}

/** DoorDash Drive uses the same DD-JWT-V1 token, signed with the Drive org's own key. */
function verifyDriveJwt(auth) {
  const [h, p, sig] = (auth || '').replace(/^Bearer\s+/i, '').split('.');
  if (!h || !p || !sig) return false;
  const payload = JSON.parse(b64urlDecode(p).toString());
  const expected = crypto.createHmac('sha256', Buffer.from(DRIVE_SECRET_B64, 'base64')).update(`${h}.${p}`).digest();
  return payload.iss === 'drive-dev-e2e' && payload.kid === 'drive-key-e2e' && crypto.timingSafeEqual(expected, b64urlDecode(sig));
}

const UBER_ORDER = (id, storeId, readyInMin = 15) => ({
  id, display_id: id.toUpperCase().slice(-5), store: { id: storeId, name: 'Po Poulet' }, eater: { first_name: 'Marie' },
  cart: {
    items: [{ id: 'clv-item-1', external_data: 'clv-item-1', title: 'Poulet Grillé', quantity: 2,
      price: { unit_price: { amount: 1599, currency_code: 'CAD' }, total_price: { amount: 3398, currency_code: 'CAD' }, base_unit_price: { amount: 1499, currency_code: 'CAD' } },
      selected_modifier_groups: [{ id: 'grp-1', title: 'Sauce', selected_items: [{ id: 'mod:mod-1', title: 'Piri-piri', external_data: 'mod-1', quantity: 1, price: { unit_price: { amount: 100 } } }] }],
      special_instructions: 'Bien cuit' }],
    special_instructions: 'Sonner à la porte',
  },
  payment: { charges: { sub_total: { amount: 3398, currency_code: 'CAD' }, tax: { amount: 509 }, total: { amount: 3907, currency_code: 'CAD' }, delivery_fee: { amount: 0 }, tip: { amount: 300 } } },
  type: 'DELIVERY_BY_UBER', placed_at: new Date().toISOString(), estimated_ready_for_pickup_at: new Date(Date.now() + readyInMin * 60000).toISOString(),
});

const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  const url = new URL(req.url, MOCK);
  const entry = { method: req.method, path: url.pathname, query: url.search, headers: req.headers, body };
  log.push(entry);
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)); };
  const p = url.pathname;

  // ---- Uber Reporting API download link (signed S3-style URL in real life) ----
  if (p === '/reports/uber-payment.csv') { res.writeHead(200, { 'content-type': 'text/csv' }); return res.end(uberReportCsv); }
  // ---- Uber Eats ----
  if (p.startsWith('/uber/')) {
    if (p === '/uber/oauth/v2/token') {
      const form = new URLSearchParams(typeof raw === 'string' ? raw : '');
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good-code' && form.get('redirect_uri') === 'https://takatak.example/api/foodhub/uber-connect/callback'
          ? send(200, { access_token: 'merchant-token-1', token_type: 'Bearer', scope: 'eats.pos_provisioning' })
          : send(400, { error: 'invalid_grant' });
      }
      return send(200, { access_token: 'uber-token-1', expires_in: 2592000 });
    }
    const merchant = req.headers.authorization === 'Bearer merchant-token-1';
    if (merchant && p === '/uber/v1/eats/stores') return send(200, { stores: [
      { store_id: 'uber-new-1', name: 'Pi Pita (Hochelaga)', location: { address: '3583 Rue Sainte-Catherine E', city: 'Montréal' } },
      { store_id: 'uber-new-2', name: 'OOEUF Express NDG', location: { address: '6284 Av Somerled', city: 'Montréal' }, pos_data: { order_manager_client_id: 'urbanpiper-client', integration_enabled: true } },
    ] });
    const prov = p.match(/^\/uber\/v1\/eats\/stores\/([^/]+)\/pos_data$/);
    if (merchant && prov && req.method === 'POST') {
      knownUberStores.add(prov[1]);
      // Uber promotes Food Hub as order manager — except the store UrbanPiper has not let go yet.
      uberPosData.set(prov[1], { ...body, store_id: prov[1], integration_enabled: false, order_manager_client_id: prov[1] === 'uber-new-2' ? 'urbanpiper-client' : 'uber-id', is_order_manager_pending: false });
      return send(204);
    }
    if (req.headers.authorization !== 'Bearer uber-token-1') return send(401, {});
    if (prov && req.method === 'PATCH') { const cur = uberPosData.get(prov[1]); if (!cur) return send(404, { message: 'store not provisioned for this app' }); uberPosData.set(prov[1], { ...cur, ...body }); return send(204); }
    if (prov && req.method === 'GET') return uberPosData.has(prov[1]) ? send(200, uberPosData.get(prov[1])) : send(404, { message: 'store not provisioned for this app' });
    const created = p.match(/^\/uber\/v1\/eats\/stores\/([^/]+)\/created-orders$/);
    if (created) return send(200, { orders: uberCreated.get(created[1]) ?? [] });
    const order = p.match(/^\/uber\/v2\/eats\/order\/(.+)$/);
    // "uber-flaky-…" orders: Uber refuses the fetch while uberFetchFails > 0 (webhook inbox retry checks).
    if (order && order[1].startsWith('uber-flaky') && uberFetchFails > 0) { uberFetchFails -= 1; return send(503, { message: 'temporarily unavailable' }); }
    if (order) return send(200, UBER_ORDER(order[1], order[1].includes('stl') ? 'uber-store-stl' : 'uber-store-uuid-1', order[1].includes('sched') ? 60.4 : 15));
    if (p === '/uber/v1/eats/report' && req.method === 'POST') return send(200, { workflow_id: 'wf-report-1' });
    if (p === '/uber/v1/eats/stores') return send(200, { stores: [{ store_id: 'uber-store-uuid-1', name: 'Po Poulet NDG' }] });
    const st = p.match(/^\/uber\/v1\/eats\/store\/([^/]+)\/status$/);
    if (st && req.method === 'GET') {
      if (!uberStatus.has(st[1]) && !knownUberStores.has(st[1])) return send(404, { message: 'store not found' });
      return send(200, uberStatus.get(st[1]) ?? { status: 'ONLINE' });
    }
    if (st && req.method === 'POST') {
      uberStatus.set(st[1], body?.status === 'PAUSED' ? { status: 'PAUSED', offlineReason: 'PAUSED_BY_RESTAURANT', paused_until: body.paused_until } : { status: 'ONLINE' });
      return send(204);
    }
    return send(204);
  }
  // ---- DoorDash ----
  if (p.startsWith('/dd/')) {
    if (!verifyDoorDashJwt(req.headers.authorization)) return send(401, { message: 'bad jwt' });
    if (p === '/dd/api/v1/menus' && req.method === 'POST') return send(200, { reference: body?.reference });
    const det = p.match(/^\/dd\/api\/v1\/stores\/([^/]+)\/store_details$/);
    if (det) return send(200, ddDetails.get(det[1]) ?? { merchant_supplied_id: det[1], provider_name: 'takatak', current_deactivations: [] });
    const stt = p.match(/^\/dd\/api\/v1\/stores\/([^/]+)\/status$/);
    if (stt && req.method === 'PUT') {
      ddDetails.set(stt[1], body?.is_active ? { merchant_supplied_id: stt[1], current_deactivations: [] } : { merchant_supplied_id: stt[1], current_deactivations: [{ reason: body?.reason, notes: body?.notes, end_time: body?.end_time }] });
      return send(200, {});
    }
    return send(202, {});
  }
  // ---- SkipTheDishes (JET Connect) ----
  if (p.startsWith('/skip/')) {
    if (req.headers['x-flyt-api-key'] !== JET_API_KEY) return send(401, { message: 'bad api key' });
    if (/^\/skip\/order\/[^/]+\/sent-to-pos-(success|failed)$/.test(p)) return send(200, {});
    if (p === '/skip/menus' || p === '/skip/item-availability') return send(202, {});
    if (/^\/skip\/restaurants\/[^/]+\/(online|offline)$/.test(p)) return send(202, {});
    if (/^\/skip\/orders\/[^/]+\/modification$/.test(p) && req.method === 'POST') return send(200, {});
    return send(404, {});
  }
  // ---- Clover ----
  if (p.startsWith('/clover/')) {
    // Clover app (OAuth v2, expiring tokens): code → tokens, refresh, merchant name.
    if (p === '/clover/oauth/v2/token' && req.method === 'POST') {
      if (body?.client_id !== 'CLVAPPE2E' || body?.client_secret !== 'clover-app-secret-e2e' || body?.code !== 'clv-good-code') return send(400, { message: 'invalid code' });
      const now = Math.floor(Date.now() / 1000);
      return send(200, { access_token: CLOVER_APP_TOKEN, access_token_expiration: now + 1800, refresh_token: 'clv-refresh-e2e', refresh_token_expiration: now + 86400 });
    }
    if (p === '/clover/v3/merchants/APPMERCHANT' && req.method === 'GET') {
      return req.headers.authorization === `Bearer ${CLOVER_APP_TOKEN}` ? send(200, { id: 'APPMERCHANT', name: 'On2GO.CA (app)' }) : send(401, {});
    }
    if (p === '/clover/v3/apps/CLVAPPE2E/merchants/APPMERCHANT/billing_info') {
      return req.headers.authorization === `Bearer ${CLOVER_APP_TOKEN}` ? send(200, { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Free' } }) : send(401, {});
    }
    const mid = p.split('/')[4];
    if (mid === 'FAILMERCHANT') return send(500, { message: 'Clover is down' });
    const appMerchant = mid === 'APPMERCHANT' && req.headers.authorization === `Bearer ${CLOVER_APP_TOKEN}`;
    if (!appMerchant && req.headers.authorization !== `Bearer ${CLOVER_TOKEN}`) return send(401, {});
    if (p.endsWith('/categories') && req.method === 'GET') return send(200, { elements: [{ id: 'CAT-1', name: 'Poulet' }] });
    if (p.endsWith('/devices') && req.method === 'GET') return send(200, { elements: [{ id: 'DEV-1', model: 'Clover_C503' }] });
    if (p.endsWith('/atomic_order/orders')) {
      cloverSeq += 1;
      // Clover's total: line items with their modifications, plus order-level discounts (negative cents). Tax left out here.
      const total = (body?.orderCart?.lineItems || []).reduce((s, l) => s + (l.price || 0) + (l.modifications || []).reduce((m, x) => m + (x.amount || 0), 0), 0) + (body?.orderCart?.discounts || []).reduce((s, d) => s + (d.amount || 0), 0);
      cloverOrderTotals.set(`CLV${cloverSeq}`, total);
      cloverAtomicTitles.set(`CLV${cloverSeq}`, body?.orderCart?.title);
      if (cloverAtomicMode === 'down') { cloverOrderTotals.delete(`CLV${cloverSeq}`); return send(503, { message: 'Service Unavailable' }); }
      return send(200, { id: `CLV${cloverSeq}` });
    }
    if (/\/(tenders|order_types)$/.test(p)) {
      const list = p.endsWith('/tenders') ? cloverTenders : cloverOrderTypes;
      if (req.method === 'POST') { const o = { id: `${p.endsWith('/tenders') ? 'T' : 'OT'}-${++cloverObjSeq}`, label: body?.label }; list.push(o); return send(200, o); }
      return send(200, { elements: list });
    }
    const pay = p.match(/\/orders\/([^/]+)\/payments$/);
    if (pay && req.method === 'POST') {
      const tender = cloverTenders.find((t) => t.id === body?.tender?.id);
      if (!tender) return send(400, { message: 'unknown tender' });
      const id = `PAY-${++cloverObjSeq}`;
      cloverPayments.push({ id, amount: body.amount, taxAmount: body.taxAmount, tipAmount: 0, result: 'SUCCESS', order: { id: pay[1] }, tender: { id: tender.id, label: tender.label }, externalPaymentId: body.externalPaymentId });
      return send(200, { id });
    }
    if (/\/v3\/merchants\/[^/]+\/orders$/.test(p) && req.method === 'GET') {
      const since = Number((url.searchParams.get('filter') || '').split('>=')[1] || 0);
      return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverNativeOrders.filter((o) => o.mid === mid && o.createdTime >= since) });
    }
    const ord = p.match(/\/v3\/merchants\/[^/]+\/orders\/([^/]+)$/);
    if (ord) {
      // Orders Clover made by itself (its DoorDash integration, Clover Online Ordering) are read back whole.
      const native = cloverNativeOrders.find((o) => o.mid === mid && o.id === ord[1]);
      if (native && req.method === 'GET') return send(200, native);
      if (req.method === 'DELETE') return cloverOrderTotals.delete(ord[1]) ? send(200, {}) : send(404, {});
      if (req.method === 'GET') return cloverOrderTotals.has(ord[1]) ? send(200, { id: ord[1], total: cloverOrderTotals.get(ord[1]) }) : send(404, {});
      return send(200, { id: ord[1] });
    }
    if (/\/v3\/merchants\/[^/]+\/menus$/.test(p) && req.method === 'GET') return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverMenus });
    const menuRows = p.match(/\/v3\/merchants\/[^/]+\/menus\/([^/]+)\/items$/);
    if (menuRows) return cloverMenuRows[menuRows[1]] ? send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverMenuRows[menuRows[1]] }) : send(404, {});
    const itm = p.match(/\/items\/([^/]+)$/);
    if (itm) { const it = cloverItems.find((i) => i.id === itm[1]); return it ? send(200, it) : send(404, {}); }
    if (p.endsWith('/print_event')) return body?.orderRef?.id ? send(200, { id: `PE-${body.orderRef.id}`, state: 'CREATED' }) : send(400, { message: 'orderRef.id required' });
    if (p.endsWith('/tags')) return send(200, { elements: cloverTags });
    if (p.endsWith('/tax_rates')) return send(200, { elements: [{ id: 'TX-1', name: 'Sales Tax', rate: 14975, isDefault: true }] });
    if (p.endsWith('/tag_items') && req.method === 'POST') { for (const e of body?.elements || []) cloverTagLinks.push({ item: e.item?.id, tag: e.tag?.id }); return send(200, {}); }
    if (p.endsWith('/items')) return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverItems.map((i) => (url.searchParams.get('expand') || '').includes('tags') ? { ...i, tags: { elements: cloverTagLinks.filter((l) => l.item === i.id).map((l) => ({ id: l.tag })) } } : i) });
    if (p.endsWith('/modifier_groups')) return send(200, { elements: [{ id: 'grp-1', name: 'Sauce', minRequired: 0, maxAllowed: 1, modifiers: { elements: [{ id: 'mod-1', name: 'Piri-piri', price: 100 }] } }] });
    if (p.endsWith('/payments')) return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverPayments });
    if (p.endsWith('/refunds')) return send(200, { elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverRefunds });
    return send(404, {});
  }
  // ---- DoorDash Drive (own-order couriers) ----
  if (p.startsWith('/drive/drive/v2/')) {
    if (!verifyDriveJwt(req.headers.authorization)) return send(401, { code: 'authentication_error', message: 'bad token' });
    if (p === '/drive/drive/v2/quotes') {
      return body?.dropoff_phone_number && body?.pickup_business_name && Number.isInteger(body?.order_value)
        ? send(200, { external_delivery_id: body.external_delivery_id, delivery_status: 'quote', fee: 899, currency: 'CAD', dropoff_time_estimated: new Date(Date.now() + 40 * 60_000).toISOString() })
        : send(400, { code: 'validation_error', message: 'Validation Failed', field_errors: [{ field: 'dropoff_phone_number', error: 'required' }] });
    }
    const acc = p.match(/^\/drive\/drive\/v2\/quotes\/([^/]+)\/accept$/);
    if (acc) return send(200, { external_delivery_id: acc[1], delivery_status: 'created', fee: 899, tracking_url: `https://track.example/${acc[1]}`, support_reference: '777' });
    const cnl = p.match(/^\/drive\/drive\/v2\/deliveries\/([^/]+)\/cancel$/);
    if (cnl && req.method === 'PUT') return send(200, { external_delivery_id: cnl[1], delivery_status: 'cancelled' });
    return send(404, {});
  }
  // ---- Resend (report + sign-in emails) ----
  if (p === '/resend/emails') return req.headers.authorization === 'Bearer re_e2e' ? send(200, { id: 'email-1' }) : send(401, {});
  // ---- Twilio (SMS + voice) ----
  if (p.startsWith('/twilio/2010-04-01/Accounts/AC_e2e/')) {
    if (req.headers.authorization !== `Basic ${Buffer.from('AC_e2e:tw-e2e').toString('base64')}`) return send(401, { message: 'auth' });
    if (p.endsWith('/Messages.json')) return send(201, { sid: `SM${++twilioSeq}` });
    if (p.endsWith('/Calls.json')) return send(201, { sid: `CA${++twilioSeq}` });
  }
  // ---- team chat incoming webhook (Slack / Teams / Google Chat) ----
  if (p === '/chat') return send(200, { ok: true });
  // ---- Food Hub Order Relay partner: status callback (Acknowledged / Food Ready / Cancelled), bearer token ----
  if (p === '/relay/callback') return req.headers.authorization === `Bearer ${RELAY_CB_TOKEN}` ? send(200, { status: 'success' }) : send(401, { message: 'bad token' });
  send(404, {});
});

// ---------------- helpers ----------------
let passed = 0; let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const basic = `Basic ${Buffer.from(`owner:${PASSWORD}`).toString('base64')}`;
async function call(method, path, { body, headers = {}, auth = true, raw, redirect, cookie } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    redirect: redirect ?? 'follow',
    headers: { 'content-type': 'application/json', ...(auth && !cookie ? { authorization: basic } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text, buf, location: res.headers.get('location'), contentType: res.headers.get('content-type') || '', cookie: res.headers.get('set-cookie') };
}
const TZ = 'America/Toronto';
const localDay = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * 86400_000));
const localHour = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
const sent = (method, pathRe) => log.filter((e) => e.method === method && pathRe.test(e.path));
/** Same rule as lib/foodhub/deadline.ts: the platform's clock starts at placedAt when it is plausible. */
function expectedDeadlineMs(o, minutes) {
  const created = new Date(o.createdAt).getTime();
  const placed = o.placedAt ? Date.parse(o.placedAt) : NaN;
  const start = Number.isFinite(placed) && placed <= created && created - placed <= 30 * 60_000 ? placed : created;
  return start + minutes * 60_000;
}
async function findOrder(externalId) {
  const r = await call('GET', '/api/foodhub/orders?limit=500');
  return (r.json?.orders || []).find((o) => o.externalOrderId === externalId);
}
function jetHash(raw, secret = SKIP_HMAC) {
  return `HMAC-SHA256 t=${Date.now()},signature=${crypto.createHmac('sha256', secret).update(raw).digest('base64')}`;
}
async function skipWebhook(path, payload, { hmac = true, key } = {}) {
  const raw = JSON.stringify(payload);
  const headers = hmac ? { 'x-jet-connect-hash': jetHash(raw) } : { authorization: key ?? SKIP_NOTIFY_KEY };
  return call('POST', `/api/foodhub/webhooks/skip/${path}`, { auth: false, raw, headers });
}
const skipOrder = (id, posLocationId, tx) => ({
  id, transmission_id: tx, third_party_order_reference: `SK${id.slice(-4)}`, type: 'delivery-by-delivery-partner', posLocationId,
  items: [
    { name: 'Poulet Grillé', plu: 'clv-item-1', price: 1549, quantity: 1, notes: '', children: [{ name: 'Piri-piri', plu: 'mod-1', price: 100 }] },
    { name: 'Frites', plu: 'clv-item-2', price: 499, quantity: 2, children: [] },
  ],
  created_at: String(Math.floor(Date.now() / 1000)), collect_at: String(Math.floor(Date.now() / 1000) + 1200), kitchen_notes: 'Allergie arachides',
  payment: { items_in_cart: { inc_tax: 2647, tax: 345 }, final: { inc_tax: 2647, tax: 345 } }, delivery: { first_name: '****' }, total: 2647,
});
function uberSigned(raw) {
  return call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } });
}
async function uberWebhook(orderId) {
  const raw = JSON.stringify({ event_type: 'orders.notification', event_id: `evt-${orderId}`, meta: { resource_id: orderId, status: 'pos', user_id: 'uber-store-uuid-1' }, resource_href: `${MOCK}/uber/v2/eats/order/${orderId}` });
  return call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } });
}
// Food Hub Order Relay: the partner posts to ?token=<FOODHUB_RELAY_SECRET> (UrbanPiper-compatible "Order Relay" shapes).
const relayHook = (body, token = RELAY_SECRET) => call('POST', `/api/foodhub/webhooks/relay${token ? `?token=${encodeURIComponent(token)}` : ''}`, { auth: false, body });
const relayOrder = (id, channel = 'Too Good To Go', storeRef = 'tgtg-partner-77') => ({
  customer: { name: 'Julie T.', phone: '5145550123' },
  order: {
    details: { id, channel, created: Date.now() - 30_000, order_type: 'pickup', order_subtotal: 11.98, total_taxes: 0, total_charges: 0, discount: 0, order_total: 11.98,
      instructions: 'Sac réutilisable', brand: { name: 'Po Poulet' }, ext_platforms: [{ id: `TGTG-${id}`, kind: 'food_aggregator', name: channel }] },
    items: [{ id: 1, title: 'Panier surprise', price: 5.99, quantity: 2, total: 11.98 }],
    store: { id: 77, merchant_ref_id: storeRef, name: 'TGTG NDG' },
  },
});
const relayStatus = (id, state, message) => ({ order_id: id, new_state: state, ...(message ? { message } : {}), additional_info: { external_channel: { name: 'Too Good To Go', order_id: `TGTG-${id}` } } });

// ---------------- run ----------------
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(APP_PORT),
  FOODHUB_FORCE_MEMORY: 'true',
  FOODHUB_PUBLIC_URL: 'https://takatak.example',
  FOODHUB_TIMEZONE: 'America/Toronto',
  LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
  UBER_REPORT_ALLOWED_HOSTS: '127.0.0.1',
  FOODHUB_TRUST_PROXY: 'true', // the harness plays several clients through x-forwarded-for // report downloads are otherwise limited to https uber.com / amazonaws.com
  DASHBOARD_PASSWORD: PASSWORD,
  CRON_SECRET: 'cron-e2e',
  UBER_BASE_URL: `${MOCK}/uber`, UBER_AUTH_URL: `${MOCK}/uber/oauth/v2/token`, UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: UBER_SECRET, UBER_WEBHOOK_SIGNING_KEY: 'uber-signing-key-e2e',
  DOORDASH_BASE_URL: `${MOCK}/dd`, DOORDASH_DEVELOPER_ID: 'dd-dev-e2e', DOORDASH_KEY_ID: 'dd-key-e2e', DOORDASH_SIGNING_SECRET: DD_SECRET_B64, DOORDASH_PROVIDER_TYPE: 'takatak_e2e', DOORDASH_WEBHOOK_SECRET: 'dd-hook-e2e',
  SKIP_JET_BASE_URL: `${MOCK}/skip`, SKIP_JET_API_KEY: JET_API_KEY, SKIP_WEBHOOK_HMAC_SECRET: SKIP_HMAC, SKIP_WEBHOOK_API_KEY: SKIP_NOTIFY_KEY,
  TGTG_WEBHOOK_SECRET: 'tgtg-hook-e2e',
  FOODHUB_RELAY_SECRET: RELAY_SECRET, FOODHUB_RELAY_CHANNELS: 'tgtg', FOODHUB_RELAY_CALLBACK_URL: `${MOCK}/relay/callback`, FOODHUB_RELAY_CALLBACK_TOKEN: RELAY_CB_TOKEN,
  CLOVER_BASE_URL: `${MOCK}/clover`, CLOVER_MERCHANT_ID: 'MAINMERCHANT', CLOVER_ACCESS_TOKEN: CLOVER_TOKEN,
  CLOVER_MERCHANT_TOKENS: JSON.stringify({ FAILMERCHANT: 'x' }), CLOVER_WEBHOOK_AUTH: 'clover-auth-e2e',
  CLOVER_CLIENT_ID: 'CLVAPPE2E', CLOVER_CLIENT_SECRET: 'clover-app-secret-e2e', CLOVER_WEB_URL: 'https://www.clover.com',
  FOODHUB_MEDIA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-media-')),
  RESEND_API_KEY: 're_e2e', REPORT_EMAIL_FROM: 'TAKATAK Reports <reports@takatak.example>', RESEND_BASE_URL: `${MOCK}/resend`,
  AUTH_EMAIL_FROM: 'TAKATAK <connexion@takatak.example>',
  TWILIO_ACCOUNT_SID: 'AC_e2e', TWILIO_AUTH_TOKEN: 'tw-e2e', TWILIO_FROM: '+15140000000', TWILIO_BASE_URL: `${MOCK}/twilio`,
  ALERT_WEBHOOK_URL: `${MOCK}/chat`,
  FOODHUB_WATCH_INTERVAL_S: '0', // the e2e drives the Watchtower itself (cron/watch), so runs are deterministic
  // Seconds instead of 30 s / 2 min, so the automatic Clover and webhook retries can be watched end to end.
  FOODHUB_CLOVER_RETRY_S: '2,4', FOODHUB_INBOX_RETRY_S: '2,4', FOODHUB_CLOVER_ORDER_TYPES_TTL_S: '0',
  DOORDASH_DRIVE_BASE_URL: `${MOCK}/drive`, DOORDASH_DRIVE_DEVELOPER_ID: 'drive-dev-e2e', DOORDASH_DRIVE_KEY_ID: 'drive-key-e2e', DOORDASH_DRIVE_SIGNING_SECRET: DRIVE_SECRET_B64,
  DOORDASH_DRIVE_ENV: 'sandbox', DOORDASH_DRIVE_WEBHOOK_SECRET: 'drive-hook-e2e', FOODHUB_WEBSITE_ORDER_SECRET: 'web-order-e2e',
  // Website orders taken by Clover Online Ordering go to this kitchen, under this brand (several kitchens share the merchant).
  FOODHUB_CLOVER_WEBSITE_LOCATION: JSON.stringify({ MAINMERCHANT: 'NDG_6284' }), FOODHUB_CLOVER_WEBSITE_BRAND: 'PPP Pizzeria',
};
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UBER_ACCESS_TOKEN', 'TGTG_SPEC_CONFIRMED', 'SESSION_SECRET', 'FOODHUB_CLOVER_AUTOPRINT', 'CLOVER_PRINT_DEVICE_ID', 'FOODHUB_SYNC_MIN_INTERVAL_S', 'FOODHUB_CLOVER_RECORD_PAYMENT', 'FOODHUB_CLOVER_ORDER_TYPES', 'FOODHUB_CLOVER_INVENTORY_SYNC', 'FOODHUB_CLOVER_DELETE_CANCELLED', 'FOODHUB_SCHEDULED_AFTER_MIN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'FOODHUB_INSECURE_SHOW_CODES', 'TWILIO_MESSAGING_SERVICE_SID', 'FOODHUB_OWNER_EMAIL', 'FOODHUB_OWNER_PHONE', 'FOODHUB_FEATURE_DELIVERY', 'FOODHUB_FEATURE_RETAIL', 'FOODHUB_FEATURE_ALCOHOL', 'FOODHUB_FEATURE_PHONE', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_ORDER_TYPES', 'FOODHUB_CLOVER_WEBSITE_POLL_S', 'FOODHUB_CLOVER_WEBSITE_CLOSE_MIN']) delete env[k];
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });
const up = await waitFor(async () => { try { return (await fetch(`${APP}/api/foodhub/channels`)).status > 0; } catch { return false; } }, 30000);
if (!up) { console.error('App did not start.\n', appLog); process.exit(1); }

const ids = {};
try {
  console.log('\n1. Security');
  const anon = await call('GET', '/', { auth: false, redirect: 'manual' });
  check('Command Center without sign-in → login page', [302, 307].includes(anon.status) && /\/login/.test(anon.location || ''), `${anon.status} ${anon.location}`);
  check('API without sign-in → 401 JSON', (await call('GET', '/api/foodhub/command', { auth: false })).status === 401);
  check('login page is public', (await call('GET', '/login', { auth: false })).status === 200);
  const home = await call('GET', '/');
  check('console opens with the owner recovery password', home.status === 200 && home.text.includes('href="/orders"') && home.text.includes('href="/money"'));
  check('Money section at /money', (await call('GET', '/money')).status === 200);
  check('a malformed sign-in gets a clean error, never a stack trace', !(await call('POST', '/api/foodhub/auth/verify', { auth: false, body: { challengeId: 'x', code: 'abc' } })).text.includes(' at '));
  { const rawK = '{"event_type":"e2e.ping","meta":{"resource_id":"e2e"}}';
    check('Uber webhook accepts the dashboard Signing Key (Basic HMAC)', (await call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw: rawK, headers: { 'x-uber-signature': crypto.createHmac('sha256', 'uber-signing-key-e2e').update(rawK).digest('hex') } })).status === 200); }
  check('Uber webhook rejects a bad signature', (await call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw: '{"event_type":"orders.notification"}', headers: { 'x-uber-signature': 'deadbeef' } })).status === 401);
  check('DoorDash webhook rejects a wrong token', (await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'nope' }, body: { id: 'x' } })).status === 401);
  check('Skip order webhook rejects a forged JET hash', (await call('POST', '/api/foodhub/webhooks/skip/orders', { auth: false, raw: '{"id":"x","items":[]}', headers: { 'x-jet-connect-hash': jetHash('{"id":"x","items":[]}', 'wrong-secret') } })).status === 401);
  check('Skip notification rejects a wrong API key', (await skipWebhook('cancel', { orderID: 'x' }, { hmac: false, key: 'nope' })).status === 401);
  check('TGTG webhook rejects a wrong token', (await call('POST', '/api/foodhub/webhooks/tgtg', { auth: false, headers: { authorization: 'nope' }, body: {} })).status === 401);
  check('scheduled sync rejects a missing CRON_SECRET', (await call('GET', '/api/foodhub/cron/sync', { auth: false })).status === 401);

  const rep1 = await call('POST', '/api/foodhub/client-report', { body: { screen: '/stores/hours', issues: [{ kind: 'api_fail', message: 'PUT /api/foodhub/hours → 500', path: '/api/foodhub/hours', count: 1 }] } });
  check('screen supervisor: a problem on a screen is reported and stored, never silent', rep1.status === 200 && rep1.json?.stored === 1);
  check('screen supervisor refuses unknown report kinds', (await call('POST', '/api/foodhub/client-report', { body: { issues: [{ kind: 'hack', message: 'x' }] } })).status === 400);
  check('screen supervisor needs a signed-in person', (await call('POST', '/api/foodhub/client-report', { auth: false, body: { issues: [] } })).status === 401);
  check('the owner sees recent screen problems', ((await call('GET', '/api/foodhub/client-report')).json?.reports || []).some((r) => r.screen === '/stores/hours' && r.issues?.[0]?.kind === 'api_fail'));

  console.log('\n2. Channels (all direct — no aggregator)');
  const ch = await call('GET', '/api/foodhub/channels');
  const live = Object.fromEntries((ch.json.channels || []).map((c) => [c.channel, c.canSend]));
  check('Uber Eats, DoorDash, SkipTheDishes report LIVE', live.uber_eats && live.doordash && live.skip, JSON.stringify(live));
  check('Too Good To Go stays inbound-only (no public API)', live.tgtg === false && ch.json.channels.find((c) => c.channel === 'tgtg')?.configured === true);
  check('no UrbanPiper channel anywhere', !JSON.stringify(ch.json).toLowerCase().includes('urbanpiper'));
  check('Clover reported connected', ch.json.clover?.configured === true);
  const skipCh = ch.json.channels.find((c) => c.channel === 'skip');
  check('Skip shows its 6 webhook URLs on your public domain (incl. driver status + backup flow)', skipCh.webhookUrl === 'https://takatak.example/api/foodhub/webhooks/skip/orders' && skipCh.extraWebhooks.length === 5 && skipCh.extraWebhooks.some((w) => w.url?.endsWith('/skip/driver') || w.path?.endsWith('/skip/driver')));
  check('Clover webhook URL shown, auth code set', ch.json.clover?.webhookUrl === 'https://takatak.example/api/foodhub/webhooks/clover' && ch.json.clover.webhookAuthSet === true && ch.json.clover.recordPayments === true);
  check('webhook secrets hidden by default', skipCh.handoff.every((h) => h.set && h.value === undefined));
  const rev = await call('GET', '/api/foodhub/channels?reveal=1');
  const revSkip = rev.json.channels.find((c) => c.channel === 'skip');
  check('"Show secrets" reveals the values to give Skip / DoorDash', revSkip.handoff.find((h) => h.envKey === 'SKIP_WEBHOOK_HMAC_SECRET')?.value === SKIP_HMAC && rev.json.channels.find((c) => c.channel === 'doordash').handoff[0].value === 'dd-hook-e2e');
  const revText = JSON.stringify(rev.json);
  check('platform API keys are never revealed', ![UBER_SECRET, DD_SECRET_B64, JET_API_KEY, CLOVER_TOKEN].some((s) => revText.includes(s)));

  console.log('\n3. Store mapping');
  const mk = async (b) => (await call('POST', '/api/foodhub/stores', { body: b })).json?.store;
  ids.uber = await mk({ channel: 'uber_eats', channelStoreId: 'uber-store-uuid-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' });
  ids.dd = await mk({ channel: 'doordash', channelStoreId: 'dd-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' });
  ids.skip = await mk({ channel: 'skip', channelStoreId: 'NDG-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' });
  ids.skipManual = await mk({ channel: 'skip', channelStoreId: 'HOCH-POPOULET', brandName: 'Po Poulet', locationCode: 'HOCHELAGA', autoAccept: false });
  ids.skipFail = await mk({ channel: 'skip', channelStoreId: 'STL-POPOULET', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', cloverMerchantId: 'FAILMERCHANT' });
  ids.uberFail = await mk({ channel: 'uber_eats', channelStoreId: 'uber-store-stl', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', cloverMerchantId: 'FAILMERCHANT' });
  ids.tgtg = await mk({ channel: 'tgtg', channelStoreId: 'tgtg-ndg', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' });
  check('7 store mappings saved', Object.values(ids).every((s) => s?.id));
  const known = (await call('GET', '/api/foodhub/stores/known')).json?.stores || [];
  check('your 7 Uber Eats store UUIDs are pre-loaded with their brand, waiting for a location', known.length === 7 && known.every((k) => k.suggestedBrand && !k.mapped) && known.find((k) => k.name === 'Nutri Shake')?.suggestedBrand === 'Nutrition Shake', JSON.stringify(known.map((k) => [k.name, k.suggestedBrand])));
  const disc = await call('POST', '/api/foodhub/stores/discover', { body: { channel: 'uber_eats' } });
  check('Uber store discovery returns the provisioned store', disc.json?.stores?.[0]?.id === 'uber-store-uuid-1');

  console.log('\n3b. Connect Uber Eats stores (self-serve activation, no aggregator)');
  const start = await call('GET', '/api/foodhub/uber-connect/start', { redirect: 'manual' });
  const authUrl = start.location ? new URL(start.location) : null;
  const state = authUrl?.searchParams.get('state');
  check('"Connect Uber Eats stores" sends the owner to Uber login', [302, 307].includes(start.status) && authUrl?.origin === 'https://auth.uber.com' && authUrl.searchParams.get('scope') === 'eats.pos_provisioning' && authUrl.searchParams.get('redirect_uri') === 'https://takatak.example/api/foodhub/uber-connect/callback' && !!state, `${start.status} ${start.location}`);
  const forged = await call('GET', `/api/foodhub/uber-connect/callback?code=good-code&state=${'0'.repeat(36)}`, { auth: false, redirect: 'manual' });
  check('callback with a forged state is refused', /uber_error=/.test(forged.location || ''));
  const cb = await call('GET', `/api/foodhub/uber-connect/callback?code=good-code&state=${state}`, { auth: false, redirect: 'manual' });
  check('Uber callback exchanges the code and lists your stores', new URL(cb.location || 'http://x').searchParams.get('uber_connect') === state, cb.location);
  const replay = await call('GET', `/api/foodhub/uber-connect/callback?code=good-code&state=${state}`, { auth: false, redirect: 'manual' });
  check('callback link cannot be replayed', /uber_error=/.test(replay.location || ''));
  const sess = (await call('GET', `/api/foodhub/uber-connect/session?id=${state}`)).json;
  const sugg = Object.fromEntries((sess?.stores || []).map((x) => [x.id, `${x.suggestedBrand}|${x.suggestedLocation}`]));
  check('brand + location suggested from Uber name/address', sugg['uber-new-1'] === 'Pi Pita|HOCHELAGA' && sugg['uber-new-2'] === 'OOeuf|NDG_6284', JSON.stringify(sugg));
  check('merchant token never sent to the browser', !JSON.stringify(sess).includes('merchant-token-1'));
  check('the store still on UrbanPiper is shown before activating (pos_data.order_manager_client_id)', sess?.stores?.find((x) => x.id === 'uber-new-2')?.orderManager === 'other' && sess.stores.find((x) => x.id === 'uber-new-1')?.orderManager === 'unknown', JSON.stringify(sess?.stores?.map((x) => [x.id, x.orderManager])));
  check('Clover merchants offered for each store (ids only, no token)', Array.isArray(sess?.cloverMerchants) && sess.cloverMerchants.some((m) => m.id === 'MAINMERCHANT' && m.isDefault) && !JSON.stringify(sess.cloverMerchants).includes(CLOVER_TOKEN), JSON.stringify(sess?.cloverMerchants));
  const actv = await call('POST', '/api/foodhub/uber-connect/activate', { body: { id: state, stores: [{ storeId: 'uber-new-1', brandName: 'Pi Pita', locationCode: 'HOCHELAGA', cloverMerchantId: 'MAINMERCHANT' }, { storeId: 'uber-new-2', brandName: 'OOeuf', locationCode: 'NDG_6284' }] } });
  check('both stores activated (POST pos_data with the merchant token)', actv.json?.results?.every((r) => r.ok) && sent('POST', /\/v1\/eats\/stores\/uber-new-\d\/pos_data$/).filter((e) => e.headers.authorization === 'Bearer merchant-token-1' && e.body?.is_order_manager === true).length === 2, JSON.stringify(actv.json));
  const posBody = sent('POST', /\/v1\/eats\/stores\/uber-new-1\/pos_data$/)[0]?.body;
  check('pos_data body: integrator ids, no manual acceptance, courier webhooks on, webhooks_version unset (v2 order payload)', posBody?.integrator_store_id === 'HOCHELAGA:Pi Pita' && posBody.integrator_brand_id === 'Pi Pita' && posBody.require_manual_acceptance === false && posBody.webhooks_config?.delivery_status_webhooks?.is_enabled === true && !('webhooks_version' in (posBody.webhooks_config || {})), JSON.stringify(posBody));
  check('order webhooks switched on after activation (PATCH pos_data integration_enabled with the app token)', sent('PATCH', /\/v1\/eats\/stores\/uber-new-\d\/pos_data$/).filter((e) => e.headers.authorization === 'Bearer uber-token-1' && e.body?.integration_enabled === true).length === 2);
  const r1 = actv.json?.results?.find((r) => r.storeId === 'uber-new-1');
  const r2 = actv.json?.results?.find((r) => r.storeId === 'uber-new-2');
  check('activation reads back who gets the orders: Food Hub for one, still UrbanPiper for the other (said plainly)', r1?.orderManager === 'foodhub' && /Food Hub now receives/.test(r1.message) && r2?.orderManager === 'other' && /UrbanPiper/.test(r2.message) && /merchants@uber\.com/.test(r2.message), JSON.stringify(actv.json?.results));
  const mapped = (await call('GET', '/api/foodhub/stores')).json.stores.filter((x) => x.channelStoreId.startsWith('uber-new-'));
  check('activated store keeps its Clover register and the order-manager state', mapped.find((x) => x.channelStoreId === 'uber-new-1')?.cloverMerchantId === 'MAINMERCHANT' && mapped.find((x) => x.channelStoreId === 'uber-new-1')?.meta?.uberPos?.orderManager === 'foodhub' && mapped.find((x) => x.channelStoreId === 'uber-new-2')?.meta?.uberPos?.orderManager === 'other');
  uberPosData.set('uber-new-2', { ...uberPosData.get('uber-new-2'), order_manager_client_id: 'uber-id' }); // UrbanPiper lets go
  const chk3 = await call('POST', '/api/foodhub/uber-connect/check', { body: {} });
  check('"Check with Uber" sees the store move to Food Hub once UrbanPiper lets go', chk3.json?.rows?.find((r) => r.storeId === mapped.find((x) => x.channelStoreId === 'uber-new-2')?.id)?.orderManager === 'foodhub', JSON.stringify(chk3.json?.rows));
  check('"Check with Uber" reports stores Uber does not know for this app (no guess)', chk3.json?.rows?.find((r) => r.storeId === ids.uberFail.id)?.ok === false);
  check('activated stores mapped automatically', mapped.length === 2 && mapped.some((x) => x.brandName === 'Pi Pita' && x.locationCode === 'HOCHELAGA'));
  check('merchant token discarded after activation', (await call('POST', '/api/foodhub/uber-connect/activate', { body: { id: state, stores: [{ storeId: 'uber-new-1', brandName: 'Pi Pita', locationCode: 'HOCHELAGA' }] } })).json?.ok === false);

  console.log('\n4. Menu: import from Clover');
  const imp = await call('POST', '/api/foodhub/menu/import', { body: { brand: 'Po Poulet' } });
  check('imported 2 visible items, 2 categories, 1 modifier group', imp.json?.imported?.items === 2 && imp.json.imported.categories === 2 && imp.json.imported.modifierGroups === 1, JSON.stringify(imp.json?.imported));
  const menu = imp.json.menu;
  menu.items[0].channelPrices = { uber_eats: 16.49, skip: 15.49 };
  check('menu saves with per-platform prices', (await call('PUT', '/api/foodhub/menu', { body: { menu } })).json?.ok === true);

  console.log('\n5. Menu: publish to every platform');
  const pub = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const res = pub.json?.results || [];
  const statusOf = (storeId) => res.find((r) => r.channelStoreId === storeId)?.result.status;
  check('Uber done, DoorDash queued, Skip queued, TGTG honestly blocked', statusOf('uber-store-uuid-1') === 'done' && statusOf('dd-popoulet-ndg') === 'queued' && statusOf('NDG-POPOULET') === 'queued' && statusOf('tgtg-ndg') === 'blocked', JSON.stringify(res.map((r) => [r.channelStoreId, r.result.status])));
  const uberMenu = sent('PUT', /^\/uber\/v2\/eats\/stores\/uber-store-uuid-1\/menus$/)[0]?.body;
  check('Uber menu uses the Uber price in cents + modifier items', uberMenu?.items?.find((i) => i.id === 'clv-item-1')?.price_info?.price === 1649 && uberMenu.items.some((i) => i.id === 'mod:mod-1'));
  const ddMenu = sent('POST', /^\/dd\/api\/v1\/menus$/)[0]?.body;
  check('DoorDash menu JWT-signed, with store + provider type', ddMenu?.store?.merchant_supplied_id === 'dd-popoulet-ndg' && ddMenu.store.provider_type === 'takatak_e2e' && ddMenu.menu.categories.length === 2);
  check('DoorDash Menu Status webhook accepted', (await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: { event: { type: 'MenuCreate', status: 'SUCCESS', reference: ddMenu?.reference, details: '' }, menu: { id: 'dd-menu-77' } } })).status === 200);
  const pull = await call('GET', '/api/foodhub/webhooks/doordash/dd-popoulet-ndg', { auth: false, headers: { authorization: 'dd-hook-e2e' } });
  check('DoorDash Menu Request (menu pull) answers { store, menus: [menu + open_hours + special_hours] }', pull.status === 200 && pull.json?.store?.merchant_supplied_id === 'dd-popoulet-ndg' && Array.isArray(pull.json?.menus) && pull.json.menus.length === 1 && Array.isArray(pull.json.menus[0].open_hours) && Array.isArray(pull.json.menus[0].special_hours) && !!pull.json.menus[0].menu, JSON.stringify(pull.json)?.slice(0, 200));
  check('DoorDash menu pull refuses a wrong token and an unmapped location', (await call('GET', '/api/foodhub/webhooks/doordash/dd-popoulet-ndg', { auth: false, headers: { authorization: 'nope' } })).status === 401 && (await call('GET', '/api/foodhub/webhooks/doordash/not-mapped', { auth: false, headers: { authorization: 'dd-hook-e2e' } })).status === 404);
  const ddJob = await waitFor(async () => (await call('GET', '/api/foodhub/channels')).json.jobs.find((j) => j.channel === 'doordash' && j.kind === 'menu_push' && j.status === 'done'));
  check('DoorDash menu job closed + menu id kept for next update', !!ddJob && (await call('GET', '/api/foodhub/stores')).json.stores.find((x) => x.channelStoreId === 'dd-popoulet-ndg')?.meta?.doordashMenuId === 'dd-menu-77');
  const skipMenuCall = sent('POST', /^\/skip\/menus$/).find((e) => e.body?.restaurants?.includes('NDG-POPOULET'));
  const skipItem = skipMenuCall?.body?.menus?.[0]?.categories?.flatMap((c) => c.items).find((i) => i.plu === 'clv-item-1');
  check('Skip menu pushed to JET Connect with X-Flyt-Api-Key', skipMenuCall?.headers['x-flyt-api-key'] === JET_API_KEY);
  check('Skip menu: Skip price in cents, PLUs, pick rules, callback URL', skipItem?.price === 1549 && skipItem.modifiers[0].options[0].plu === 'mod-1' && skipItem.modifiers[0].pick?.range?.to === 1 && skipMenuCall.body.callback_url === 'https://takatak.example/api/foodhub/webhooks/skip/menu-status');
  check('Skip menu-status callback accepted', (await skipWebhook('menu-status', { restaurants: ['NDG-POPOULET'], status: 'success' }, { hmac: false })).status === 200);
  const skipJob = await waitFor(async () => (await call('GET', '/api/foodhub/channels')).json.jobs.find((j) => j.channel === 'skip' && j.kind === 'menu_push' && j.request.channelStoreId === 'NDG-POPOULET' && j.status === 'done'));
  check('Skip menu job marked done by the callback', !!skipJob);

  console.log('\n5b. Menu: publish to all Uber Eats stores (dry run, Do not touch)');
  check('mark the Saint-Léonard Uber store "Do not touch"', (await call('POST', '/api/foodhub/stores', { body: { id: ids.uberFail.id, channel: 'uber_eats', channelStoreId: 'uber-store-stl', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', doNotTouch: true } })).json?.store?.meta?.doNotTouch === true);
  const beforePlan = log.length;
  const plan = (await call('GET', '/api/foodhub/menu/uber')).json?.plan;
  const prow = (cid) => plan?.rows?.find((r) => r.channelStoreId === cid);
  check('dry run lists every Uber store and calls nothing on Uber', plan?.rows?.length === 4 && log.slice(beforePlan).every((e) => !e.path.startsWith('/uber/')), JSON.stringify(plan?.rows?.map((r) => [r.channelStoreId, r.action, r.skip])));
  check('dry run: NDG ready with counts, Saint-Léonard "do not touch", brands without a menu blocked', prow('uber-store-uuid-1')?.action === 'publish' && prow('uber-store-uuid-1').counts?.items === 2 && prow('uber-store-uuid-1').counts.modifierOptions >= 1 && prow('uber-store-stl')?.skip === 'do_not_touch' && prow('uber-new-1')?.skip === 'no_menu', JSON.stringify(plan?.rows?.map((r) => [r.channelStoreId, r.skip, r.counts])));
  check('dry run shows the Uber price next to the Clover price', prow('uber-store-uuid-1')?.samples?.[0]?.base === 14.99 && prow('uber-store-uuid-1').samples[0].uber === 16.49, JSON.stringify(prow('uber-store-uuid-1')?.samples));
  const preview = (await call('GET', `/api/foodhub/menu/uber?storeId=${ids.uber.id}`)).json;
  check('"View JSON" returns the exact Uber body (one translation per text, tax_info on items)', preview?.path === '/v2/eats/stores/uber-store-uuid-1/menus' && preview.body?.items?.every((i) => Object.keys(i.title.translations).length === 1 && i.tax_info) && Array.isArray(preview.body.modifier_groups));
  const beforeAll = log.length;
  const all = await call('POST', '/api/foodhub/menu/uber', { body: {} });
  const allPuts = log.slice(beforeAll).filter((e) => e.method === 'PUT' && /\/uber\/v2\/eats\/stores\/[^/]+\/menus$/.test(e.path)).map((e) => e.path);
  check('publish to all Uber stores: only the ready store is sent, never the "do not touch" one', allPuts.length === 1 && allPuts[0].includes('uber-store-uuid-1') && all.json?.sent === 1 && all.json.untouched === 1 && all.json.blocked === 2, JSON.stringify({ allPuts, sent: all.json?.sent, untouched: all.json?.untouched, blocked: all.json?.blocked }));
  const beforeDnt = log.length;
  await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  check('a normal brand publish leaves the "do not touch" store alone too', !log.slice(beforeDnt).some((e) => e.path.includes('uber-store-stl/menus')) && log.slice(beforeDnt).some((e) => e.path.includes('uber-store-uuid-1/menus')));
  await call('POST', '/api/foodhub/stores', { body: { id: ids.uberFail.id, channel: 'uber_eats', channelStoreId: 'uber-store-stl', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', doNotTouch: false } });

  console.log('\n6. Uber Eats order (signed webhook → Clover → accept)');
  check('signed Uber webhook accepted', (await uberWebhook('uber-order-1')).status === 200);
  const o1 = await waitFor(async () => { const o = await findOrder('uber-order-1'); return o?.status === 'accepted' ? o : null; });
  check('Uber order fetched, parsed, accepted', o1?.total === 39.07 && o1.lines[0].quantity === 2, JSON.stringify(o1 && { total: o1.total, s: o1.status }));
  const li1 = sent('POST', /\/atomic_order\/orders$/)[0]?.body?.orderCart?.lineItems?.[0];
  check('order created in Clover with the inventory item and its real Clover modification (Piri-piri +1.00)', o1?.posOrderId?.startsWith('CLV') && li1?.item?.id === 'clv-item-1' && li1.price === 1499
    && JSON.stringify(li1.modifications) === JSON.stringify([{ modifier: { id: 'mod-1' }, name: 'Piri-piri', amount: 100 }]), JSON.stringify(li1));
  check('Uber accept carries the Clover order id', sent('POST', /^\/uber\/v1\/eats\/orders\/uber-order-1\/accept_pos_order$/)[0]?.body?.external_reference_id === o1?.posOrderId);
  const cloverBefore = sent('POST', /\/atomic_order\/orders$/).length;
  await uberWebhook('uber-order-1');
  await sleep(800);
  check('duplicate webhook does not create a second Clover order', sent('POST', /\/atomic_order\/orders$/).length === cloverBefore);
  const fetchesBefore = sent('GET', /\/uber\/v2\/eats\/order\/uber-order-1$/).length;
  await uberWebhook('uber-order-1');
  await sleep(500);
  check('a re-delivered event (same event_id) is not even fetched again (webhook inbox)', sent('GET', /\/uber\/v2\/eats\/order\/uber-order-1$/).length === fetchesBefore);
  const courierRaw = JSON.stringify({ event_type: 'delivery.state_changed', event_id: 'evt-courier-1', meta: { courier_trip_id: 'trip-1', store_id: 'uber-store-uuid-1', order_id: 'uber-order-1', status: 'ARRIVED_AT_PICKUP' } });
  check('delivery.state_changed (order id in meta.order_id, as documented) accepted', (await uberSigned(courierRaw)).status === 200);
  check('courier "at the store" reaches the order', !!(await waitFor(async () => (await findOrder('uber-order-1'))?.timeline?.courier?.status === 'at_store')));

  console.log('\n7. DoorDash order (JWT)');
  const ddOrder = { id: 'dd-order-1', store: { merchant_supplied_id: 'dd-popoulet-ndg' }, consumer: { first_name: 'Luc', last_name: 'Roy' }, subtotal: 1499, tax: 225, delivery_short_code: 'XY9',
    categories: [{ name: 'Plats', items: [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }] }] };
  check('DoorDash order webhook answered 202 (confirmed later, only once Clover has it)', (await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: ddOrder })).status === 202);
  const o2 = await waitFor(async () => { const o = await findOrder('dd-order-1'); return o?.status === 'accepted' ? o : null; });
  check('DoorDash order confirmed (order_status success)', !!o2 && sent('PATCH', /^\/dd\/api\/v1\/orders\/dd-order-1$/)[0]?.body?.order_status === 'success');
  const ready = await call('POST', `/api/foodhub/orders/${o2?.id}`, { body: { action: 'ready' } });
  check('Ready → DoorDash order_ready_for_pickup', ready.json?.order?.status === 'ready' && sent('PATCH', /\/events\/order_ready_for_pickup$/).length === 1);

  console.log('\n8. SkipTheDishes order — direct JET Connect');
  const sk = await skipWebhook('orders', skipOrder('skip-order-0001', 'NDG-POPOULET', 'tx-0001'));
  check('signed Skip order answered 202 (async, as JET requires)', sk.status === 202);
  const o3 = await waitFor(async () => { const o = await findOrder('skip-order-0001'); return o?.status === 'accepted' ? o : null; });
  check('Skip order parsed (cents → $), mapped, accepted', o3?.total === 26.47 && o3.brandName === 'Po Poulet' && o3.locationCode === 'NDG_MAIN' && o3.notes === 'Allergie arachides', JSON.stringify(o3 && { t: o3.total, s: o3.status }));
  const skipClover = log.filter((e) => e.method === 'POST' && /\/atomic_order\/orders$/.test(e.path)).find((e) => /Skip/i.test(JSON.stringify(e.body)) || e.body?.orderCart?.lineItems?.length === 3)?.body;
  check('Skip order in Clover: 3 lines (2× Frites), Skip price + the modifier as a Clover modification', skipClover?.orderCart?.lineItems?.length === 3 && skipClover.orderCart.lineItems[0].price === 1549 && skipClover.orderCart.lineItems[0].modifications?.[0]?.amount === 100 && skipClover.orderCart.lineItems[0].item?.id === 'clv-item-1', JSON.stringify(skipClover?.orderCart?.lineItems?.[0]));
  check('JET told sent-to-pos-success with the transmissionId', sent('POST', /^\/skip\/order\/skip-order-0001\/sent-to-pos-success$/)[0]?.body?.transmissionId === 'tx-0001');
  const skBefore = sent('POST', /\/atomic_order\/orders$/).length;
  await skipWebhook('orders', skipOrder('skip-order-0001', 'NDG-POPOULET', 'tx-0001'));
  await sleep(800);
  check('Skip re-delivery does not duplicate the Clover order', sent('POST', /\/atomic_order\/orders$/).length === skBefore);

  console.log('\n9. Skip manual store + Skip cancel notification');
  await skipWebhook('orders', skipOrder('skip-order-0002', 'HOCH-POPOULET', 'tx-0002'));
  const o4 = await waitFor(async () => { const o = await findOrder('skip-order-0002'); return o?.posOrderId ? o : null; });
  check('auto-accept OFF: order waits in New (already in Clover)', o4?.status === 'new');
  const cc0 = await call('GET', '/api/foodhub/command');
  const q4 = cc0.json?.queue?.find((q) => q.id === o4?.id);
  check('Command Center queue shows it with the 5-minute Skip deadline (from when it was placed)', q4 && Math.abs(new Date(q4.deadlineAt).getTime() - expectedDeadlineMs(o4, 5)) < 1000 && new Date(q4.deadlineAt).getTime() <= new Date(q4.createdAt).getTime() + 5 * 60_000 + 1000);
  const acc = await call('POST', `/api/foodhub/orders/${o4?.id}`, { body: { action: 'accept' } });
  check('manual Accept → sent-to-pos-success', acc.json?.order?.status === 'accepted' && sent('POST', /^\/skip\/order\/skip-order-0002\/sent-to-pos-success$/).length === 1);
  check('Skip cancel notification accepted', (await skipWebhook('cancel', { orderID: 'skip-order-0002', reason: { code: 'customer_cancelled' }, happenedAt: new Date().toISOString() }, { hmac: false })).status === 200);
  check('order cancelled from Skip', !!(await waitFor(async () => (await findOrder('skip-order-0002'))?.status === 'cancelled')));

  console.log('\n10. Clover down — never accept what the kitchen did not get');
  await skipWebhook('orders', skipOrder('skip-order-0003', 'STL-POPOULET', 'tx-0003'));
  const o5 = await waitFor(async () => { const o = await findOrder('skip-order-0003'); return o?.status === 'failed' ? o : null; });
  check('Skip: Clover failure → sent-to-pos-failed (Skip tablet backup flow)', o5?.posError && sent('POST', /^\/skip\/order\/skip-order-0003\/sent-to-pos-failed$/)[0]?.body?.transmissionId === 'tx-0003' && sent('POST', /skip-order-0003\/sent-to-pos-success$/).length === 0);
  await uberWebhook('uber-order-stl-1');
  const o6 = await waitFor(async () => { const o = await findOrder('uber-order-stl-1'); return o?.posError ? o : null; });
  check('Uber: Clover failure → NOT accepted, waits for staff', o6?.status === 'new' && sent('POST', /uber-order-stl-1\/accept_pos_order$/).length === 0);

  console.log('\n11. 86 an item on every platform');
  const av = await call('POST', '/api/foodhub/availability', { body: { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['clv-item-2'], available: false, minutes: 60 } });
  const avCh = Object.fromEntries((av.json?.results || []).map((r) => [r.channel, r.result.status]));
  check('86 sent to Uber, DoorDash, Skip', avCh.uber_eats === 'done' && avCh.doordash === 'done' && avCh.skip === 'queued', JSON.stringify(avCh));
  check('Uber item suspended', sent('POST', /\/menus\/items\/clv-item-2$/).pop()?.body?.suspension_info?.suspension?.suspend_until > 0);
  check('DoorDash item deactivated (PUT items/status)', sent('PUT', /\/dd\/api\/v1\/stores\/dd-popoulet-ndg\/items\/status$/).pop()?.body?.[0]?.is_active === false);
  const skAv = sent('POST', /^\/skip\/item-availability$/).pop()?.body;
  check('Skip item-availability UNAVAILABLE with nextAvailableAt', skAv?.event === 'UNAVAILABLE' && skAv.itemReferences?.[0] === 'clv-item-2' && skAv.restaurant === 'NDG-POPOULET' && new Date(skAv.nextAvailableAt).getTime() > Date.now());
  check('86 state saved for the location', (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu.unavailableByLocation?.NDG_MAIN?.includes('clv-item-2'));

  console.log('\n12. Pause and resume a location');
  const ndg = [ids.uber.id, ids.dd.id, ids.skip.id];
  const pause = await call('POST', '/api/foodhub/stores/status', { body: { storeIds: ndg, online: false, minutes: 30, reason: 'Kitchen overloaded' } });
  check('pause sent to all 3 platforms', (pause.json?.results || []).every((r) => r.result.ok) && pause.json.results.length === 3);
  check('Uber store PAUSED with paused_until (no milliseconds) on /v1/eats/store/{id}/status', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(sent('POST', /\/v1\/eats\/store\/uber-store-uuid-1\/status$/).pop()?.body?.paused_until ?? ''));
  const ddPause = sent('PUT', /\/stores\/dd-popoulet-ndg\/status$/).pop()?.body;
  check('DoorDash deactivated with end_time', ddPause?.is_active === false && !!ddPause.end_time);
  check('Skip offline with local onlineAt (YYYY-MM-DD HH:MM:SS)', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sent('PUT', /^\/skip\/restaurants\/NDG-POPOULET\/offline$/).pop()?.body?.onlineAt || ''));
  const resume = await call('POST', '/api/foodhub/stores/status', { body: { storeIds: ndg, online: true } });
  check('resume sent to all 3 platforms', (resume.json?.results || []).every((r) => r.result.ok) && sent('PUT', /^\/skip\/restaurants\/NDG-POPOULET\/online$/).length === 1 && sent('PUT', /\/stores\/dd-popoulet-ndg\/status$/).pop()?.body?.is_active === true);

  console.log('\n13. Too Good To Go (inbound only)');
  await call('POST', '/api/foodhub/webhooks/tgtg', { auth: false, headers: { authorization: 'tgtg-hook-e2e' }, body: { id: 'tgtg-1', storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99 } });
  const o7 = await waitFor(async () => { const o = await findOrder('tgtg-1'); return o?.posOrderId ? o : null; });
  const ev7 = (await call('GET', `/api/foodhub/orders/${o7?.id}`)).json?.events || [];
  check('TGTG bag order received, in Clover; accept logged as "nothing sent" (no fake API call)', o7?.locationCode === 'NDG_MAIN' && o7.status === 'accepted' && ev7.some((e) => e.type === 'accepted' && e.detail?.response?.status === 'skipped'));
  await call('POST', '/api/foodhub/webhooks/tgtg', { auth: false, headers: { authorization: 'tgtg-hook-e2e' }, body: { weird: true } });
  const unparsedTgtg = await waitFor(async () => ((await call('GET', '/api/foodhub/channels')).json?.unparsed || []).find((j) => j.channel === 'tgtg'));
  check('unknown payload kept, not lost', !!unparsedTgtg && JSON.stringify(unparsedTgtg.request).includes('weird'), JSON.stringify(unparsedTgtg)?.slice(0, 160));

  console.log('\n14. Automatic sync: platform status + Clover in-store sales');
  uberStatus.set('uber-store-uuid-1', { status: 'OFFLINE', offlineReason: 'OUT_OF_MENU_HOURS' });
  knownUberStores.delete('uber-store-stl');
  ddDetails.set('dd-popoulet-ndg', { merchant_supplied_id: 'dd-popoulet-ndg', current_deactivations: [{ reason: 'out_of_business', notes: 'Deactivated by DoorDash' }] });
  check('Skip "restaurant offline" notification accepted', (await skipWebhook('offline', { restaurantId: 'NDG-POPOULET', delivery: { isOffline: true }, collection: { isOffline: true } }, { hmac: false })).status === 200);
  await sleep(500);
  const sy = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  const rep = sy.json?.report;
  const stState = (sid) => rep?.stores?.find((s) => s.channelStoreId === sid);
  check('sync ran and polled every Uber + DoorDash store', sy.json?.ran === true && rep.stores.filter((s) => s.polled).length === rep.stores.filter((s) => s.channel === 'uber_eats' || s.channel === 'doordash').length && rep.stores.filter((s) => s.polled).length >= 5, JSON.stringify(rep?.stores?.map((s) => [s.channelStoreId, s.state, s.polled])));
  check('Uber OUT_OF_MENU_HOURS → closed (Z rule)', stState('uber-store-uuid-1')?.state === 'closed');
  check('DoorDash current_deactivations → deactivated', stState('dd-popoulet-ndg')?.state === 'deactivated');
  check('Uber store missing on Uber (404) → unknown with the error, not deactivated', stState('uber-store-stl')?.state !== 'deactivated' && /404/.test(stState('uber-store-stl')?.error || ''), JSON.stringify(stState('uber-store-stl')));
  check('Skip state comes from its offline notification', stState('NDG-POPOULET')?.state === 'paused' && stState('NDG-POPOULET')?.polled === false);
  const main = rep?.clover?.find((c) => c.merchantId === 'MAINMERCHANT');
  check('Clover in-store = payments − refunds, delivery orders excluded ($35.00)', main?.ok && main.net === 35 && main.payments === 2 && main.tips === 3, JSON.stringify(main));
  check('Clover queried from local midnight (createdTime filter)', /createdTime%3E%3D\d{13}/.test(log.find((e) => e.path.endsWith('/payments'))?.query || ''));
  check('Clover outage reported per merchant, not hidden', rep?.clover?.find((c) => c.merchantId === 'FAILMERCHANT')?.ok === false);
  const ddStore = (await call('GET', '/api/foodhub/stores')).json.stores.find((s) => s.id === ids.dd.id);
  check('DoorDash store now marked offline in Food Hub', ddStore?.online === false && ddStore.meta?.platformStatus?.state === 'deactivated');
  check('second sync within 60 s is rate-limited', (await call('POST', '/api/foodhub/sync', { body: {} })).json?.ran === false);
  const cron = await call('GET', '/api/foodhub/cron/sync', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  check('scheduled sync (CRON_SECRET) runs', cron.json?.ok === true && cron.json.ran === true);

  console.log('\n15. One-screen Command Center');
  const cc = (await call('GET', '/api/foodhub/command')).json;
  const orders = (await call('GET', '/api/foodhub/orders?limit=500')).json.orders;
  const expectedSales = Math.round(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0) * 100) / 100;
  check('delivery sales = every order except cancelled', cc?.kpis?.deliverySales === expectedSales, `${cc?.kpis?.deliverySales} vs ${expectedSales}`);
  check('total = delivery + Clover in-store', cc.kpis.inStore === 35 && cc.kpis.combinedSales === Math.round((expectedSales + 35) * 100) / 100);
  check('sales by hour adds up', Math.abs(cc.byHour.reduce((s, h) => s + h.sales, 0) - expectedSales) < 0.01);
  check('per-platform tiles: Uber 2 orders, DoorDash 1, Skip 2 (excl. cancelled), TGTG 1', ['uber_eats:2', 'doordash:1', 'skip:2', 'tgtg:1'].every((x) => { const [c, n] = x.split(':'); return cc.channels.find((t) => t.channel === c)?.orders === Number(n); }), JSON.stringify(cc.channels.map((c) => [c.channel, c.orders])));
  const row = cc.matrix.find((r) => r.brandName === 'Po Poulet' && r.locationCode === 'NDG_MAIN');
  check('matrix Po Poulet · NDG: Uber closed, DoorDash deactivated, Skip paused, TGTG open', row?.cells.uber_eats.state === 'closed' && row.cells.doordash.state === 'deactivated' && row.cells.skip.state === 'paused' && row.cells.tgtg.state === 'online', JSON.stringify(row?.cells && Object.fromEntries(Object.entries(row.cells).map(([k, v]) => [k, v.state]))));
  check('matrix includes your 43 screenshot DoorDash stores (faded)', cc.matrix.some((r) => r.brandName === 'Nutrition Shake' && r.cells.doordash.source === 'screenshot'));
  const titles = cc.alerts.map((a) => `${a.severity}:${a.title}`);
  const has = (sev, re) => titles.some((t) => t.startsWith(sev) && re.test(t));
  check('alert: Clover did not receive the Uber order (critical)', has('critical', /Clover did not receive Uber Eats/));
  check('alert: DoorDash store DEACTIVATED (critical)', has('critical', /Po Poulet · NDG MAIN on DoorDash is DEACTIVATED/));
  check('alert: Skip order on the Skip tablet', has('warning', /on the Skip tablet/));
  check('alert: Skip paused by the platform', has('warning', /NDG MAIN on SkipTheDishes was paused by the platform/));
  check('alert: missing required services (Uber / Skip)', has('warning', /Uber Eats not connected for \d+ brand\/location/) && has('warning', /SkipTheDishes not connected for \d+/));
  check('alert: Clover merchant outage', has('warning', /Clover sales unavailable for merchant FAILMERCHANT/));
  check('alert: unreadable webhook kept', has('warning', /could not be read/));
  check('critical alerts listed first', cc.alerts[0].severity === 'critical');
  check('a store missing on Uber gives one clear alert (not two)', titles.filter((t) => /SAINT-LÉONARD on Uber Eats/.test(t)).length === 1);
  const q6 = cc.queue.find((q) => q.id === o6?.id);
  check('Uber order with Clover failure is in the queue with its 11.5-min deadline', q6 && q6.posError && Math.abs(new Date(q6.deadlineAt).getTime() - expectedDeadlineMs(o6, 11.5)) < 1000 && new Date(q6.deadlineAt).getTime() <= new Date(q6.createdAt).getTime() + 690_000 + 1000);
  const retry = await call('POST', `/api/foodhub/orders/${o6?.id}`, { body: { action: 'retry_pos' } });
  check('"Send to Clover" retries honestly (still down → not ok)', retry.json?.result?.ok === false);
  const deny = await call('POST', `/api/foodhub/orders/${o6?.id}`, { body: { action: 'deny', reason: 'Item out of stock' } });
  check('Reject from the queue → Uber deny_pos_order, order cancelled', deny.json?.order?.status === 'cancelled' && sent('POST', /uber-order-stl-1\/deny_pos_order$/).length === 1);
  const cc2 = (await call('GET', '/api/foodhub/command')).json;
  check('handled order leaves the queue and its critical alert clears', !cc2.queue.some((q) => q.id === o6?.id) && !cc2.alerts.some((a) => a.id === `pos:${o6?.id}`));

  console.log('\n16. Users, roles and location scope');
  const mkUser = await call('POST', '/api/foodhub/users', { body: { username: 'sara.hoch', name: 'Sara', role: 'operator', locations: ['HOCHELAGA'], password: 'operator-pass-1' } });
  check('owner creates a store operator limited to HOCHELAGA (no hash returned)', mkUser.json?.user?.role === 'operator' && !JSON.stringify(mkUser.json).includes('scrypt'), JSON.stringify(mkUser.json));
  check('a too-short password is refused', (await call('POST', '/api/foodhub/users', { body: { username: 'x.y', role: 'operator', password: 'short' } })).status === 400);
  check('wrong password refused', (await call('POST', '/api/foodhub/auth/login', { auth: false, body: { username: 'sara.hoch', password: 'wrong-pass' } })).status === 401);
  const li = await call('POST', '/api/foodhub/auth/login', { auth: false, body: { username: 'sara.hoch', password: 'operator-pass-1' } });
  const cookie = (li.cookie || '').split(';')[0];
  check('operator signs in (HttpOnly session cookie)', li.status === 200 && /^takatak_session=/.test(cookie) && /HttpOnly/i.test(li.cookie || ''), `${li.status} ${li.cookie}`);
  const me = await call('GET', '/api/foodhub/auth/me', { cookie });
  check('session carries role + locations', me.json?.user?.role === 'operator' && me.json.user.locations?.[0] === 'HOCHELAGA' && !me.json.user.permissions.includes('admin'));
  const opOrders = (await call('GET', '/api/foodhub/orders?limit=500', { cookie })).json?.orders || [];
  check('operator only sees HOCHELAGA orders', opOrders.length > 0 && opOrders.every((o) => o.locationCode === 'HOCHELAGA'), JSON.stringify(opOrders.map((o) => o.locationCode)));
  check("operator cannot open another location's order", (await call('GET', `/api/foodhub/orders/${o1?.id}`, { cookie })).status === 404);
  check('operator cannot pause NDG stores', (await call('POST', '/api/foodhub/stores/status', { cookie, body: { storeIds: [ids.uber.id], online: false } })).status === 403);
  const denied = await Promise.all([call('POST', '/api/foodhub/menu/publish', { cookie, body: { brand: 'Po Poulet' } }), call('GET', '/api/foodhub/users', { cookie }), call('GET', '/api/foodhub/analytics', { cookie }), call('GET', '/api/foodhub/channels?reveal=1', { cookie })]);
  check('operator cannot publish menus, manage users, see analytics or reveal secrets', denied.every((r) => r.status === 403), denied.map((r) => r.status).join(','));
  const opCc = (await call('GET', '/api/foodhub/command', { cookie })).json;
  check('operator Command Center shows HOCHELAGA only', opCc?.byLocation?.length === 1 && opCc.byLocation[0].locationCode === 'HOCHELAGA' && opCc.matrix.every((r) => r.locationCode === 'HOCHELAGA'));
  const opPage = await call('GET', '/', { cookie });
  check('operator menu hides Money, Insights and admin pages', opPage.status === 200 && opPage.text.includes('href="/orders"') && !opPage.text.includes('href="/money"') && !opPage.text.includes('href="/insights"') && opPage.text.includes('Sara'));
  const noSess = await call('GET', '/insights', { auth: false, redirect: 'manual' });
  check('pages without a session go to /login?next=…', [302, 307].includes(noSess.status) && /\/login\?next=%2Finsights/.test(noSess.location || ''), noSess.location);
  check('a forged session cookie is refused', (await call('GET', '/api/foodhub/auth/me', { cookie: `${cookie.slice(0, -4)}AAAA` })).status === 401);

  console.log('\n17. Store hours + holidays → every platform');
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const week = Object.fromEntries(DAYS.map((d) => [d, [{ open: '11:00', close: '22:00' }]]));
  week.friday = [{ open: '11:00', close: '02:00' }];
  week.sunday = [];
  const today = localDay(0);
  const badHours = await call('PUT', '/api/foodhub/hours', { body: { hours: { locations: { NDG_MAIN: { ...week, monday: [{ open: '25:00', close: '10:00' }] } }, brands: {}, holidays: [] } } });
  check('impossible hours refused (400)', badHours.status === 400, `${badHours.status}`);
  const hol = [
    { id: 'h-ndg', date: localDay(10), name: 'Fermé — rénovation', locationCodes: ['NDG_MAIN'], closed: true },
    { id: 'h-all', date: localDay(12), name: 'Short day', locationCodes: [], closed: false, slots: [{ open: '12:00', close: '16:00' }] },
    { id: 'h-hoch', date: today, name: 'Closed today', locationCodes: ['HOCHELAGA'], closed: true },
  ];
  const hrs = await call('PUT', '/api/foodhub/hours', { body: { hours: { locations: { NDG_MAIN: week, HOCHELAGA: week, SAINT_LEONARD: week, NDG_6284: week }, brands: {}, holidays: hol } } });
  const savedNdg = hrs.json?.hours?.locations?.NDG_MAIN;
  check('hours saved; overnight Friday split into Fri 11:00–23:59 + Sat 00:00–02:00', savedNdg?.friday?.[0]?.close === '23:59' && savedNdg.saturday?.[0]?.open === '00:00' && savedNdg.saturday[0].close === '02:00' && savedNdg.sunday.length === 0, JSON.stringify(savedNdg?.saturday));
  const before17 = log.length;
  const pub17 = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  check('publish with hours accepted by every platform', (pub17.json?.results || []).filter((r) => r.channel !== 'tgtg').every((r) => r.result.ok), JSON.stringify(pub17.json?.results?.map((r) => [r.channelStoreId, r.result.status, r.result.message])));
  const after17 = log.slice(before17);
  const uberMenu17 = after17.find((e) => e.method === 'PUT' && /\/uber\/v2\/eats\/stores\/uber-store-uuid-1\/menus$/.test(e.path))?.body;
  const sa = uberMenu17?.menus?.[0]?.service_availability || [];
  check('Uber menu hours: Mon 11:00–22:00, Sunday closed', sa.find((d) => d.day_of_week === 'monday')?.time_periods?.[0]?.start_time === '11:00' && sa.find((d) => d.day_of_week === 'monday').time_periods[0].end_time === '22:00' && !sa.some((d) => d.day_of_week === 'sunday'), JSON.stringify(sa.slice(0, 2)));
  const uberHol = after17.find((e) => e.method === 'POST' && /\/uber\/v1\/eats\/stores\/uber-store-uuid-1\/holiday-hours$/.test(e.path))?.body?.holiday_hours;
  check('Uber holiday-hours: closed day = 00:00–00:00 + short day 12:00–16:00 (NDG only)', uberHol?.[localDay(10)]?.open_time_periods?.length === 1 && uberHol[localDay(10)].open_time_periods[0].start_time === '00:00' && uberHol[localDay(10)].open_time_periods[0].end_time === '00:00' && uberHol[localDay(12)]?.open_time_periods?.[0]?.start_time === '12:00' && !uberHol[today], JSON.stringify(uberHol));
  const ddMenu17 = after17.find((e) => /\/dd\/api\/v1\/menus/.test(e.path) && e.body?.store?.merchant_supplied_id === 'dd-popoulet-ndg')?.body;
  check('DoorDash open_hours in HH:MM:SS, Sunday (closed) omitted', ddMenu17?.open_hours?.some((h) => h.day_index === 'MON' && h.start_time === '11:00:00' && h.end_time === '22:00:00') && !ddMenu17.open_hours.some((h) => h.day_index === 'SUN') && !ddMenu17.open_hours.some((h) => h.start_time === h.end_time), JSON.stringify(ddMenu17?.open_hours?.slice(0, 3)));
  check('DoorDash special_hours: closed day (full-day 00:00:00–23:59:59) + special hours', ddMenu17?.special_hours?.some((h) => h.date === localDay(10) && h.closed === true && h.start_time === '00:00:00' && h.end_time === '23:59:59') && ddMenu17.special_hours.some((h) => h.date === localDay(12) && h.closed === false && h.start_time === '12:00:00'), JSON.stringify(ddMenu17?.special_hours));
  check('DoorDash menu update uses the menu id it was given (PATCH)', after17.some((e) => e.method === 'PATCH' && /\/dd\/api\/v1\/menus\/dd-menu-77$/.test(e.path)));
  const skipMenu17 = after17.find((e) => e.path === '/skip/menus' && e.body?.restaurants?.includes('NDG-POPOULET'))?.body;
  check('Skip menu availability per day ("11:00 - 22:00")', skipMenu17?.menus?.[0]?.availability?.monday?.[0] === '11:00 - 22:00' && (skipMenu17.menus[0].availability.sunday ?? []).length === 0, JSON.stringify(skipMenu17?.menus?.[0]?.availability));
  const holSync = await call('GET', '/api/foodhub/cron/sync', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  const hochOff = sent('PUT', /^\/skip\/restaurants\/HOCH-POPOULET\/offline$/).pop()?.body;
  check('closed holiday today → Skip HOCHELAGA taken offline until midnight (Skip has no holiday API)', holSync.json?.ran === true && holSync.json.holidayClosures === 1 && /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(hochOff?.onlineAt || ''), `${JSON.stringify(holSync.json)} ${JSON.stringify(hochOff)}`);
  const holSync2 = await call('GET', '/api/foodhub/cron/sync', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  check('holiday closure is applied once per day', holSync2.json?.ran === true && holSync2.json.holidayClosures === 0);

  console.log('\n18. Category schedule (e.g. lunch only)');
  const m18 = (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu;
  const lunchCat = m18.categories.find((c) => c.name === 'Plats');
  const lunch = Object.fromEntries(DAYS.map((d) => [d, [{ open: '09:00', close: '14:00' }]]));
  m18.categories = m18.categories.map((c) => (c.ref === lunchCat.ref ? { ...c, hours: lunch } : c));
  m18.items[0] = { ...m18.items[0], description: 'Demi-poulet grillé', tags: ['spicy', 'halal'], allergens: ['moutarde'], calories: 780 };
  check('category schedule + item details saved', (await call('PUT', '/api/foodhub/menu', { body: { menu: m18 } })).json?.ok === true);
  const before18 = log.length;
  await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const after18 = log.slice(before18);
  const uber18 = after18.find((e) => e.method === 'PUT' && /uber-store-uuid-1\/menus$/.test(e.path))?.body;
  const sched = uber18?.menus?.find((m) => m.id !== 'takatak-main');
  check('Uber: lunch category in its own menu, 11:00–14:00 (inside store hours)', uber18?.menus?.length === 2 && sched?.service_availability?.find((d) => d.day_of_week === 'monday')?.time_periods?.[0]?.start_time === '11:00' && sched.service_availability.find((d) => d.day_of_week === 'monday').time_periods[0].end_time === '14:00', JSON.stringify(uber18?.menus?.map((m) => [m.id, m.service_availability?.[0]])));
  const uberItem18 = uber18?.items?.find((i) => i.id === m18.items[0].ref);
  const uberDesc18 = Object.values(uberItem18?.description?.translations || {})[0] || '';
  check('Uber item: description with tags + allergens, calories as energy_interval (E5)', /Spicy/.test(uberDesc18) && /moutarde/i.test(uberDesc18) && uberItem18.nutritional_info?.calories?.energy_interval?.lower === 78000000 && !('lower_range' in (uberItem18.nutritional_info?.calories || {})), JSON.stringify(uberItem18?.nutritional_info));
  const dd18 = after18.find((e) => /\/dd\/api\/v1\/menus/.test(e.path) && e.body?.store?.merchant_supplied_id === 'dd-popoulet-ndg')?.body;
  const ddItem18 = dd18?.menu?.categories?.flatMap((c) => c.items).find((i) => i.merchant_supplied_id === m18.items[0].ref);
  check('DoorDash: scheduled items carry item_special_hours (lunch ∩ store hours = 11:00–14:00)', ddItem18?.item_special_hours?.some((h) => h.day_index === 'MON' && h.start_time === '11:00:00' && h.end_time === '14:00:00'), JSON.stringify(ddItem18?.item_special_hours?.[0]));
  const sk18 = after18.find((e) => e.path === '/skip/menus' && e.body?.restaurants?.includes('NDG-POPOULET'))?.body;
  check('Skip: lunch category published as a second menu with its own hours', sk18?.menus?.length === 2 && sk18.menus[1].availability?.monday?.[0] === '11:00 - 14:00', JSON.stringify(sk18?.menus?.map((m) => [m.reference, m.availability?.monday])));

  console.log('\n19. Menu check blocks a broken publish');
  const broken = { ...m18, items: [...m18.items, { ref: 'orphan-1', name: 'Orphan', price: 5, categoryRef: 'no-such-category', available: true, modifierGroupRefs: [] }], modifierGroups: m18.modifierGroups.map((g) => ({ ...g, min: 3, max: 1 })) };
  await call('PUT', '/api/foodhub/menu', { body: { menu: broken } });
  const before19 = log.length;
  const blocked = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const codes = (blocked.json?.check?.errors || []).map((e) => e.code);
  check('publish refused (422) with the reasons', blocked.status === 422 && codes.includes('item_category') && codes.includes('group_min_max'), `${blocked.status} ${codes}`);
  check('nothing was sent to any platform', log.slice(before19).every((e) => !/menus/.test(e.path)));
  const chk = (await call('GET', '/api/foodhub/menu/publish?brand=Po%20Poulet')).json;
  check('menu check lists errors, warnings and tips + per-store publish status', chk?.check?.ok === false && Array.isArray(chk.check.warnings) && chk.check.tips.length > 0 && chk.stores.some((s) => s.channelStoreId === 'uber-store-uuid-1' && s.status === 'done'));
  await call('PUT', '/api/foodhub/menu', { body: { menu: m18 } });
  check('menu fixed → check passes again', (await call('GET', '/api/foodhub/menu/publish?brand=Po%20Poulet')).json?.check?.ok === true);

  console.log('\n19b. Platform markup (in-store price stays in Clover, +20 % on DoorDash)');
  const m19 = (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu;
  check('a markup outside -50..200 % is refused', (await call('PUT', '/api/foodhub/menu', { body: { menu: { ...m19, channelMarkupPct: { doordash: 500 } } } })).status === 400);
  check('DoorDash +20 % saved on the menu', (await call('PUT', '/api/foodhub/menu', { body: { menu: { ...m19, channelMarkupPct: { doordash: 20 } } } })).json?.ok === true);
  const before19b = log.length;
  await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const after19b = log.slice(before19b);
  const dd19 = after19b.find((e) => /\/dd\/api\/v1\/menus/.test(e.path) && e.body?.store?.merchant_supplied_id === 'dd-popoulet-ndg')?.body;
  const ddItems19 = dd19?.menu?.categories?.flatMap((c) => c.items) || [];
  const plain19 = m19.items.find((i) => !(i.channelPrices?.doordash > 0) && i.price > 0);
  const ddPlain = ddItems19.find((i) => i.merchant_supplied_id === plain19?.ref);
  check('DoorDash item price = in-store price × 1.20', !!ddPlain && ddPlain.price === Math.round(plain19.price * 120 + 1e-6), `${plain19?.price} → ${ddPlain?.price}`);
  const ddMod19 = ddItems19.flatMap((i) => i.extras || []).flatMap((x) => x.options || []).find((o) => o.merchant_supplied_id === 'mod-1');
  check('DoorDash modifier price marked up too (1.00 $ → 1.20 $)', ddMod19?.price === 120, JSON.stringify(ddMod19));
  const uber19 = after19b.find((e) => e.method === 'PUT' && /uber-store-uuid-1\/menus$/.test(e.path))?.body;
  check('Uber keeps its own per-item price (no markup set for Uber)', uber19?.items?.find((i) => i.id === 'clv-item-1')?.price_info?.price === 1649 && uber19.items.find((i) => i.id === 'mod:mod-1')?.price_info?.price === 100);
  check('markup removed again', (await call('PUT', '/api/foodhub/menu', { body: { menu: { ...m19, channelMarkupPct: {} } } })).json?.ok === true);

  console.log('\n20. Scheduled publish');
  check('a time in the past is refused', (await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet', at: new Date(Date.now() - 60_000).toISOString() } })).status === 400);
  const at = new Date(Date.now() + 3 * 3600_000).toISOString();
  const sp = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet', at, storeIds: [ids.uber.id] } });
  check('publish scheduled for later (nothing sent now)', sp.json?.scheduled?.status === 'scheduled' && sp.json.scheduled.at === at);
  const listed = (await call('GET', '/api/foodhub/menu/publish?brand=Po%20Poulet')).json?.scheduled || [];
  check('scheduled publish listed', listed.some((x) => x.id === sp.json?.scheduled?.id));
  check('scheduled publish cancelled', (await call('DELETE', `/api/foodhub/menu/publish?id=${sp.json?.scheduled?.id}`)).json?.ok === true && (await call('GET', '/api/foodhub/menu/publish?brand=Po%20Poulet')).json.scheduled.find((x) => x.id === sp.json.scheduled.id)?.status === 'cancelled');

  console.log('\n21. 86 a modifier (sauce) everywhere');
  const av21 = await call('POST', '/api/foodhub/availability', { body: { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['mod-1'], available: false, minutes: 30 } });
  check('modifier 86 accepted by Uber, DoorDash, Skip', (av21.json?.results || []).filter((r) => r.channel !== 'tgtg').every((r) => r.result.ok), JSON.stringify(av21.json?.results?.map((r) => [r.channel, r.result.status])));
  check('DoorDash: PUT item_options/status', sent('PUT', /\/dd\/api\/v1\/stores\/dd-popoulet-ndg\/item_options\/status$/).pop()?.body?.[0]?.merchant_supplied_id === 'mod-1');
  check('Uber: modifier item suspended (mod:mod-1)', sent('POST', /\/menus\/items\/mod%3Amod-1$/).pop()?.body?.suspension_info?.suspension?.suspend_until > 0);
  check('Skip: item-availability by PLU', sent('POST', /^\/skip\/item-availability$/).pop()?.body?.itemReferences?.[0] === 'mod-1');
  const m21 = (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu;
  check('timed 86 stored with its end time', m21.unavailableByLocation?.NDG_MAIN?.includes('mod-1') && m21.unavailableUntil?.['NDG_MAIN|mod-1'] > Date.now());
  await call('POST', '/api/foodhub/availability', { body: { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['mod-1'], available: true } });
  check('modifier back on', !(await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu.unavailableByLocation?.NDG_MAIN?.includes('mod-1') && sent('PUT', /item_options\/status$/).pop()?.body?.[0]?.is_active === true);

  console.log('\n22. Kitchen: busy mode, prep time, courier pickup, cancel reasons, Clover printing');
  const busyOn = await call('POST', '/api/foodhub/prep', { body: { locationCode: 'NDG_MAIN', isBusy: true, busy: 30 } });
  check('busy mode on for NDG (30 min)', busyOn.json?.prep?.isBusy === true && busyOn.json.prep.busy === 30);
  check('Command Center kitchen strip shows 30 min at NDG', (await call('GET', '/api/foodhub/command')).json?.kitchen?.find((k) => k.locationCode === 'NDG_MAIN')?.minutes === 30);
  await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: { ...ddOrder, id: 'dd-order-2' } });
  const o8 = await waitFor(async () => { const o = await findOrder('dd-order-2'); return o?.status === 'accepted' ? o : null; });
  const conf8 = sent('PATCH', /^\/dd\/api\/v1\/orders\/dd-order-2$/)[0]?.body;
  const prepMin = conf8?.prep_time ? (Date.parse(conf8.prep_time) - Date.now()) / 60000 : null;
  check('DoorDash confirmation carries prep_time ≈ now + 30 min (busy)', prepMin !== null && prepMin > 28 && prepMin <= 30.5, JSON.stringify(conf8));
  check('timeline: auto-accepted with a ready-by target', o8?.timeline?.acceptedBy === 'auto' && !!o8.timeline.readyTarget && !!o8.timeline.acceptedAt);
  const prints = () => sent('POST', /\/v3\/merchants\/MAINMERCHANT\/print_event$/);
  check('kitchen ticket printed on Clover automatically', prints().some((e) => e.body?.orderRef?.id === o8?.posOrderId) && !!(await waitFor(async () => (await findOrder('dd-order-2'))?.timeline?.printedAt)));
  const det8 = (await call('GET', `/api/foodhub/orders/${o8?.id}`)).json;
  check('DoorDash order: no API cancel offered (portal only), Ready + Reprint offered', JSON.stringify(det8?.actions) === JSON.stringify(['ready', 'print']), JSON.stringify(det8?.actions));
  const pr8 = await call('POST', `/api/foodhub/orders/${o8?.id}`, { body: { action: 'print' } });
  check('Reprint → another Clover print_event', pr8.json?.result?.ok === true && prints().filter((e) => e.body?.orderRef?.id === o8?.posOrderId).length === 2);
  await call('POST', `/api/foodhub/orders/${o8?.id}`, { body: { action: 'ready' } });
  const dp8 = await call('POST', `/api/foodhub/orders/${o8?.id}`, { body: { action: 'dispatch' } });
  check('courier pickup → "Picked up" with timestamps', dp8.json?.order?.status === 'dispatched' && !!dp8.json.order.timeline.readyAt && !!dp8.json.order.timeline.dispatchedAt && JSON.stringify(dp8.json.actions) === JSON.stringify(['complete', 'print']));
  const cp8 = await call('POST', `/api/foodhub/orders/${o8?.id}`, { body: { action: 'complete' } });
  check('completed with timestamp', cp8.json?.order?.status === 'completed' && !!cp8.json.order.timeline.completedAt);
  check('a completed order cannot go back to ready', (await call('POST', `/api/foodhub/orders/${o8?.id}`, { body: { action: 'ready' } })).json?.result?.ok === false);
  await uberWebhook('uber-order-2');
  const o9 = await waitFor(async () => { const o = await findOrder('uber-order-2'); return o?.status === 'accepted' ? o : null; });
  const det9 = (await call('GET', `/api/foodhub/orders/${o9?.id}`)).json;
  check('Uber accepted order offers Cancel with the standard reasons', det9?.actions?.includes('cancel') && det9.reasons?.out_of_stock === 'Item out of stock');
  const cn9 = await call('POST', `/api/foodhub/orders/${o9?.id}`, { body: { action: 'cancel', reasonCode: 'out_of_stock', reason: 'Plus de poulet' } });
  const ucan = sent('POST', /^\/uber\/v1\/eats\/orders\/uber-order-2\/cancel$/)[0]?.body;
  check('Cancel → Uber /cancel with OUT_OF_ITEMS + details', ucan?.reason === 'OUT_OF_ITEMS' && ucan.details === 'Plus de poulet', JSON.stringify(ucan));
  const t9 = cn9.json?.order?.timeline || {};
  check('timeline: cancelled by the store after accepting, reason kept', cn9.json?.order?.status === 'cancelled' && t9.cancelledBy === 'store' && t9.cancelStage === 'after_accept' && t9.cancelReason === 'Item out of stock — Plus de poulet', JSON.stringify(t9));
  await call('POST', '/api/foodhub/prep', { body: { locationCode: 'NDG_MAIN', isBusy: false } });
  check('busy mode off → back to normal prep time', (await call('GET', '/api/foodhub/prep')).json?.prep?.NDG_MAIN?.isBusy === false);

  console.log('\n23. Reports: CSV, Excel, email, schedules');
  const rl = (await call('GET', '/api/foodhub/reports')).json;
  check('7 standard reports, email configured', rl?.reports?.length === 7 && rl.emailConfigured === true);
  const todays = (await call('GET', `/api/foodhub/orders?limit=5000&from=${today}&to=${today}`)).json?.orders || [];
  const csv = await call('GET', `/api/foodhub/reports/order_transactions?format=csv&from=${today}&to=${today}`);
  const csvLines = csv.text.replace(/^﻿/, '').trim().split(/\r?\n/);
  check('Order Transactions CSV: Excel-ready (BOM), one row per order', csv.contentType.includes('text/csv') && csv.text.charCodeAt(0) === 0xfeff && csvLines[0].startsWith('Order id,Platform order id') && csvLines.length - 1 === todays.length, `${csvLines.length - 1} vs ${todays.length}`);
  const xlsx = await call('GET', `/api/foodhub/reports/order_status_transitions?format=xlsx&from=${today}&to=${today}`);
  check('Status Transitions as a real Excel file', xlsx.contentType.includes('spreadsheetml') && xlsx.buf.subarray(0, 2).toString() === 'PK' && xlsx.buf.length > 500);
  const pv = (await call('GET', `/api/foodhub/reports/item_wise?format=json&limit=3&from=${today}&to=${today}`)).json;
  check('preview: first rows + total count', pv?.rows?.length === 3 && pv.total >= 3);
  const actCsv = await call('GET', `/api/foodhub/reports/store_actions?format=csv&from=${today}&to=${today}`);
  check('Store Action Report has the 86 and the pause with who did it', actCsv.text.includes("86'd: Frites") && /Owner,dashboard,store_status,pause/.test(actCsv.text));
  const em = await call('POST', '/api/foodhub/reports/email', { body: { report: 'order_transactions', emails: 'owner@takatak.example', format: 'xlsx', query: { from: today, to: today } } });
  const mail = sent('POST', /^\/resend\/emails$/).pop();
  check('"Email now" → Resend with the Excel attached', em.json?.ok === true && mail?.body?.to?.[0] === 'owner@takatak.example' && mail.body.attachments?.[0]?.filename?.endsWith('.xlsx') && Buffer.from(mail.body.attachments[0].content, 'base64').subarray(0, 2).toString() === 'PK', JSON.stringify(em.json));
  const sc = await call('POST', '/api/foodhub/reports/schedules', { body: { report: 'items_summary', frequency: 'daily', emails: 'owner@takatak.example', format: 'csv' } });
  check('daily report schedule saved', !!sc.json?.schedule?.id);
  const mailsBefore = sent('POST', /^\/resend\/emails$/).length;
  const cr1 = await call('GET', '/api/foodhub/cron/reports', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  const due = localHour() >= 8 ? 1 : 0;
  check(`report cron sends due schedules (${due ? 'after 8:00 → sent' : 'before 8:00 → waits'})`, cr1.json?.ok === true && cr1.json.reportsSent === due && sent('POST', /^\/resend\/emails$/).length === mailsBefore + due, JSON.stringify(cr1.json));
  const cr2 = await call('GET', '/api/foodhub/cron/reports', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  check('report cron never sends the same period twice', cr2.json?.reportsSent === 0);
  check('report cron rejects a missing CRON_SECRET', (await call('GET', '/api/foodhub/cron/reports', { auth: false })).status === 401);
  check('schedule removed', (await call('DELETE', `/api/foodhub/reports/schedules?id=${sc.json?.schedule?.id}`)).json?.ok === true && (await call('GET', '/api/foodhub/reports/schedules')).json?.schedules?.length === 0);

  console.log('\n24. Analytics');
  const an = (await call('GET', `/api/foodhub/analytics?from=${today}&to=${today}`)).json;
  const counted24 = todays.filter((o) => o.status !== 'cancelled');
  const sales24 = Math.round(counted24.reduce((s, o) => s + o.total, 0) * 100) / 100;
  check('orders + sales match the order list', an?.kpis?.orders?.value === counted24.length && Math.abs(an.kpis.sales.value - sales24) < 0.01, `${an?.kpis?.orders?.value}/${counted24.length} ${an?.kpis?.sales?.value}/${sales24}`);
  check('platform, brand and location breakdowns add up', [an.byChannel, an.byBrand, an.byLocation].every((g) => Math.abs(g.reduce((s, x) => s + x.sales, 0) - sales24) < 0.02));
  check('heatmap counts every order once', an.heatmap.flat().reduce((a, b) => a + b, 0) === counted24.length);
  check('cancellations split by who / stage / reason', an.cancellations.total === todays.length - counted24.length && an.cancellations.byWho.store >= 1 && an.cancellations.byStage.after_accept >= 1 && an.cancellations.reasons.some((r) => /out of stock/i.test(r.reason)), JSON.stringify(an.cancellations));
  check('time to accept, prep time, Clover rate measured', typeof an.kpis.avgAcceptMin.value === 'number' && typeof an.kpis.avgPrepMin.value === 'number' && an.kpis.cloverRate.value > 0);
  check('store uptime computed against opening hours', an.uptime.stores.length >= 5 && an.uptime.hoursSetFor >= 5 && an.uptime.overallPct <= 100);
  check('compared with the previous period', an.range.previousTo === an.range.from && an.daily.length === 1 && 'change' in an.kpis.sales);
  check('analytics range is validated', (await call('GET', '/api/foodhub/analytics?from=2026-01-10&to=2026-01-01')).status >= 400);

  console.log('\n25. Activity log (Store Action Report)');
  const acts = (await call('GET', '/api/foodhub/activity?limit=2000')).json?.entries || [];
  const kinds = new Set(acts.map((e) => e.kind));
  check('records orders, pauses, 86, menus, hours, users and sign-ins', ['order', 'store_status', 'item_availability', 'menu_publish', 'hours', 'users', 'login'].every((k) => kinds.has(k)), [...kinds].join(','));
  check('platform-side changes are logged too (store went offline on DoorDash)', acts.some((e) => e.kind === 'store_status' && e.source === 'platform'));
  const bogusPage = await call('GET', '/orders', { auth: false, redirect: 'manual', headers: { authorization: 'Basic eDp4' } });
  check('a page with a bogus Basic header is sent to sign-in (never passes the gate unverified)', bogusPage.status >= 300 && bogusPage.status < 400 && String(bogusPage.location).includes('/login'), `${bogusPage.status} ${bogusPage.location}`);
  check('/api/foodhub/* with a bogus Basic header → 401', (await call('GET', '/api/foodhub/activity?limit=1', { auth: false, headers: { authorization: 'Basic eDp4' } })).status === 401);
  check('failed sign-in is logged', acts.some((e) => e.kind === 'login' && e.status === 'failed'));
  check('activity filter by type', ((await call('GET', '/api/foodhub/activity?kinds=hours')).json?.entries || []).every((e) => e.kind === 'hours'));

  console.log('\n26. Brands & locations');
  const loc26 = await call('POST', '/api/foodhub/catalog', { body: { location: { code: 'VERDUN', name: 'VERDUN — 4000 Wellington', address: '4000 Rue Wellington', city: 'Montréal' } } });
  check('new location added', loc26.json?.locations?.some((l) => l.code === 'VERDUN'));
  check('bad location code refused', (await call('POST', '/api/foodhub/catalog', { body: { location: { code: 'v', name: 'x' } } })).status === 400);
  check('Too Good To Go cannot be added as a brand', (await call('POST', '/api/foodhub/catalog', { body: { brand: { name: 'Too Good To Go' } } })).status === 400);
  check('new location appears on the Command Center', (await call('GET', '/api/foodhub/command')).json?.byLocation?.some((l) => l.locationCode === 'VERDUN'));
  check('deactivated user is signed out immediately', (await call('POST', '/api/foodhub/users', { body: { username: 'sara.hoch', role: 'operator', locations: ['HOCHELAGA'], active: false } })).json?.ok === true && (await call('GET', '/api/foodhub/auth/me', { cookie })).status === 401);

  console.log('\n27. Clover bookkeeping: order types, paid when the order leaves the kitchen, cancelled orders removed');
  const otLabels = sent('POST', /\/v3\/merchants\/MAINMERCHANT\/order_types$/).map((e) => e.body?.label);
  check('one Clover order type per platform, created once', ['Uber Eats', 'DoorDash', 'SkipTheDishes', 'Too Good To Go'].every((l) => otLabels.filter((x) => x === l).length === 1), JSON.stringify(otLabels));
  const otIds = new Set(cloverOrderTypes.filter((t) => t.id !== 'OT-DINE').map((t) => t.id));
  const atomics27 = sent('POST', /\/v3\/merchants\/MAINMERCHANT\/atomic_order\/orders$/);
  check('every delivery order in Clover carries its platform order type', atomics27.length >= 6 && atomics27.every((e) => otIds.has(e.body?.orderCart?.orderType?.id)));
  const payPosts = () => sent('POST', /\/v3\/merchants\/MAINMERCHANT\/orders\/[^/]+\/payments$/);
  const tenderId = (l) => cloverTenders.find((t) => t.label === l)?.id;
  const o8pay = payPosts().find((e) => e.path.endsWith(`/orders/${o8?.posOrderId}/payments`))?.body;
  // The payment carries what the customer really paid for the food (subtotal − discount + tax, in cents), not Clover's own total.
  const o8expected = Math.round(((o8?.subtotal ?? 0) - (o8?.discount ?? 0) + (o8?.tax ?? 0)) * 100);
  check('picked-up DoorDash order recorded as paid in Clover with the "DoorDash" tender', o8pay?.tender?.id === tenderId('DoorDash') && o8pay.result === 'SUCCESS' && o8pay.amount === o8expected && o8pay.taxAmount === Math.round((o8?.tax ?? 0) * 100) && /^dd:/.test(o8pay.externalPaymentId) && o8pay.externalPaymentId.length <= 32, JSON.stringify(o8pay));
  check('Food Hub keeps the Clover payment id on the order', !!(await findOrder('dd-order-2'))?.timeline?.posPaymentId);
  check('orders still in the kitchen are not paid yet (they can still be cancelled)', !payPosts().some((e) => e.path.includes(`/orders/${o2?.posOrderId}/`) || e.path.includes(`/orders/${o1?.posOrderId}/`)));
  check('Uber order cancelled after accepting → removed from the Clover register', sent('DELETE', new RegExp(`/orders/${o9?.posOrderId}$`)).length === 1 && !!(await findOrder('uber-order-2'))?.timeline?.posClosedAt && !payPosts().some((e) => e.path.includes(`/orders/${o9?.posOrderId}/`)));
  check('Skip order cancelled by Skip → removed from Clover too', sent('DELETE', new RegExp(`/orders/${o4?.posOrderId}$`)).length === 1);
  await call('POST', `/api/foodhub/orders/${o1?.id}`, { body: { action: 'ready' } });
  const done1 = await call('POST', `/api/foodhub/orders/${o1?.id}`, { body: { action: 'complete' } });
  const o1pay = payPosts().find((e) => e.path.endsWith(`/orders/${o1?.posOrderId}/payments`))?.body;
  check('Uber order completed → paid in Clover with the "Uber Eats" tender', done1.json?.order?.status === 'completed' && o1pay?.tender?.id === tenderId('Uber Eats') && /^ue:/.test(o1pay.externalPaymentId), JSON.stringify(o1pay));
  check('each tender created once and reused', ['DoorDash', 'Uber Eats'].every((l) => sent('POST', /\/v3\/merchants\/MAINMERCHANT\/tenders$/).filter((e) => e.body?.label === l).length === 1));
  const sy27 = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  check('Clover in-store sales still exclude delivery orders paid with platform tenders ($35.00)', sy27.json?.report?.clover?.find((c) => c.merchantId === 'MAINMERCHANT')?.net === 35, JSON.stringify(sy27.json?.report?.clover));

  console.log('\n28. Clover → every platform: out of stock, back in stock, price change');
  check('Clover webhook verification handshake accepted', (await call('POST', '/api/foodhub/webhooks/clover', { auth: false, body: { verificationCode: 'VC-e2e-123' } })).status === 200);
  check('verification code shown to the owner on Channels', (await call('GET', '/api/foodhub/channels')).json?.clover?.verification?.code === 'VC-e2e-123');
  const cloverEvt = (...itemIds) => ({ appId: 'APP', merchants: { MAINMERCHANT: itemIds.map((id) => ({ objectId: `I:${id}`, type: 'UPDATE', ts: Date.now() })) } });
  const cloverHook = (body, auth = 'clover-auth-e2e') => call('POST', '/api/foodhub/webhooks/clover', { auth: false, headers: auth ? { 'x-clover-auth': auth } : {}, body });
  check('Clover event with a wrong X-Clover-Auth refused', (await cloverHook(cloverEvt('clv-item-1'), 'wrong')).status === 401);
  const menuNow = async () => (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json.menu;
  cloverItems[0].available = false;
  const b28 = log.length;
  check('Clover inventory event accepted', (await cloverHook(cloverEvt('clv-item-1'))).status === 200);
  const off28 = await waitFor(async () => (await menuNow()).unavailableByLocation?.NDG_MAIN?.includes('clv-item-1'));
  const a28 = log.slice(b28);
  check('unavailable in Clover → 86 on Uber, DoorDash and Skip', !!off28 && a28.some((e) => e.method === 'POST' && /\/menus\/items\/clv-item-1$/.test(e.path)) && a28.some((e) => /dd-popoulet-ndg\/items\/status$/.test(e.path) && e.body?.[0]?.is_active === false) && a28.some((e) => e.path === '/skip/item-availability' && e.body?.itemReferences?.includes('clv-item-1') && e.body.event === 'UNAVAILABLE'));
  cloverItems[0].available = true; cloverItems[0].price = 1599;
  await cloverHook(cloverEvt('clv-item-1', 'clv-item-2'));
  const on28 = await waitFor(async () => !(await menuNow()).unavailableByLocation?.NDG_MAIN?.includes('clv-item-1'));
  check('back in stock in Clover → back on everywhere', !!on28);
  check('an 86 made by staff in Food Hub is never undone by Clover', (await menuNow()).unavailableByLocation?.NDG_MAIN?.includes('clv-item-2'));
  const pc = await waitFor(async () => (await call('GET', '/api/foodhub/menu/clover-prices?brand=Po%20Poulet')).json?.changes?.find((c) => c.ref === 'clv-item-1'));
  check('price changed in Clover → flagged with both prices', pc?.cloverPrice === 15.99 && pc.foodhubPrice === 14.99, JSON.stringify(pc));
  check('Command Center shows the Clover price change', ((await call('GET', '/api/foodhub/command')).json?.alerts || []).some((a) => a.id === 'clover-prices'));
  const usePrice = await call('POST', '/api/foodhub/menu/clover-prices', { body: { brand: 'Po Poulet', ref: 'clv-item-1', accept: true } });
  check('"Use Clover price" updates the master menu', usePrice.json?.ok === true && (await menuNow()).items.find((i) => i.ref === 'clv-item-1')?.price === 15.99);

  console.log('\n29. Couriers, Skip missing items, Skip backup flow');
  const o3now = await findOrder('skip-order-0001');
  check('accepted Skip order offers "Report missing item"', ((await call('GET', `/api/foodhub/orders/${o3now?.id}`)).json?.actions || []).includes('report_missing'));
  const miss = await call('POST', `/api/foodhub/orders/${o3now?.id}`, { body: { action: 'report_missing', missing: [{ line: 1, quantity: 1 }] } });
  const mod = sent('POST', /^\/skip\/orders\/skip-order-0001\/modification$/).pop()?.body;
  check('missing Frites reported to Skip (JET modification: PLU + quantity)', miss.json?.result?.ok === true && mod?.modifications?.[0]?.removedItems?.[0]?.plu === 'clv-item-2' && mod.modifications[0].removedItems[0].missingQuantity === 1 && miss.json.order?.timeline?.missingItems?.length === 1, JSON.stringify(miss.json?.result));
  const drv = await skipWebhook('driver', { orderID: 'skip-order-0001', driverStatus: { code: 'driverAtRestaurant' }, happenedAt: new Date().toISOString() }, { hmac: false });
  check('Skip driver status answered 200 with the same payload (JET rule)', drv.status === 200 && drv.json?.orderID === 'skip-order-0001');
  check('courier "at the store" shown on the order', !!(await waitFor(async () => (await findOrder('skip-order-0001'))?.timeline?.courier?.status === 'at_store')));
  await skipWebhook('driver', { orderID: 'skip-order-0001', driverStatus: { code: 'onItsWay' }, happenedAt: new Date().toISOString() }, { hmac: false });
  const o3p = await waitFor(async () => { const o = await findOrder('skip-order-0001'); return o?.status === 'dispatched' && o.timeline?.posPaymentId ? o : null; });
  check('driver on its way → "Picked up" and paid in Clover with the "SkipTheDishes" tender', !!o3p && payPosts().some((e) => e.path.endsWith(`/orders/${o3p.posOrderId}/payments`) && e.body?.tender?.id === tenderId('SkipTheDishes')));
  const ddHook = (body) => call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body });
  await ddHook({ event: { type: 'dasher_status_update' }, dasher_status: 'dasher_confirmed', external_order_id: 'dd-order-1', dasher: { first_name: 'Ana', last_name: 'Bell', phone_number: '+15145550101', vehicle: { make: 'Toyota', model: 'Corolla', color: 'Blue' } } });
  const c29 = await waitFor(async () => (await findOrder('dd-order-1'))?.timeline?.courier);
  check('DoorDash dasher assigned: name, phone and car on the order', c29?.status === 'assigned' && c29.name === 'Ana B.' && c29.phone === '+15145550101' && c29.vehicle === 'Blue Toyota Corolla', JSON.stringify(c29));
  await ddHook({ event: { type: 'dasher_status_update' }, dasher_status: 'arriving_at_store', external_order_id: 'dd-order-1' });
  const q29 = await waitFor(async () => ((await call('GET', '/api/foodhub/command')).json?.queue || []).find((q) => q.id === o2?.id && q.courier?.status === 'arriving'));
  check('Command Center shows "courier arriving" on the order card', !!q29 && q29.courier.name === 'Ana B.');
  // DoorDash's documented payloads: dasher_status + external_order_id, cancellation with client_order_id only.
  // dd-order-3 carries a merchant-funded promotion ($3.50; DoorDash sends cents). It is cancelled below, so no payment,
  // payout or sales check ever sees it — only the Clover discount check that follows.
  const b29 = log.length;
  await ddHook({ ...ddOrder, id: 'dd-order-3', merchant_funded_discount: 350 });
  const o29d = await waitFor(async () => { const o = await findOrder('dd-order-3'); return o?.status === 'accepted' && o.posOrderId ? o : null; });
  const isAtomic = (e) => e.method === 'POST' && /\/atomic_order\/orders$/.test(e.path);
  const disc29 = log.slice(b29).filter(isAtomic).map((e) => e.body?.orderCart?.discounts).find(Boolean);
  check('DoorDash promotion sent to Clover as an order discount (−350 cents, Clover total = lines − promotion); orders without one carry none', o29d?.discount === 3.5 && disc29?.length === 1 && disc29[0].name === 'DoorDash promotion' && disc29[0].amount === -350 && cloverOrderTotals.get(o29d.posOrderId) === 1499 - 350 && !log.slice(0, b29).some((e) => isAtomic(e) && e.body?.orderCart && 'discounts' in e.body.orderCart), JSON.stringify({ d: o29d?.discount, disc29 }));
  await ddHook({ dasher_status: 'arrived_at_store', external_order_id: 'dd-order-3', client_order_id: o29d?.posOrderId, Phone_number: '+15145550199' });
  check('DoorDash Dasher Status (documented shape: dasher_status arrived_at_store) → courier at the store', !!(await waitFor(async () => (await findOrder('dd-order-3'))?.timeline?.courier?.status === 'at_store')));
  await ddHook({ client_order_id: o29d?.posOrderId, cancel_reason: 'CUSTOMER_REQUEST' });
  check('DoorDash cancellation found by client_order_id (our merchant_supplied_id) → cancelled and removed from Clover', !!(await waitFor(async () => (await findOrder('dd-order-3'))?.status === 'cancelled')) && !!(await waitFor(async () => sent('DELETE', new RegExp(`/orders/${o29d?.posOrderId}$`)).length === 1)));
  const fo = await skipWebhook('failed', { validationError: 'unknownReference', unknownReference: 'zzz-99', menuId: 'm1', order: { orderId: 'skip-failed-1', friendlyOrderReference: '7788', totalPrice: 1299, restaurant: { id: 'NDG-POPOULET' }, fulfilment: { type: 'delivery' }, items: [{ name: 'Mystery Bowl', plu: 'zzz-99', price: 1299, quantity: 1 }] } }, { hmac: false });
  const of29 = await waitFor(async () => { const o = await findOrder('skip-failed-1'); return o?.status === 'failed' ? o : null; });
  check('Skip "failed order for backup flow" recorded: on the Skip tablet, NDG, $12.99', fo.status === 200 && of29?.locationCode === 'NDG_MAIN' && of29.total === 12.99 && /tablet/i.test(of29.channelError || ''), JSON.stringify(of29 && { t: of29.total, e: of29.channelError }));

  console.log('\n30. Scheduled orders: accepted now, cooked at the right time');
  await call('POST', '/api/foodhub/prep', { body: { locationCode: 'NDG_MAIN', normal: 60 } });
  await uberWebhook('uber-sched-1');
  const os30 = await waitFor(async () => { const o = await findOrder('uber-sched-1'); return o?.status === 'accepted' && o.posOrderId ? o : null; });
  check('scheduled order accepted on Uber right away and sent to Clover', !!os30 && sent('POST', /uber-sched-1\/accept_pos_order$/).length === 1);
  check('due time and kitchen fire time (due − prep) kept on the order', !!os30?.timeline?.scheduledFor && !!os30.timeline.fireAt && Date.parse(os30.timeline.scheduledFor) - Date.parse(os30.timeline.fireAt) === 60 * 60_000);
  const sAtomic = sent('POST', /\/atomic_order\/orders$/).find((e) => /SCHEDULED/.test(e.body?.orderCart?.note || ''));
  check('Clover order marked ⏰ SCHEDULED', !!sAtomic && sAtomic.body.orderCart.title.startsWith('⏰'));
  check('kitchen ticket not printed yet', !prints().some((e) => e.body?.orderRef?.id === os30?.posOrderId));
  const q30 = ((await call('GET', '/api/foodhub/command')).json?.queue || []).find((q) => q.id === os30?.id);
  check('Command Center: waiting in the Scheduled lane', q30?.waitingScheduled === true && q30.fireAt === os30?.timeline?.fireAt);
  const wait30 = Date.parse(os30?.timeline?.fireAt || '') - Date.now() + 1500;
  if (wait30 > 0) await sleep(Math.min(wait30, 60_000));
  const fire30 = await call('GET', '/api/foodhub/cron/sync', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  check('at fire time the sync prints the kitchen ticket', fire30.json?.scheduledFired === 1 && prints().some((e) => e.body?.orderRef?.id === os30?.posOrderId) && !!(await findOrder('uber-sched-1'))?.timeline?.firedAt, JSON.stringify(fire30.json));
  await call('POST', '/api/foodhub/prep', { body: { locationCode: 'NDG_MAIN', normal: 15 } });

  console.log('\n31. Payouts & reconciliation — where is my money');
  const f2 = (n) => n.toFixed(2);
  const b64 = (t) => Buffer.from(t).toString('base64');
  const rc0 = (await call('GET', `/api/foodhub/recon?from=${today}&to=${today}`)).json;
  const exp = (ref) => rc0?.orders?.find((o) => o.ref === ref)?.expected;
  const e1 = exp('uber-order-1'); const eD1 = exp('dd-order-1'); const eD2 = exp('dd-order-2'); const eS1 = exp('skip-order-0001');
  check('every accepted order has an expected payout (25% Uber Plus + 14.975% tax on the commission)', !!(e1 && eD1 && eD2 && eS1) && e1.ratePct === 25 && Math.abs(e1.commissionTax - e1.commission * 0.14975) < 0.01, JSON.stringify(e1));
  check('before any statement nothing is called missing', rc0?.imports === 0 && rc0.orders.every((o) => ['pending', 'cancelled'].includes(o.status)));
  uberReportCsv = [
    'Store Name,Store ID,Order ID,Workflow ID,Order Status,Order Date,Payout Date,Sales (excluding tax),Tax on Sales,Marketplace fee,Tax on Marketplace fee,Other payments,Other payments description,Total payout,Payout reference ID',
    `Po Poulet,uber-store-uuid-1,${o1?.displayId},uber-order-1,Completed,${today},${today},${f2(e1.sales)},${f2(e1.tax)},-${f2(e1.commission)},-${f2(e1.commissionTax)},0,,${f2(e1.net)},UBER-PAY-1`,
    `Po Poulet,uber-store-uuid-1,,,,,${today},0,0,0,0,-25.00,Ads campaign,-25.00,UBER-PAY-1`,
  ].join('\n');
  const ureq = await call('POST', '/api/foodhub/recon/uber-report', { body: { from: today, to: today } });
  const ureqSent = sent('POST', /^\/uber\/v1\/eats\/report$/).pop()?.body;
  check('Uber payment report requested from the Reporting API for the mapped Uber stores', ureq.json?.request?.status === 'requested' && ureqSent?.report_type === 'PAYMENT_DETAILS_REPORT' && ureqSent.store_uuids.includes('uber-store-uuid-1'), JSON.stringify(ureq.json));
  const rw = await uberSigned(JSON.stringify({ event_type: 'eats.report.success', event_id: 'evt-report-1', workflow_id: 'wf-report-1', report_type: 'PAYMENT_DETAILS_REPORT', report_metadata: { sections: [{ download_url: `${MOCK}/reports/uber-payment.csv` }] } }));
  const uImp = await waitFor(async () => (await call('GET', '/api/foodhub/recon/imports')).json?.imports?.find((i) => i.source === 'uber_reporting_api'));
  check('Uber sends the report → downloaded and imported by itself', rw.status === 200 && uImp?.channel === 'uber_eats' && uImp.lines === 2 && uImp.format === 'uber_payment_details', JSON.stringify(uImp));
  check('report request marked imported', ((await call('GET', '/api/foodhub/recon/uber-report')).json?.requests || []).find((r) => r.id === 'wf-report-1')?.status === 'imported');
  const ddCsv = [
    'Timestamp local date,Transaction type,DoorDash order ID,Merchant Store ID,Subtotal,Subtotal tax passed to merchant,Commission,Error charges,Net total,Payout date,Payout ID',
    `${today},DELIVERY,dd-order-1,dd-popoulet-ndg,${f2(eD1.sales)},${f2(eD1.tax)},-${f2(eD1.commission + eD1.commissionTax)},0,${f2(eD1.net - 4)},${today},DD-PAY-9`,
    `${today},DELIVERY,dd-order-2,dd-popoulet-ndg,${f2(eD2.sales)},${f2(eD2.tax)},-${f2(eD2.commission + eD2.commissionTax)},0,${f2(eD2.net)},${today},DD-PAY-9`,
    `${today},DELIVERY,dd-ghost-77,dd-popoulet-ndg,10.00,1.50,-2.87,0,8.63,${today},DD-PAY-9`,
    `${today},Tablet fee,,dd-popoulet-ndg,0,0,0,0,-5.00,${today},DD-PAY-9`,
  ].join('\n');
  const ddImp = await call('POST', '/api/foodhub/recon/imports', { body: { fileName: 'doordash-transactions.csv', contentBase64: b64(ddCsv) } });
  check('DoorDash transactions CSV recognised and imported', ddImp.json?.imported === true && ddImp.json.import.channel === 'doordash' && ddImp.json.import.lines === 4, JSON.stringify(ddImp.json));
  const skCsv = ['Order Number,Order Date,Type,Net Payout,Description', `SK0001,${today},Order,${f2(eS1.net)},`, `SK0001,${today},Error charge,-6.00,Missing item refunded to customer`].join('\n');
  const sk1 = await call('POST', '/api/foodhub/recon/imports', { body: { fileName: 'skip-statement.csv', contentBase64: b64(skCsv) } });
  check('unknown statement layout → asks which column is which, with a good guess', sk1.json?.imported === false && sk1.json.needsMapping === true && sk1.json.mapping?.orderRef === 0 && sk1.json.mapping?.net === 3 && sk1.json.headers?.length === 5 && sk1.json.sample?.length === 2, JSON.stringify(sk1.json));
  const sk2 = await call('POST', '/api/foodhub/recon/imports', { body: { fileName: 'skip-statement.csv', contentBase64: b64(skCsv), channel: 'skip', mapping: sk1.json?.mapping } });
  check('columns confirmed → Skip statement imported', sk2.json?.imported === true && sk2.json.import.channel === 'skip' && sk2.json.import.lines === 2, JSON.stringify(sk2.json));
  const sk3 = await call('POST', '/api/foodhub/recon/imports', { body: { fileName: 'skip-statement-copy.csv', contentBase64: b64(skCsv) } });
  check('same layout next time → columns remembered; the same lines are never counted twice', sk3.json?.imported === true && sk3.json.import.newLines === 0, JSON.stringify(sk3.json));
  const rc1 = (await call('GET', `/api/foodhub/recon?from=${today}&to=${today}`)).json;
  const st31 = Object.fromEntries((rc1?.orders || []).map((o) => [o.ref, o]));
  check('Uber order paid as expected → matched', st31['uber-order-1']?.status === 'matched', JSON.stringify(st31['uber-order-1']));
  check('DoorDash paid $4.00 less → short-paid −$4.00', st31['dd-order-1']?.status === 'short_paid' && st31['dd-order-1'].diff === -4);
  check('DoorDash order paid in full → matched', st31['dd-order-2']?.status === 'matched');
  check('Skip error charge (matched by the short order number) → flagged −$6.00', st31['skip-order-0001']?.status === 'error_charge' && st31['skip-order-0001'].diff === -6, JSON.stringify(st31['skip-order-0001']));
  check('paid order Food Hub never received → flagged (missed webhook / unmapped store)', rc1.unmatched.some((l) => l.ref === 'dd-ghost-77'));
  check('ads and tablet fees kept apart as other charges', rc1.other.some((l) => l.kind === 'ads' && l.net === -25) && rc1.other.some((l) => l.kind === 'fee' && l.net === -5));
  check('orders not on a statement yet stay "not due yet"', st31['tgtg-1']?.status === 'pending');
  check('money to recover = $4.00 + $6.00', rc1.totals.missingMoney === 10, JSON.stringify(rc1.totals));
  const open31 = (await call('GET', '/api/foodhub/recon/cases?status=open')).json?.cases || [];
  check('dispute cases opened by themselves: short-paid, error charge, unknown order', open31.length === 3 && ['short_paid', 'error_charge', 'unknown_order'].every((t) => open31.some((c) => c.type === t)), JSON.stringify(open31.map((c) => [c.type, c.amount])));
  const sc31 = open31.find((c) => c.type === 'short_paid');
  const up1 = await call('POST', '/api/foodhub/recon/cases', { body: { id: sc31?.id, status: 'disputed', platformCaseId: 'DD-55501', note: 'Photo of the receipt sent' } });
  check('case disputed, with the platform case number and a note', up1.json?.case?.status === 'disputed' && up1.json.case.platformCaseId === 'DD-55501' && up1.json.case.notes.length === 2);
  const up2 = await call('POST', '/api/foodhub/recon/cases', { body: { id: sc31?.id, status: 'recovered', recoveredAmount: 4 } });
  const rerun = await call('POST', '/api/foodhub/recon/run');
  check('case recovered — a re-check never overwrites the owner’s decision', up2.json?.case?.status === 'recovered' && rerun.json?.opened === 0 && (await call('GET', '/api/foodhub/recon/cases')).json.cases.find((c) => c.id === sc31?.id)?.status === 'recovered');
  check('recovered money is no longer counted as "to recover" ($6.00 left)', (await call('GET', `/api/foodhub/recon?from=${today}&to=${today}`)).json?.totals?.missingMoney === 6);
  const recAlert = ((await call('GET', '/api/foodhub/command')).json?.alerts || []).find((a) => a.id === 'recon-cases');
  check('Command Center: $6.00 to recover, unknown paid orders mentioned separately (not counted as money lost)', /^6\.00 \$ to recover/.test(recAlert?.title || '') && /never received/.test(recAlert?.detail || ''), JSON.stringify(recAlert));
  const pays = (await call('GET', `/api/foodhub/recon/payouts?from=${today}&to=${today}`)).json?.payouts || [];
  const ddPay = pays.find((p) => p.channel === 'doordash');
  check('payouts grouped per platform payout', pays.length === 3 && ddPay?.payoutRef === 'DD-PAY-9' && ddPay.orders === 3, JSON.stringify(pays.map((p) => [p.key, p.net, p.orders])));
  const dep = await call('POST', '/api/foodhub/recon/payouts', { body: { key: ddPay?.key, amount: Math.round(((ddPay?.net ?? 0) - 1) * 100) / 100, date: today } });
  const led = (await call('GET', `/api/foodhub/recon/ledger?from=${today}&to=${today}`)).json?.entries || [];
  check('bank deposit entered; the $1.00 gap is flagged on the ledger entry', dep.json?.ok === true && led.find((e) => e.key === ddPay?.key)?.warnings?.some((w) => /deposit differs/i.test(w)));
  check('every ledger entry balances (debit = credit)', led.length === 3 && led.every((e) => e.balanced), JSON.stringify(led.map((e) => [e.key, e.debit, e.credit])));
  const ue = led.find((e) => e.channel === 'uber_eats');
  check('Uber entry: bank, sales, GST + QST payable, commission, ITC + ITR, ads', ['1010', '4100', '2310', '2320', '5300', '1310', '1320', '5390'].every((a) => ue?.lines?.some((l) => l.account.startsWith(a))), JSON.stringify(ue?.lines?.map((l) => l.account)));
  check('owner approves the Uber entry (nothing is posted anywhere)', (await call('POST', '/api/foodhub/recon/ledger', { body: { key: ue?.key } })).json?.ok === true && (await call('GET', `/api/foodhub/recon/ledger?from=${today}&to=${today}`)).json.entries.find((e) => e.key === ue?.key)?.status === 'approved');
  const lcsv = await call('GET', `/api/foodhub/recon/ledger?format=csv&from=${today}&to=${today}`);
  check('ledger CSV for the accountant', lcsv.contentType.includes('text/csv') && lcsv.text.includes('4100 Delivery sales — Uber Eats') && lcsv.text.includes('approved'));
  const fees0 = (await call('GET', '/api/foodhub/recon/fees')).json;
  check('commission plans start from the published Canadian rate cards', fees0?.fees?.channels?.uber_eats?.deliveryPct === 25 && fees0.fees.channels.doordash.pickupPct === 8 && fees0.presets?.uber_eats?.length === 4);
  check('impossible commission refused', (await call('PUT', '/api/foodhub/recon/fees', { body: { fees: { channels: { skip: { deliveryPct: 150 } } } } })).status === 400);
  const fees1 = await call('PUT', '/api/foodhub/recon/fees', { body: { fees: { confirmed: { uber_eats: true, doordash: true } } } });
  check('plans confirmed as matching the contract', fees1.json?.fees?.confirmed?.uber_eats === true && fees1.json.fees.confirmed.doordash === true);
  await call('POST', '/api/foodhub/users', { body: { username: 'mo.hoch', name: 'Mo', role: 'manager', locations: ['HOCHELAGA'], password: 'manager-pass-1' } });
  const mli = await call('POST', '/api/foodhub/auth/login', { auth: false, body: { username: 'mo.hoch', password: 'manager-pass-1' } });
  const mcookie = (mli.cookie || '').split(';')[0];
  const mRecon = await call('GET', `/api/foodhub/recon?from=${today}&to=${today}`, { cookie: mcookie });
  const mPage = await call('GET', '/', { cookie: mcookie });
  check('a manager limited to one location cannot see payouts (they cover every location)', mli.status === 200 && mRecon.status === 403 && mPage.status === 200 && !mPage.text.includes('href="/money"'));

  console.log('\n32. Too Good To Go daily bags');
  const yday = localDay(-1);
  const bag1 = await call('POST', '/api/foodhub/tgtg', { body: { date: yday, locationCode: 'NDG_MAIN', bagsOffered: 12, bagsSold: 9, pricePerBag: 5.99 } });
  const ydayOrders = (await call('GET', `/api/foodhub/orders?limit=500&from=${yday}&to=${yday}`)).json?.orders || [];
  const logOrder = ydayOrders.find((o) => o.externalOrderId === `tgtg-log-NDG_MAIN-${yday}`);
  check('bag log → a Too Good To Go sale for that day (9 × $5.99 = $53.91)', !!bag1.json?.day?.orderId && logOrder?.status === 'completed' && logOrder.total === 53.91 && logOrder.channel === 'tgtg', JSON.stringify(logOrder && { s: logOrder.status, t: logOrder.total }));
  const bag2 = await call('POST', '/api/foodhub/tgtg', { body: { date: today, locationCode: 'NDG_MAIN', bagsOffered: 5, bagsSold: 3, pricePerBag: 5.99 } });
  check('TGTG orders already came by webhook today → logged, not counted twice', bag2.json?.day?.feedOrders === 1 && bag2.json.day.orderId === null);
  check('more bags sold than offered is refused', (await call('POST', '/api/foodhub/tgtg', { body: { date: yday, locationCode: 'NDG_MAIN', bagsOffered: 2, bagsSold: 9, pricePerBag: 5.99 } })).status === 400);
  check('bag days listed', ((await call('GET', `/api/foodhub/tgtg?from=${yday}`)).json?.days || []).length === 2);

  console.log('\n33. French menus (Quebec)');
  const m33 = await menuNow();
  const enName = m33.items.find((i) => i.ref === 'clv-item-1')?.name;
  m33.items = m33.items.map((i) => (i.ref === 'clv-item-1' ? { ...i, nameFr: 'Poulet grillé', descriptionFr: 'Demi-poulet grillé au charbon' } : i));
  m33.categories = m33.categories.map((c) => (c.name === 'Plats' ? { ...c, nameFr: 'Plats principaux' } : c));
  check('French names saved on the master menu', (await call('PUT', '/api/foodhub/menu', { body: { menu: m33 } })).json?.ok === true);
  check('DoorDash menu language set to French (Uber stays French / English)', (await call('PUT', '/api/foodhub/menu/languages', { body: { languages: { doordash: 'fr' } } })).json?.languages?.doordash === 'fr');
  const b33 = log.length;
  await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const a33 = log.slice(b33);
  const u33 = a33.find((e) => e.method === 'PUT' && /uber-store-uuid-1\/menus$/.test(e.path))?.body?.items?.find((i) => i.id === 'clv-item-1');
  check('Uber Eats gets French and English in ONE translation (Uber shows only one)', JSON.stringify(u33?.title?.translations) === JSON.stringify({ fr_ca: `Poulet grillé / ${enName}` }), JSON.stringify(u33?.title));
  const d33 = a33.find((e) => /\/dd\/api\/v1\/menus/.test(e.path) && e.body?.store?.merchant_supplied_id === 'dd-popoulet-ndg')?.body;
  check('DoorDash gets the French names', !!d33?.menu?.categories?.some((c) => c.name === 'Plats principaux' && c.items.some((i) => i.name === 'Poulet grillé')), JSON.stringify(d33?.menu?.categories?.map((c) => c.name)));
  const s33 = JSON.stringify(a33.find((e) => e.path === '/skip/menus' && e.body?.restaurants?.includes('NDG-POPOULET'))?.body || {});
  check('Skip stays in English (its setting)', s33.includes(enName) && !s33.includes('Poulet grillé'));

  console.log('\n34. Uber store disconnected, installable kitchen app');
  await uberSigned(JSON.stringify({ event_type: 'store.deprovisioned', event_id: 'evt-deprov-1', meta: { resource_id: 'uber-store-uuid-1' } }));
  const dal = await waitFor(async () => ((await call('GET', '/api/foodhub/command')).json?.alerts || []).find((a) => a.id === `deprov:${ids.uber.id}`));
  check('Uber "store deprovisioned" → critical alert on the Command Center', dal?.severity === 'critical');
  await uberSigned(JSON.stringify({ event_type: 'store.provisioned', event_id: 'evt-prov-1', meta: { resource_id: 'uber-store-uuid-1' } }));
  check('store reconnected → the alert clears', !!(await waitFor(async () => !((await call('GET', '/api/foodhub/command')).json?.alerts || []).some((a) => a.id === `deprov:${ids.uber.id}`))));
  const mf = await call('GET', '/manifest.webmanifest', { auth: false });
  check('kitchen tablet app installable: public manifest, standalone, icons', mf.status === 200 && mf.json?.display === 'standalone' && mf.json.icons?.length >= 3);
  const swjs = await call('GET', '/sw.js', { auth: false });
  check('service worker is public and never caches live data (/api)', swjs.status === 200 && swjs.text.includes("startsWith('/api/')"));
  check('app icon served without sign-in', (await call('GET', '/icons/icon-192.png', { auth: false })).status === 200);

  console.log('\n35. Every screen renders');
  const screens = ['/', '/orders', `/orders/${o8?.id}`, `/ticket/${o8?.id}`, '/kitchen', '/stores', '/stores/hours', '/stores/mapping', '/menu', '/menu/86', '/alerts',
    '/insights', '/insights/reports', '/insights/activity', '/money', '/money/reconciliation', '/money/disputes', '/money/payouts', '/money/ledger', '/money/statements', '/money/fees', '/money/tgtg',
    '/settings', '/settings/profile', '/settings/team', '/settings/devices', '/settings/security', '/settings/alerts', '/settings/channels', '/settings/business', '/settings/go-live'];
  const rendered = await Promise.all(screens.map((s2) => call('GET', s2)));
  check(`${screens.length} screens return 200`, rendered.every((r) => r.status === 200), screens.filter((_, i) => rendered[i].status !== 200).map((x, i) => `${x}`).join(','));
  const oldPages = await Promise.all(['/imports', '/ledger', '/finance/disputes', '/foodhub/orders', '/go-live'].map((x) => call('GET', x, { redirect: 'manual' })));
  check('old bookmarks lead to the new pages', oldPages.every((r) => [307, 308].includes(r.status)) && /\/money\/statements$/.test(oldPages[0].location || '') && /\/money\/ledger$/.test(oldPages[1].location || '') && /\/money\/disputes$/.test(oldPages[2].location || '') && /\/orders$/.test(oldPages[3].location || '') && /\/settings\/go-live$/.test(oldPages[4].location || ''), oldPages.map((r) => `${r.status} ${r.location}`).join(' '));

  console.log('\n36. RC10 — sign-in by code, kitchen tablets, staff PINs, manager approvals, cancellation alarm, Watchtower');
  const twilioMsgs = () => log.filter((e) => e.method === 'POST' && e.path.endsWith('/Messages.json')).map((e) => Object.fromEntries(new URLSearchParams(String(e.body || ''))));
  const twilioCalls = () => log.filter((e) => e.method === 'POST' && e.path.endsWith('/Calls.json')).map((e) => Object.fromEntries(new URLSearchParams(String(e.body || ''))));
  const mails = () => log.filter((e) => e.path === '/resend/emails').map((e) => e.body);
  check('first-run owner setup is closed once accounts exist', (await call('GET', '/api/foodhub/auth/setup', { auth: false })).json?.needed === false);

  // --- people
  const nadia = await call('POST', '/api/foodhub/users', { body: { name: 'Nadia Gérante', role: 'manager', locations: ['HOCHELAGA'], email: 'nadia@takatak.example', phone: '514 555 0177', pin: '4827', invite: true } });
  check('manager added with email + cell + PIN; invitation emailed; no PIN or hash returned', nadia.json?.user?.username === 'nadia.gerante' && nadia.json.user.hasPin === true && nadia.json.user.phone === '+15145550177' && nadia.json.invite?.ok === true && !/pin1\$|scrypt/.test(nadia.text), nadia.text.slice(0, 300));
  const leo = await call('POST', '/api/foodhub/users', { body: { name: 'Léo Cuisine', role: 'operator', locations: ['HOCHELAGA'], pin: '7342' } });
  check('kitchen staff added with a PIN only (no email, no password)', leo.json?.user?.username === 'leo.cuisine' && leo.json.user.hasPin === true && !leo.json.user.email && leo.json.user.hasPassword === false);
  check('a trivial PIN (1234) is refused', (await call('POST', '/api/foodhub/users', { body: { name: 'Bad Pin', role: 'operator', locations: ['HOCHELAGA'], pin: '1234' } })).status === 400);
  check('the same PIN cannot belong to two people', (await call('POST', '/api/foodhub/users', { body: { name: 'Dup Pin', role: 'operator', locations: ['HOCHELAGA'], pin: '7342' } })).status === 400);

  // --- sign-in by email code
  const m0 = mails().length;
  const st1 = await call('POST', '/api/foodhub/auth/start', { auth: false, body: { contact: ' Nadia@Takatak.example ' } });
  const mail1 = await waitFor(async () => mails().slice(m0).find((m) => m?.to?.[0] === 'nadia@takatak.example'));
  const code1 = /(\d{6})/.exec(mail1?.subject || '')?.[1];
  check('sign-in code emailed from the sign-in address; masked on screen; never in the API answer (production)', st1.status === 200 && /^n•+@takatak\.example$/.test(st1.json?.sentTo || '') && !st1.json.devCode && !!code1 && /connexion@takatak\.example/.test(mail1.from) && (mail1.html || '').includes(code1), JSON.stringify(st1.json));
  check('wrong code refused', (await call('POST', '/api/foodhub/auth/verify', { auth: false, body: { challengeId: st1.json?.challengeId, code: code1 === '000000' ? '111111' : '000000' } })).status === 401);
  const v1 = await call('POST', '/api/foodhub/auth/verify', { auth: false, body: { challengeId: st1.json?.challengeId, code: code1 } });
  const ncookie = (v1.cookie || '').split(';')[0];
  check('right code → 14-day HttpOnly session', v1.status === 200 && /^takatak_session=/.test(ncookie) && /HttpOnly/i.test(v1.cookie || '') && /Max-Age=1209600/i.test(v1.cookie || ''), v1.cookie);
  check('a code works only once', (await call('POST', '/api/foodhub/auth/verify', { auth: false, body: { challengeId: st1.json?.challengeId, code: code1 } })).status >= 400);
  const meN = (await call('GET', '/api/foodhub/auth/me', { cookie: ncookie })).json?.user;
  check('Nadia is a HOCHELAGA manager with a PIN', meN?.role === 'manager' && meN.locations?.[0] === 'HOCHELAGA' && meN.hasPin === true, JSON.stringify(meN));
  const g0 = mails().length;
  const ghost = await call('POST', '/api/foodhub/auth/start', { auth: false, body: { contact: 'stranger@example.com' } });
  await sleep(200);
  check('unknown email: same answer, nothing sent (nobody can probe who has access)', ghost.status === 200 && !!ghost.json?.challengeId && mails().length === g0);
  for (let i = 0; i < 5; i++) await call('POST', '/api/foodhub/auth/start', { auth: false, body: { contact: 'stranger@example.com' } });
  check('sign-in requests are rate-limited (5 per 15 min per contact)', (await call('POST', '/api/foodhub/auth/start', { auth: false, body: { contact: 'stranger@example.com' } })).status === 429);

  // --- sign-in by SMS + one-tap link
  const s0 = twilioMsgs().length;
  const st2 = await call('POST', '/api/foodhub/auth/start', { auth: false, body: { contact: '514-555-0177', next: '/orders' } });
  const sms2 = await waitFor(async () => twilioMsgs().slice(s0).find((m) => m.To === '+15145550177'));
  const code2 = /(?:code est|code is) (\d{6})/.exec(sms2?.Body || '')?.[1];
  check('code by SMS (Twilio) with the one-tap link and the auto-fill line (@domain #code)', st2.json?.channel === 'sms' && !!code2 && (sms2.Body || '').includes(`@takatak.example #${code2}`) && (sms2.Body || '').includes('/api/foodhub/auth/link?c='), sms2?.Body);
  const link2 = /https:\/\/takatak\.example(\/api\/foodhub\/auth\/link\?c=\S+)/.exec(sms2?.Body || '')?.[1] || '/x';
  const lk = await call('GET', link2, { auth: false, redirect: 'manual' });
  check('one-tap link signs in and opens the page asked for', [302, 307].includes(lk.status) && lk.location === 'https://takatak.example/orders' && /takatak_session=/.test(lk.cookie || ''), `${lk.status} ${lk.location}`);
  check('the link works only once', /\/login\?error=/.test((await call('GET', link2, { auth: false, redirect: 'manual' })).location || ''));
  const ob = await call('GET', '/api/foodhub/messages');
  check('message log keeps masked numbers and never the sign-in codes', ob.status === 200 && ob.json?.messages?.some((m) => m.purpose === 'sign_in') && !ob.text.includes(code1) && !ob.text.includes(code2) && !ob.text.includes('5145550177'));

  // --- kitchen tablet
  const en = await call('POST', '/api/foodhub/devices', { cookie: ncookie, body: { name: 'Passe Hochelaga', locationCode: 'HOCHELAGA' } });
  const dcookie = (en.cookie || '').split(';')[0];
  check('manager enrols the HOCHELAGA tablet (1-year signed device cookie)', en.json?.ok === true && /^takatak_device=/.test(dcookie) && /Max-Age=31536000/.test(en.cookie || ''), en.cookie);
  check('a manager cannot enrol a tablet for another kitchen', (await call('POST', '/api/foodhub/devices', { cookie: ncookie, body: { name: 'X', locationCode: 'NDG_MAIN' } })).status === 403);
  const lockRedirect = await call('GET', '/orders', { auth: false, cookie: dcookie, redirect: 'manual' });
  check('the tablet opens the PIN screen, not the email sign-in', [302, 307].includes(lockRedirect.status) && /\/kitchen\/lock/.test(lockRedirect.location || ''), `${lockRedirect.status} ${lockRedirect.location}`);
  check('PIN screen loads on the tablet', (await call('GET', '/kitchen/lock', { auth: false, cookie: dcookie })).status === 200);
  const people = (await call('GET', '/api/foodhub/auth/pin', { auth: false, cookie: dcookie })).json;
  check('PIN screen lists HOCHELAGA people with a PIN — no contact details', people?.device?.locationCode === 'HOCHELAGA' && people.people.some((x) => x.username === 'leo.cuisine') && people.people.some((x) => x.username === 'nadia.gerante') && !JSON.stringify(people).includes('takatak.example'), JSON.stringify(people));
  check('PIN screen refused on a normal browser', (await call('GET', '/api/foodhub/auth/pin', { auth: false })).status === 403);
  const hb1 = await call('POST', '/api/foodhub/devices/heartbeat', { auth: false, cookie: dcookie, body: { soundOn: false, visible: true, battery: 0.42, charging: false, screen: 'lock' } });
  check('tablet heartbeat: counts orders waiting and orders cancelled by the customer', hb1.json?.ok === true && typeof hb1.json.waiting === 'number' && hb1.json.cancelled >= 1, JSON.stringify(hb1.json));
  check('wrong PIN refused on the tablet', (await call('POST', '/api/foodhub/auth/pin', { auth: false, cookie: dcookie, body: { username: 'leo.cuisine', pin: '9031' } })).status === 401);
  const un = await call('POST', '/api/foodhub/auth/pin', { auth: false, cookie: dcookie, body: { username: 'leo.cuisine', pin: '7342' } });
  const lcookie = `${dcookie}; ${(un.cookie || '').split(';')[0]}`;
  check('Léo unlocks with his PIN (14-hour session tied to the tablet)', un.status === 200 && /Max-Age=50400/.test(un.cookie || ''), un.cookie);
  const meL = (await call('GET', '/api/foodhub/auth/me', { cookie: lcookie })).json?.user;
  check('staff session knows its tablet and kitchen', meL?.role === 'operator' && meL.device?.locationCode === 'HOCHELAGA', JSON.stringify(meL));
  await call('POST', '/api/foodhub/devices/heartbeat', { cookie: lcookie, body: { soundOn: true, visible: true, battery: 0.42, charging: true, screen: 'console' } });
  const myDev = (await call('GET', '/api/foodhub/devices', { cookie: ncookie })).json?.devices?.find((d) => d.name === 'Passe Hochelaga');
  check('tablet listed online with battery and who is signed in', myDev?.status === 'online' && myDev.battery === 0.42 && myDev.soundOn === true && myDev.signedIn === 'Léo Cuisine', JSON.stringify(myDev));

  // --- cancellation alarm
  const pz0 = (await call('GET', '/api/foodhub/pulse', { cookie: lcookie })).json;
  const cAl = (pz0?.cancelAlerts || []).find((x) => x.id === o4?.id);
  check('order cancelled by the customer → red alarm on the HOCHELAGA tablet', cAl?.cancelledBy === 'customer' && cAl.wasCooking === true, JSON.stringify(pz0?.cancelAlerts));
  const ackC = await call('POST', `/api/foodhub/orders/${o4?.id}`, { cookie: lcookie, body: { action: 'ack' } });
  const pz1 = (await call('GET', '/api/foodhub/pulse', { cookie: lcookie })).json;
  check('"Got it" clears the alarm on every screen (logged)', ackC.json?.result?.ok === true && !(pz1?.cancelAlerts || []).some((x) => x.id === o4?.id) && (await call('POST', '/api/foodhub/devices/heartbeat', { auth: false, cookie: dcookie, body: {} })).json?.cancelled === 0);

  // --- manager approvals
  await skipWebhook('orders', skipOrder('skip-order-0036', 'HOCH-POPOULET', 'tx-0036'));
  const o36 = await waitFor(async () => { const o = await findOrder('skip-order-0036'); return o?.posOrderId ? o : null; });
  const pz2 = (await call('GET', '/api/foodhub/pulse', { cookie: lcookie })).json;
  check('live pulse: new order pops up on the HOCHELAGA tablet with its Skip deadline (and only HOCHELAGA)', pz2?.incoming?.some((x) => x.id === o36?.id && x.deadlineAt) && pz2.incoming.every((x) => x.locationCode === 'HOCHELAGA'));
  const rj1 = await call('POST', `/api/foodhub/orders/${o36?.id}`, { cookie: lcookie, body: { action: 'deny', reasonCode: 'out_of_stock' } });
  check('staff reject → 428: manager PIN needed', rj1.status === 428 && rj1.json?.needsApproval === true && rj1.json.action === 'order.reject' && /Refuser/.test(rj1.json.labelFr || ''), rj1.text.slice(0, 200));
  const rj2 = await call('POST', `/api/foodhub/orders/${o36?.id}`, { cookie: lcookie, headers: { 'x-approval-pin': '7342' }, body: { action: 'deny', reasonCode: 'out_of_stock' } });
  check('staff cannot approve with their own PIN', rj2.status === 403 && rj2.json?.wrongPin === true);
  const rj3 = await call('POST', `/api/foodhub/orders/${o36?.id}`, { cookie: lcookie, headers: { 'x-approval-pin': '4827' }, body: { action: 'deny', reasonCode: 'out_of_stock' } });
  check('Nadia’s PIN approves: Skip order handed back to the Skip tablet, approver kept on the order', rj3.status === 200 && rj3.json?.order?.status === 'failed' && rj3.json.order.timeline?.approvedBy === 'Nadia Gérante' && sent('POST', /^\/skip\/order\/skip-order-0036\/sent-to-pos-failed$/).length === 1, rj3.text.slice(0, 300));
  const act36 = (await call('GET', '/api/foodhub/activity?limit=80')).json?.entries || [];
  check('activity log: "Nadia approved … for Léo"', JSON.stringify(act36).includes('Nadia Gérante approved'), JSON.stringify(act36).slice(0, 200));
  check('a store-cancelled order does not ring the cancellation alarm', !((await call('GET', '/api/foodhub/pulse', { cookie: lcookie })).json?.cancelAlerts || []).some((x) => x.id === o36?.id));
  check('staff pausing a store also needs a manager', (await call('POST', '/api/foodhub/stores/status', { cookie: lcookie, body: { storeIds: [ids.skipManual.id], online: false } })).status === 428);
  check('staff cannot touch money at all (no permission)', (await call('POST', '/api/foodhub/recon/run', { cookie: lcookie, body: {} })).status === 403);
  const pol = await call('PUT', '/api/foodhub/security', { body: { policy: { 'order.delay': 'manager', bogus: 'off', 'order.reject': 'nope' } } });
  check('owner changes the PIN rules (unknown values ignored)', pol.json?.policy?.['order.delay'] === 'manager' && pol.json.policy['order.reject'] === 'manager' && !('bogus' in (pol.json.policy || {})));
  check('a manager cannot change the PIN rules', (await call('PUT', '/api/foodhub/security', { cookie: ncookie, body: { policy: { 'order.reject': 'off' } } })).status === 403);

  // --- Watchtower
  check('Watchtower cron refuses a missing secret', (await call('GET', '/api/foodhub/cron/watch', { auth: false })).status === 401);
  const ws = await call('PUT', '/api/foodhub/watch/settings', { body: { settings: { unacceptedAfterSec: 20, supportPhones: ['514 555 0199'] } } });
  check('alert rules saved (thresholds clamped, support line normalised)', ws.json?.settings?.unacceptedAfterSec === 20 && ws.json.settings.supportPhones?.[0] === '+15145550199', JSON.stringify(ws.json?.settings));
  await call('POST', '/api/foodhub/catalog', { body: { location: { code: 'HOCHELAGA', name: 'HOCHELAGA', address: '3583 Rue Sainte-Catherine E', city: 'Montréal', phone: '514-555-0100', active: true } } });
  await skipWebhook('orders', skipOrder('skip-order-0037', 'HOCH-POPOULET', 'tx-0037'));
  const o37 = await waitFor(async () => { const o = await findOrder('skip-order-0037'); return o?.posOrderId ? o : null; });
  await sleep(21_000);
  const wr = await call('GET', '/api/foodhub/cron/watch', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  const inc37 = ((await call('GET', '/api/foodhub/incidents?status=open')).json?.incidents || []).find((i) => i.orderId === o37?.id);
  check('order waiting 20 s → Watchtower incident with a plain explanation (rules, no AI key)', wr.json?.report?.ran === true && inc37?.kind === 'order_unaccepted' && (inc37.explanation || '').length > 20, JSON.stringify(wr.json?.report));
  check('incident posted to the team chat', log.some((e) => e.path === '/chat' && /skip-order-0037|SK0037|attend/.test(JSON.stringify(e.body))));
  check('incident shows on every screen of that kitchen (pulse)', ((await call('GET', '/api/foodhub/pulse', { cookie: lcookie })).json?.incidents?.top || []).some((i) => i.id === inc37?.id));
  const ack37 = await call('POST', '/api/foodhub/incidents', { cookie: ncookie, body: { id: inc37?.id, action: 'ack' } });
  check('"I’m on it" stops the escalation', ack37.json?.incident?.status === 'acknowledged');
  await call('POST', `/api/foodhub/orders/${o37?.id}`, { cookie: ncookie, body: { action: 'accept' } });
  await call('POST', '/api/foodhub/watch/run', { body: {} }); // "Check now" (the cron is throttled to one run per 20 s)
  await sleep(100);
  const r37 = (await call('GET', `/api/foodhub/incidents?id=${inc37?.id}&days=1`)).json?.incidents?.[0];
  check('order accepted → incident closes by itself', r37?.status === 'resolved', JSON.stringify(r37 && { s: r37.status }));
  const dl = await call('POST', `/api/foodhub/orders/${o37?.id}`, { cookie: lcookie, body: { action: 'delay', delayMinutes: 5 } });
  check('"+5 min" now needs a manager (rule changed by the owner)', dl.status === 428);
  const dl2 = await call('POST', `/api/foodhub/orders/${o37?.id}`, { cookie: lcookie, headers: { 'x-approval-pin': '4827' }, body: { action: 'delay', delayMinutes: 5 } });
  check('approved "+5 min" moves the kitchen timer', dl2.json?.result?.ok === true && dl2.json.order.timeline.delayedMinutes === 5);

  // --- tests, profile, copilot
  const tsms = await call('POST', '/api/foodhub/watch/test', { cookie: ncookie, body: { channel: 'sms' } });
  check('"Text me a test" goes out through Twilio', tsms.json?.result?.ok === true && twilioMsgs().some((m) => m.To === '+15145550177' && /test/i.test(m.Body)));
  const tcall = await call('POST', '/api/foodhub/watch/test', { cookie: ncookie, body: { channel: 'call' } });
  check('"Call me": Twilio voice call reading the alert twice in French', tcall.json?.result?.ok === true && /<Say[^>]*fr-CA[^>]*>[\s\S]*<Say[^>]*fr-CA/.test(twilioCalls().pop()?.Twiml || ''));
  check('"Test chat" reaches the team chat', (await call('POST', '/api/foodhub/watch/test', { body: { channel: 'chat' } })).json?.result?.ok === true);
  check("you can't take someone else's PIN", (await call('POST', '/api/foodhub/auth/my-pin', { cookie: ncookie, body: { pin: '7342' } })).status === 400);
  const prof = await call('PATCH', '/api/foodhub/auth/me', { cookie: ncookie, body: { prefs: { lang: 'en', alertCall: false } } });
  check('profile: language and alert choices saved', prof.json?.user?.prefs?.lang === 'en' && prof.json.user.prefs.alertCall === false && prof.json.user.prefs.alertSms === true);
  const cp = await call('POST', '/api/foodhub/copilot', { cookie: ncookie, body: { question: 'Combien de commandes aujourd’hui ?', lang: 'fr' } });
  check('copilot answers without an AI key (built-in rules)', cp.status === 200 && typeof cp.json?.answer === 'string' && cp.json.answer.length > 10 && cp.json.source === 'rules');

  // --- lost tablet
  const rv = await call('DELETE', `/api/foodhub/devices/${myDev?.id}`, { cookie: ncookie });
  check('lost tablet removed → its staff session and PIN screen stop at once', rv.json?.ok === true && (await call('GET', '/api/foodhub/auth/me', { cookie: lcookie })).status === 401 && (await call('POST', '/api/foodhub/auth/pin', { auth: false, cookie: dcookie, body: { username: 'leo.cuisine', pin: '7342' } })).status === 403);
  await call('POST', '/api/foodhub/users', { body: { username: 'nadia.gerante', active: false } });
  check('removing a person signs them out everywhere', (await call('GET', '/api/foodhub/auth/me', { cookie: ncookie })).status === 401);

  console.log('\n37. Clover App Market app — launch, connect a merchant, welcome wizard, test order, keep tokens server-side, uninstall');
  const cst = await call('GET', '/api/foodhub/clover-connect/start', { redirect: 'manual' });
  const cAuth = cst.location ? new URL(cst.location) : null;
  check('"Connect a Clover merchant" sends the owner to Clover with the Food Hub callback', [302, 307].includes(cst.status) && cAuth?.origin === 'https://www.clover.com' && cAuth.pathname === '/oauth/v2/authorize' && cAuth.searchParams.get('client_id') === 'CLVAPPE2E' && cAuth.searchParams.get('redirect_uri') === 'https://takatak.example/api/foodhub/clover-connect/callback', `${cst.status} ${cst.location}`);
  check('starting a Clover connection needs sign-in', [302, 307, 401].includes((await call('GET', '/api/foodhub/clover-connect/start', { auth: false, redirect: 'manual' })).status));
  const cBad = await call('GET', '/api/foodhub/clover-connect/callback?code=nope&merchant_id=APPMERCHANT&client_id=CLVAPPE2E', { auth: false, redirect: 'manual' });
  check('a refused Clover code shows an error, no connection', /\/welcome\/clover\?status=error/.test(cBad.location || ''), cBad.location);
  const cOther = await call('GET', '/api/foodhub/clover-connect/callback?code=clv-good-code&merchant_id=APPMERCHANT&client_id=SOMEOTHERAPP', { auth: false, redirect: 'manual' });
  check('a code for another Clover app is refused', /status=error/.test(cOther.location || ''), cOther.location);
  // Opened from the Clover dashboard / App Market without a code: Food Hub asks Clover for one (Clover's launch flow).
  const cLaunch = await call('GET', '/api/foodhub/clover-connect/callback?merchant_id=APPMERCHANT&client_id=CLVAPPE2E&employee_id=EMP1', { auth: false, redirect: 'manual' });
  const lUrl = cLaunch.location ? new URL(cLaunch.location) : null;
  const lState = lUrl?.searchParams.get('state') || '';
  check('opened from Clover without a code → sent to Clover’s authorize page with a signed launch state', [302, 307].includes(cLaunch.status) && lUrl?.origin === 'https://www.clover.com' && lUrl.pathname === '/oauth/v2/authorize' && /^L[a-f0-9]{36}$/.test(lState), cLaunch.location);
  const cNoCode = await call('GET', `/api/foodhub/clover-connect/callback?state=${lState}&merchant_id=APPMERCHANT`, { auth: false, redirect: 'manual' });
  check('back from Clover still without a code → an error page, never a loop', /\/welcome\/clover\?status=error&err=no_code/.test(cNoCode.location || ''), cNoCode.location);
  const cOk = await call('GET', `/api/foodhub/clover-connect/callback?code=clv-good-code&merchant_id=APPMERCHANT&client_id=CLVAPPE2E&state=${lState}`, { auth: false, redirect: 'manual' });
  check('unknown merchant opening the app from Clover waits for the owner (signed welcome link)', /\/welcome\/clover\?t=/.test(cOk.location || ''), cOk.location);
  const wPath = new URL(cOk.location || 'http://x/').pathname + new URL(cOk.location || 'http://x/').search;
  const welcome = await call('GET', wPath, { auth: false });
  check('welcome page opens without sign-in, says it is waiting for approval, pre-filled from the merchant’s Clover', welcome.status === 200 && welcome.text.includes('Demande reçue') && welcome.text.includes('On2GO.CA (app)') && welcome.text.includes('APPMERCHANT') && welcome.text.includes('Abonnement actif'), String(welcome.status));
  const wForged = await call('GET', '/welcome/clover?t=eyJtIjoiQVBQTUVSQ0hBTlQiLCJleHAiOjk5OTk5OTk5OTl9.forged', { auth: false });
  check('welcome page with a forged ticket shows no merchant data', wForged.status === 200 && !wForged.text.includes('On2GO.CA (app)') && !wForged.text.includes('APPMERCHANT'));
  const ticket = new URL(cOk.location || 'http://x/').searchParams.get('t') || '';
  check('a pending merchant cannot send a test order to its register', (await call('POST', '/api/foodhub/clover-connect/test-order', { auth: false, body: { t: ticket } })).status === 403);
  const chPending = (await call('GET', '/api/foodhub/channels')).json?.clover?.app;
  check('Channels shows it as pending; it is not used for orders or sync yet', chPending?.merchants?.find((m) => m.merchantId === 'APPMERCHANT')?.status === 'pending');
  check('only the owner can approve a Clover merchant', (await call('POST', '/api/foodhub/clover-connect/merchants', { auth: false, body: { merchantId: 'APPMERCHANT' } })).status === 401);
  check('owner approves it', (await call('POST', '/api/foodhub/clover-connect/merchants', { body: { merchantId: 'APPMERCHANT' } })).json?.approved === 'APPMERCHANT');
  const wApproved = await call('GET', wPath, { auth: false });
  check('the same welcome link now says connected and offers the 3 set-up steps and the test order', wApproved.text.includes('Votre caisse Clover est branchée') && wApproved.text.includes('Importez votre menu Clover') && wApproved.text.includes('Envoyer une commande test'));
  const ordersBefore = (await call('GET', '/api/foodhub/orders?limit=500')).json.orders.length;
  const tOrder = await call('POST', '/api/foodhub/clover-connect/test-order', { auth: false, body: { t: ticket } });
  check('test order: created in the merchant’s Clover, printed, paid — each step confirmed by Clover', tOrder.status === 200 && tOrder.json?.steps?.length === 3 && tOrder.json.steps.every((x) => x.ok), tOrder.text.slice(0, 300));
  check('the test order never enters Food Hub (no kitchen, no analytics)', (await call('GET', '/api/foodhub/orders?limit=500')).json.orders.length === ordersBefore);
  check('test order needs a valid ticket and a JSON body', (await call('POST', '/api/foodhub/clover-connect/test-order', { auth: false, body: {} })).status === 401
    && (await call('POST', '/api/foodhub/clover-connect/test-order', { auth: false, raw: `t=${ticket}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status === 415);
  const chApp = (await call('GET', '/api/foodhub/channels?reveal=1')).json?.clover?.app;
  check('Channels lists the approved merchant with its Clover name', chApp?.merchants?.some((m) => m.merchantId === 'APPMERCHANT' && m.name === 'On2GO.CA (app)' && m.status === 'active') && chApp.siteUrl === 'https://takatak.example' && chApp.launchPath === '/api/foodhub/clover-connect/callback');
  check('Channels gives the privacy, terms and support URLs for the Clover listing', chApp?.legal?.privacy === 'https://takatak.example/legal/privacy' && chApp.legal.terms === 'https://takatak.example/legal/terms' && chApp.legal.support === 'https://takatak.example/legal/support' && chApp.legalStatus?.approved === false && chApp.legalStatus.supportEmailSet === false);
  const legalPages = await Promise.all(['/legal/privacy', '/legal/terms', '/legal/support'].map((u) => call('GET', u, { auth: false })));
  check('privacy, terms and support pages are public, in French and English', legalPages.every((r) => r.status === 200) && legalPages[0].text.includes('Politique de confidentialité') && legalPages[0].text.includes('Commission d’accès à l’information') && legalPages[1].text.includes('La version française prévaut') && legalPages[2].text.includes('Soutien'), legalPages.map((r) => r.status).join(','));
  check('Clover app tokens and secret are never sent to the browser', !JSON.stringify(chApp || {}).includes(CLOVER_APP_TOKEN) && !JSON.stringify(chApp || {}).includes('clv-refresh-e2e') && !JSON.stringify(chApp || {}).includes('clover-app-secret-e2e'));
  const mlist = await call('GET', '/api/foodhub/clover-connect/merchants');
  check('merchant list API works and hides tokens', mlist.status === 200 && mlist.json?.merchants?.length >= 1 && !mlist.text.includes(CLOVER_APP_TOKEN));
  check('Clover app uninstall (A:<appId> DELETE) refused without X-Clover-Auth', (await call('POST', '/api/foodhub/webhooks/clover', { auth: false, body: { appId: 'CLVAPPE2E', merchants: { APPMERCHANT: [{ objectId: 'A:CLVAPPE2E', type: 'DELETE' }] } } })).status === 401);
  const cUninstall = await call('POST', '/api/foodhub/webhooks/clover', { auth: false, headers: { 'x-clover-auth': 'clover-auth-e2e' }, body: { appId: 'CLVAPPE2E', merchants: { APPMERCHANT: [{ objectId: 'A:CLVAPPE2E', type: 'DELETE' }] } } });
  const gone = await waitFor(async () => !((await call('GET', '/api/foodhub/clover-connect/merchants')).json?.merchants || []).some((m) => m.merchantId === 'APPMERCHANT'));
  check('merchant that uninstalls the app is disconnected', cUninstall.status === 200 && !!gone);

  console.log('\n38. DoorDash orders received through Clover\'s own DoorDash integration (read-only)');
  if (!cloverOrderTypes.some((t) => t.label === 'DoorDash')) cloverOrderTypes.push({ id: 'OT-DD-NATIVE', label: 'DoorDash' });
  const ddType = cloverOrderTypes.find((t) => t.label === 'DoorDash');
  cloverNativeOrders.push({
    mid: 'MAINMERCHANT', id: 'DDNATIVE-1', createdTime: Date.now() - 125_000, title: 'DoorDash #9F3K2', total: 2499, currency: 'CAD', state: 'locked', orderType: { id: ddType.id },
    lineItems: { elements: [{ id: 'L1', name: 'Poulet Grillé', price: 1599, item: { id: 'clv-item-1' }, modifications: { elements: [{ name: 'Piri-piri', amount: 100 }] } }, { id: 'L2', name: 'Frites', price: 499 }] },
    payments: { elements: [{ id: 'P-DDN', amount: 2499, taxAmount: 301, tipAmount: 0, tender: { id: 'T-DDN', label: 'DoorDash' } }] },
  });
  cloverPayments.push({ id: 'P-DDN', amount: 2499, taxAmount: 301, tipAmount: 0, result: 'SUCCESS', order: { id: 'DDNATIVE-1' }, tender: { id: 'T-DDN', label: 'DoorDash' } });
  const injectsBefore = sent('POST', /\/atomic_order\/orders$/).length;
  const sy38 = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  const main38 = sy38.json?.report?.clover?.find((c) => c.merchantId === 'MAINMERCHANT');
  check('sync reads the DoorDash order Clover received by itself', main38?.platformOrders === 1, JSON.stringify(main38));
  check('…and it is never counted as an in-store sale ($35.00)', main38?.net === 35, JSON.stringify(main38));
  const native = (await call('GET', '/api/foodhub/orders?limit=500')).json.orders.find((o) => o.externalOrderId === 'clover-DDNATIVE-1');
  check('it shows in Food Hub as a DoorDash order "via Clover", already in the kitchen', native?.channel === 'doordash' && native.viaPos === 'clover' && native.status === 'accepted' && native.posOrderId === 'DDNATIVE-1' && native.displayId === '9F3K2' && native.total === 24.99, JSON.stringify(native && { ch: native.channel, via: native.viaPos, st: native.status, d: native.displayId }));
  const nd = (await call('GET', `/api/foodhub/orders/${native?.id}`)).json;
  check('read-only: no accept / reject / cancel / resend — only Ready, Completed, Reprint', JSON.stringify(nd?.actions) === JSON.stringify(['ready', 'complete', 'print']), JSON.stringify(nd?.actions));
  check('refused: cancel is not possible on a via-Clover order', (await call('POST', `/api/foodhub/orders/${native?.id}`, { body: { action: 'cancel', reasonCode: 'other' } })).json?.result?.ok !== true);
  const nDone = await call('POST', `/api/foodhub/orders/${native?.id}`, { body: { action: 'complete' } });
  check('completed in Food Hub only: no Clover payment recorded, not sent to Clover again', nDone.json?.order?.status === 'completed' && !payPosts().some((e) => e.path.endsWith('/orders/DDNATIVE-1/payments')) && sent('POST', /\/atomic_order\/orders$/).length === injectsBefore);
  const sy38b = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  check('read only once (next sync adds nothing)', (sy38b.json?.report?.clover?.find((c) => c.merchantId === 'MAINMERCHANT')?.platformOrders ?? -1) === 0 && (await call('GET', '/api/foodhub/orders?limit=500')).json.orders.filter((o) => o.externalOrderId === 'clover-DDNATIVE-1').length === 1);

  console.log('\n39. Menu photo upload (served publicly for the delivery apps)');
  const pngBuf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngBuf, 0);
  pngBuf.writeUInt32BE(13, 8); pngBuf.write('IHDR', 12, 'ascii'); pngBuf.writeUInt32BE(1200, 16); pngBuf.writeUInt32BE(800, 20);
  const upload = async (buf, type, auth = true) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), 'photo');
    const res = await fetch(`${APP}/api/foodhub/media`, { method: 'POST', headers: auth ? { authorization: basic } : {}, body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const up = await upload(pngBuf, 'image/png');
  check('photo uploaded → public URL on Food Hub', up.status === 200 && /^https:\/\/takatak\.example\/media\/[a-f0-9]{24}\.png$/.test(up.json?.url || '') && up.json.width === 1200, JSON.stringify(up.json));
  const mediaPath = new URL(up.json?.url || 'https://x/none').pathname;
  const served = await call('GET', mediaPath, { auth: false });
  check('photo served without sign-in (Uber / DoorDash / Skip download it)', served.status === 200 && served.contentType === 'image/png' && served.buf.length === 33);
  check('a file that is not a photo is refused', (await upload(Buffer.from('<script>alert(1)</script>'), 'image/png')).status === 415);
  check('upload needs sign-in', [401, 302, 307].includes((await upload(pngBuf, 'image/png', false)).status));
  check('no path tricks on the public photo route', (await call('GET', '/media/..%2F..%2Fpackage.json', { auth: false })).status === 404);

  console.log('\n40. Clover kitchen printing check (items without a printer label)');
  const lab = (await call('GET', '/api/foodhub/clover-labels?merchantId=MAINMERCHANT')).json;
  check('lists the items no printer label covers (hidden items ignored)', lab?.report?.ok === true && lab.report.unprintedCount === 2 && lab.report.items === 2 && lab.report.kitchenLabels.length === 1 && lab.report.kitchenLabels[0].name === 'Cuisine', JSON.stringify(lab?.report && { n: lab.report.unprintedCount, k: lab.report.kitchenLabels }));
  check('a label without a printer cannot be used', (await call('POST', '/api/foodhub/clover-labels', { body: { merchantId: 'MAINMERCHANT', tagId: 'TAG-B', all: true } })).status === 400);
  const labAdd = await call('POST', '/api/foodhub/clover-labels', { body: { merchantId: 'MAINMERCHANT', tagId: 'TAG-K', all: true } });
  check('owner adds the kitchen label in Clover (links only)', labAdd.json?.added === 2 && cloverTagLinks.filter((l) => l.tag === 'TAG-K').length === 2, JSON.stringify(labAdd.json));
  check('re-check: every item now prints in the kitchen', (await call('GET', '/api/foodhub/clover-labels?merchantId=MAINMERCHANT')).json?.report?.unprintedCount === 0);
  check('unknown merchant refused', (await call('GET', '/api/foodhub/clover-labels?merchantId=NOPE')).status === 404);
  check('Clover tax check flags "Sales Tax" 0.14975 % (should be 14.975 %), read-only', lab?.taxes?.ok === true && /14\.975%/.test(lab.taxes.problems?.[0] || '') && !log.some((e) => /tax_rates/.test(e.path) && e.method !== 'GET'), JSON.stringify(lab?.taxes));

  console.log('\n41. Clover backend — delivery / pickup types, free-text lines, automatic retries, webhook inbox, menu lock, Clover menus, dry run, health');
  const cronWatch = () => call('GET', '/api/foodhub/cron/watch', { auth: false, headers: { authorization: 'Bearer cron-e2e' } });
  const ddPost = (body) => call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body });
  const atomicFor = (title) => sent('POST', /\/atomic_order\/orders$/).filter((e) => e.body?.orderCart?.title === title);
  // a) The merchant's own "Online Order Delivery" / "Online Order Pick Up" order types; a line Clover does not know.
  cloverOrderTypes.push({ id: 'OT-OLD', label: 'Online Order Delivery' }, { id: 'OT-OLP', label: 'Online Order Pick Up' });
  await ddPost({ id: 'dd-pickup-41', delivery_short_code: 'P41', store: { merchant_supplied_id: 'dd-popoulet-ndg' }, is_pickup: true, consumer: { first_name: 'Zoé', last_name: 'Tremblay' }, subtotal: 1849, tax: 277, tip_amount: 200,
    categories: [{ name: 'Plats', items: [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }, { name: 'Dessert du chef', quantity: 1, price: 350, merchant_supplied_id: 'dessert-du-chef', extras: [] }] }] });
  const p41 = await waitFor(async () => { const o = await findOrder('dd-pickup-41'); return o?.status === 'accepted' ? o : null; });
  const p41Cart = atomicFor('DoorDash #P41')[0]?.body?.orderCart;
  check('pickup → the merchant’s "Online Order Pick Up" order type; the kitchen note says who and how', p41Cart?.orderType?.id === 'OT-OLP' && /CUEILLETTE \/ PICKUP \| Client: Zoé T\./.test(p41Cart.note || ''), JSON.stringify(p41Cart && { t: p41Cart.orderType, n: p41Cart.note }));
  check('a line Clover does not know goes as a flagged free-text line, never dropped', p41Cart?.lineItems?.length === 2 && !p41Cart.lineItems[1].item && /Hors inventaire Clover/.test(p41Cart.lineItems[1].note || '') && p41?.mappingWarnings?.[0]?.name === 'Dessert du chef' && p41.lines[1].mapping === 'free', JSON.stringify(p41?.mappingWarnings));
  await call('POST', `/api/foodhub/orders/${p41?.id}`, { body: { action: 'ready' } });
  await call('POST', `/api/foodhub/orders/${p41?.id}`, { body: { action: 'complete' } });
  const p41pay = sent('POST', /\/v3\/merchants\/MAINMERCHANT\/orders\/[^/]+\/payments$/).find((e) => e.path.includes(`/orders/${p41?.posOrderId}/`))?.body;
  check('the pickup tip is the restaurant’s: recorded on the Clover payment', p41pay?.tipAmount === 200 && p41pay.amount === 1849 + 277, JSON.stringify(p41pay));
  await ddPost({ id: 'dd-deliv-41', delivery_short_code: 'D41', store: { merchant_supplied_id: 'dd-popoulet-ndg' }, consumer: { first_name: 'Luc' }, subtotal: 1499, tax: 225, tip_amount: 300, categories: [{ name: 'Plats', items: [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }] }] });
  await waitFor(async () => (await findOrder('dd-deliv-41'))?.status === 'accepted');
  check('delivery → the merchant’s "Online Order Delivery" order type', atomicFor('DoorDash #D41')[0]?.body?.orderCart?.orderType?.id === 'OT-OLD');

  // b) Clover down → not confirmed on DoorDash; Clover back → Food Hub retries by itself, then confirms once.
  cloverAtomicMode = 'down';
  await ddPost({ id: 'dd-retry-41', delivery_short_code: 'R41', store: { merchant_supplied_id: 'dd-popoulet-ndg' }, consumer: { first_name: 'Ana' }, subtotal: 1499, tax: 225, categories: [{ name: 'Plats', items: [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }] }] });
  const r41 = await waitFor(async () => { const o = await findOrder('dd-retry-41'); return o?.timeline?.posRetry ? o : null; });
  check('Clover down: the order waits (never confirmed on DoorDash) and a retry is scheduled', r41?.status === 'new' && r41.posError && sent('PATCH', /^\/dd\/api\/v1\/orders\/dd-retry-41$/).length === 0, JSON.stringify(r41 && { s: r41.status, r: r41.timeline?.posRetry }));
  cloverAtomicMode = 'ok';
  // The server timer runs the retry when it is due; the cron (as on a server without the timer) would too.
  const r41b = await waitFor(async () => { await cronWatch(); const o = await findOrder('dd-retry-41'); return o?.status === 'accepted' ? o : null; }, 15000);
  const r41Live = [...cloverAtomicTitles.entries()].filter(([id, title]) => title === 'DoorDash #R41' && cloverOrderTotals.has(id));
  check('Clover back: the automatic retry puts it in Clover once, prints it, then DoorDash is confirmed once', !!r41b?.posOrderId && r41Live.length === 1 && sent('PATCH', /^\/dd\/api\/v1\/orders\/dd-retry-41$/).filter((e) => e.body?.order_status === 'success').length === 1 && sent('POST', /\/print_event$/).some((e) => e.body?.orderRef?.id === r41b.posOrderId), JSON.stringify(r41b && { p: r41b.posOrderId, live: r41Live.length }));
  check('the order page says it was retried and recovered', ((await call('GET', `/api/foodhub/orders/${r41b?.id}`)).json?.events || []).some((e) => e.type === 'pos_injected' && e.detail?.attempt === 1));

  // c) Webhook inbox: Uber refuses the order fetch → kept and retried by itself; refused for good → Replay.
  uberFetchFails = 2;
  check('Uber webhook still answered 200 while Uber refuses the order fetch (saved first)', (await uberWebhook('uber-flaky-41')).status === 200);
  const inb1 = await waitFor(async () => ((await call('GET', '/api/foodhub/inbox')).json?.inbox?.entries || []).find((e) => e.reference === 'uber-flaky-41' && e.status === 'failed'));
  check('the failed webhook is in the inbox with its error and the next automatic try', !!inb1?.nextAt && /HTTP 503/.test(inb1.lastError || ''), JSON.stringify(inb1));
  const fl41 = await waitFor(async () => { await cronWatch(); const o = await findOrder('uber-flaky-41'); return o?.status === 'accepted' ? o : null; }, 15000);
  check('…and the next try gets the order: in Clover and accepted on Uber', !!fl41?.posOrderId && sent('POST', /\/v1\/eats\/orders\/uber-flaky-41\/accept_pos_order$/).length === 1);
  uberFetchFails = 99;
  await uberWebhook('uber-flaky-dead-41');
  await waitFor(async () => ((await call('GET', '/api/foodhub/inbox')).json?.inbox?.entries || []).some((e) => e.reference === 'uber-flaky-dead-41' && e.status === 'failed'));
  const dead = await waitFor(async () => { await cronWatch(); return ((await call('GET', '/api/foodhub/inbox')).json?.inbox?.entries || []).find((e) => e.reference === 'uber-flaky-dead-41' && e.status === 'failed' && !e.nextAt && e.attempts === 3); }, 20000);
  check('after the automatic tries it waits for a person ("Needs replay"), counted on /api/health', !!dead && (await call('GET', '/api/health', { auth: false, headers: { authorization: 'Bearer cron-e2e' } })).json?.checks?.inbox?.status === 'warn', JSON.stringify(dead));
  uberFetchFails = 0;
  const replay41 = await call('POST', '/api/foodhub/inbox', { body: { id: dead?.id } });
  check('Replay processes it: the order arrives, in Clover and accepted', replay41.json?.entry?.status === 'done' && (await waitFor(async () => (await findOrder('uber-flaky-dead-41'))?.status === 'accepted')), JSON.stringify(replay41.json));
  check('replaying again never creates a second order', (await call('POST', '/api/foodhub/inbox', { body: { id: dead?.id } })).json?.entry?.result === 'duplicate (already received)' && (await call('GET', '/api/foodhub/orders?limit=500')).json.orders.filter((o) => o.externalOrderId === 'uber-flaky-dead-41').length === 1);

  // d) "Do not touch this store's menu": Po Poulet NDG on DoorDash (store 27982486).
  const locked41 = (await call('POST', '/api/foodhub/stores', { body: { channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', platformStoreId: '27982486' } })).json?.store;
  check('Po Poulet NDG on DoorDash (store 27982486) is menu-locked for good', locked41?.menuLock?.locked === true && locked41.menuLock.source === 'built_in');
  check('the lock cannot be lifted from the console', (await call('POST', '/api/foodhub/stores', { body: { id: locked41?.id, channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', menuLocked: false } })).status === 409);
  check('…nor by clearing its DoorDash store number or removing the mapping', (await call('POST', '/api/foodhub/stores', { body: { id: locked41?.id, channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', platformStoreId: '' } })).status === 409
    && (await call('DELETE', `/api/foodhub/stores?id=${locked41?.id}`)).status === 409);

  // e) Import from the Clover DoorDash menu (+20 %): only its items, its photos, the markup kept.
  cloverItems.push({ id: 'clv-item-4', name: 'Salade de chou', price: 271, available: true, categories: { elements: [{ id: 'clv-cat-2', name: 'Accompagnements', sortOrder: 2 }] }, modifierGroups: { elements: [] } });
  cloverItems.push({ id: 'clv-item-5', name: 'Old wings', price: 999, available: true, categories: { elements: [{ id: 'clv-cat-arch', name: 'ARCHIVE · Ailes', sortOrder: 9 }] }, modifierGroups: { elements: [] } });
  const menus41 = (await call('GET', '/api/foodhub/menu/import')).json?.cloverMenus;
  check('the Menu editor lists the merchant’s Clover menus; the DoorDash one is recognised', menus41?.ok === true && menus41.menus.find((m) => m.id === 'MENU-DD')?.platform === 'doordash', JSON.stringify(menus41));
  const imp41 = await call('POST', '/api/foodhub/menu/import', { body: { brand: 'Po Poulet', cloverMenuId: 'MENU-DD', platformPrices: ['doordash'] } });
  const rep41 = imp41.json?.report;
  check('import from the DoorDash menu: its 3 items, +20 % detected (no per-item price needed), photo kept', rep41?.items === 3 && rep41.platformPrices?.doordash?.markupPct === 20 && rep41.platformPrices.doordash.overrides === 0 && imp41.json.menu.channelMarkupPct?.doordash === 20
    && imp41.json.menu.items.find((i) => i.ref === 'clv-item-4')?.imageUrl === 'https://cloverstatic.com/menu-assets/items/clv-item-4.jpeg' && !imp41.json.menu.items.some((i) => i.ref === 'clv-item-5'), JSON.stringify(rep41));
  check('other platforms keep their own prices (Uber 16.49 on the grilled chicken)', imp41.json?.menu?.items?.find((i) => i.ref === 'clv-item-1')?.channelPrices?.uber_eats === 16.49);

  // f) Dry run: what each store would receive — nothing sent; the locked store is never in it.
  const menuPutsBefore = sent('PUT', /\/v2\/eats\/stores\/[^/]+\/menus$/).length + sent('POST', /^\/dd\/api\/v1\/menus$/).length;
  const dry = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet', dryRun: true } });
  const rowOf = (id) => (dry.json?.preview || []).find((r) => r.channelStoreId === id);
  check('dry run: the locked store would get nothing; the Uber store gets the new salad', rowOf('NDG_6284-POPOULET')?.send === 'locked' && rowOf('uber-store-uuid-1')?.send === 'yes' && rowOf('uber-store-uuid-1').diff?.added?.some((a) => a.ref === 'clv-item-4'), JSON.stringify(dry.json?.preview?.map((r) => [r.channelStoreId, r.send])));
  check('dry run sends nothing to any platform', sent('PUT', /\/v2\/eats\/stores\/[^/]+\/menus$/).length + sent('POST', /^\/dd\/api\/v1\/menus$/).length === menuPutsBefore);
  const pub41 = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Po Poulet' } });
  const lockedRow = (pub41.json?.results || []).find((r) => r.channelStoreId === 'NDG_6284-POPOULET');
  check('real publish: every other store gets the menu, the locked store is reported "not sent"', lockedRow?.result?.status === 'skipped' && /locked/.test(lockedRow.result.message) && !sent('POST', /^\/dd\/api\/v1\/menus$/).some((e) => e.body?.store?.merchant_supplied_id === 'NDG_6284-POPOULET'));
  const av41 = await call('POST', '/api/foodhub/availability', { body: { brand: 'Po Poulet', locationCode: 'NDG_6284', itemRefs: ['clv-item-4'], available: false } });
  check('an 86 at that kitchen never reaches the locked store', (av41.json?.results || []).find((r) => r.channelStoreId === 'NDG_6284-POPOULET')?.result?.status === 'skipped' && sent('PUT', /\/dd\/api\/v1\/stores\/NDG_6284-POPOULET\/items\/status$/).length === 0);
  check('DoorDash Menu Request for the locked store is refused (DoorDash keeps its menu)', (await call('GET', '/api/foodhub/webhooks/doordash/NDG_6284-POPOULET', { auth: false, headers: { authorization: 'dd-hook-e2e' } })).status === 409);

  // g) Health for an outside uptime monitor.
  const hp = await call('GET', '/api/health', { auth: false });
  check('/api/health is public and only says each check’s status', [200, 503].includes(hp.status) && JSON.stringify(Object.keys(hp.json || {}).sort()) === JSON.stringify(['at', 'checks', 'ok', 'status']) && (hp.status === 503) === (hp.json?.status === 'down'), JSON.stringify(hp.json));
  const hd = (await call('GET', '/api/health', { auth: false, headers: { authorization: 'Bearer cron-e2e' } })).json;
  check('with the cron secret: each platform and its last order, the Watchtower alive', hd?.platforms?.length === 4 && !!hd.platforms.find((p) => p.channel === 'doordash')?.lastOrderAt && hd.checks?.watchtower?.status === 'ok', JSON.stringify(hd && { p: hd.platforms, w: hd.checks?.watchtower }));
  check('the Overview reads the same health (session)', (await call('GET', '/api/health')).json?.platforms?.length === 4);
  check('a production build on the in-memory store says so: database "down" (503); the screens open', hp.status === 503 && hd?.checks?.database?.status === 'down' && hd.checks.console?.status === 'ok', JSON.stringify(hd?.checks && { db: hd.checks.database, c: hd.checks.console }));
  check('no secret, store, brand, merchant or address in the public answer', ![PASSWORD, UBER_SECRET, DD_SECRET_B64, JET_API_KEY, SKIP_HMAC, SKIP_NOTIFY_KEY, CLOVER_TOKEN, RELAY_SECRET, RELAY_CB_TOKEN, 'cron-e2e', 'tw-e2e', 're_e2e', 'Po Poulet', 'NDG', 'MAINMERCHANT', 'takatak.example', MOCK].some((x) => JSON.stringify(hp.json).includes(x)), JSON.stringify(hp.json));
  check('only the exact path is public (/api/health/x and /api/healthz need sign-in)', (await call('GET', '/api/health/x', { auth: false })).status === 401 && (await call('GET', '/api/healthz', { auth: false })).status === 401);

  console.log('\n42. Uber Eats: orders whose webhook never arrived (missed-order check)');
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  // uber-new-1: Uber confirmed Food Hub as order manager. uber-store-uuid-1: never confirmed — must not be polled.
  uberCreated.set('uber-new-1', [{ id: 'uber-missed-1', current_state: 'CREATED', placed_at: ago(2) }, { id: 'uber-too-old-1', current_state: 'CREATED', placed_at: ago(20) }, { id: 'uber-too-new-1', current_state: 'CREATED', placed_at: ago(0.2) }]);
  uberCreated.set('uber-store-uuid-1', [{ id: 'uber-not-mine-1', current_state: 'CREATED', placed_at: ago(2) }]);
  const sy41 = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  check('sync finds the order no webhook announced and processes it (Clover first, then accept)', sy41.json?.report?.uberMissed?.recovered === 1 && !!(await waitFor(async () => { const o = await findOrder('uber-missed-1'); return o?.posOrderId && o.status === 'accepted' ? o : null; })), JSON.stringify(sy41.json?.report?.uberMissed));
  check('missed-order check skips stores not confirmed as Food Hub’s, orders past the 11.5-min window and orders the webhook may still bring', !(await findOrder('uber-not-mine-1')) && !(await findOrder('uber-too-old-1')) && !(await findOrder('uber-too-new-1')) && !sent('GET', /\/v1\/eats\/stores\/uber-store-uuid-1\/created-orders$/).length);

  console.log('\n42b. Order Relay (partner feed → Clover → kitchen), one menu for two brands, late orders never cooked by themselves');
  // a) Food Hub Order Relay: a Too Good To Go feed pushed by a partner.
  const relayCallbacks = (hubId) => sent('POST', /^\/relay\/callback$/).filter((e) => e.body?.order_id === hubId);
  check('relay refuses a wrong or a missing token (401)', (await relayHook(relayOrder('880000'), 'wrong-token')).status === 401 && (await relayHook(relayOrder('880000'), '')).status === 401);
  const relCh = (await call('GET', '/api/foodhub/channels')).json?.relay;
  check('Channels shows the relay address with its token hidden, callback set, TGTG only', relCh?.webhookReady === true && relCh.callbackReady === true && JSON.stringify(relCh.channels) === '["tgtg"]' && /token=••••••••$/.test(relCh.webhookUrl || ''), JSON.stringify(relCh));
  ids.relay = await mk({ channel: 'tgtg', channelStoreId: 'relay:tgtg-partner-77', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' });
  check('partner store mapped as "relay:<partner store id>"', ids.relay?.channelStoreId === 'relay:tgtg-partner-77');
  const b42r = log.length;
  const r42 = await relayHook(relayOrder('880001'));
  check('TGTG order pushed to the relay → saved before the 200, Food Hub reference returned', r42.status === 200 && r42.json?.order_ref_id === 'relay-880001', JSON.stringify(r42.json));
  const o42 = await waitFor(async () => { const o = await findOrder('relay-880001'); return o?.status === 'accepted' && o.posOrderId ? o : null; });
  const atomic42 = log.slice(b42r).filter((e) => isAtomic(e) && /880001/.test(e.body?.orderCart?.title || ''));
  check('read as Too Good To Go, routed by its "relay:" mapping to Po Poulet · NDG, one Clover order (2 × 5.99 $), accepted', o42?.channel === 'tgtg' && o42.viaHub === 'relay' && o42.brandName === 'Po Poulet' && o42.locationCode === 'NDG_MAIN' && atomic42.length === 1 && atomic42[0].body.orderCart.lineItems?.length === 2 && atomic42[0].body.orderCart.lineItems.every((l) => l.price === 599), JSON.stringify(o42 && { ch: o42.channel, via: o42.viaHub, l: o42.locationCode, n: atomic42.length }));
  const ack42 = relayCallbacks('880001');
  check('accept posted to the partner callback ("Acknowledged", bearer token) — only after Clover had the order', ack42.length === 1 && ack42[0].body.new_status === 'Acknowledged' && ack42[0].headers.authorization === `Bearer ${RELAY_CB_TOKEN}` && log.indexOf(ack42[0]) > log.indexOf(atomic42[0]), JSON.stringify(ack42.map((e) => e.body)));
  await relayHook(relayOrder('880001'));
  await sleep(800);
  check('the same relay order delivered twice → one order, one Clover order, one "Acknowledged"', log.slice(b42r).filter((e) => isAtomic(e) && /880001/.test(e.body?.orderCart?.title || '')).length === 1 && relayCallbacks('880001').length === 1);
  const c42 = await relayHook(relayStatus('880001', 'Cancelled', 'Customer cancelled in the partner app'));
  const oc42 = await waitFor(async () => { const o = await findOrder('relay-880001'); return o?.status === 'cancelled' ? o : null; });
  check('partner status "Cancelled" → order cancelled, removed from Clover, nothing posted back for it', c42.status === 200 && !!oc42 && !!(await waitFor(async () => sent('DELETE', new RegExp(`/orders/${o42?.posOrderId}$`)).length === 1)) && !relayCallbacks('880001').some((e) => e.body.new_status === 'Cancelled'));
  // A cancel that beats its order (the order was still in the inbox when the server stopped): no ticket on arrival.
  const b42c = log.length;
  await relayHook(relayStatus('880003', 'Cancelled', 'Customer cancelled'));
  await sleep(300);
  await relayHook(relayOrder('880003'));
  const oc42b = await waitFor(async () => { const o = await findOrder('relay-880003'); return o?.status === 'cancelled' ? o : null; });
  check('a relay cancel that arrives before its order waits for it: the order arrives cancelled, nothing goes to Clover or the partner', !!oc42b && !log.slice(b42c).some((e) => isAtomic(e) && /880003/.test(e.body?.orderCart?.title || '')) && relayCallbacks('880003').length === 0 && !((await call('GET', '/api/foodhub/channels')).json?.unparsed || []).some((j) => j.reference === 'relay-880003'));

  // b) One menu for two brands: Poulet Poulet follows Po Poulet.
  knownUberStores.add('uber-poulet-ndg');
  ids.ppUber = await mk({ channel: 'uber_eats', channelStoreId: 'uber-poulet-ndg', brandName: 'Poulet Poulet', locationCode: 'NDG_MAIN' });
  ids.ppDd = await mk({ channel: 'doordash', channelStoreId: 'dd-poulet-ndg', brandName: 'Poulet Poulet', locationCode: 'NDG_MAIN' });
  check('Poulet Poulet mapped on Uber Eats and DoorDash at NDG', !!ids.ppUber?.id && !!ids.ppDd?.id);
  const sh42 = await call('PUT', '/api/foodhub/menu/sharing', { body: { sharing: { 'Poulet Poulet': 'Po Poulet' } } });
  check('sharing saved: Poulet Poulet uses the Po Poulet menu', sh42.json?.sharing?.['Poulet Poulet'] === 'Po Poulet' && (await call('GET', '/api/foodhub/menu/sharing')).json?.sharing?.['Poulet Poulet'] === 'Po Poulet', JSON.stringify(sh42.json));
  const src42 = (await call('GET', '/api/foodhub/menu?brand=Po%20Poulet')).json;
  const fol42 = (await call('GET', '/api/foodhub/menu?brand=Poulet%20Poulet')).json;
  const refs42 = src42?.menu?.items?.map((i) => i.ref) || [];
  check('GET menu?brand=Poulet Poulet → sharedFrom Po Poulet, the same items under its own name', fol42?.sharedFrom === 'Po Poulet' && fol42.menu?.brandName === 'Poulet Poulet' && refs42.length >= 2 && JSON.stringify(fol42.menu.items.map((i) => i.ref)) === JSON.stringify(refs42), JSON.stringify({ from: fol42?.sharedFrom }));
  const put42 = await call('PUT', '/api/foodhub/menu', { body: { menu: fol42?.menu } });
  check('saving a menu for the follower is refused (409): the shared menu is edited on Po Poulet', put42.status === 409, `${put42.status} ${put42.text.slice(0, 160)}`);
  const b42m = log.length;
  const pub42 = await call('POST', '/api/foodhub/menu/publish', { body: { brand: 'Poulet Poulet' } });
  const st42 = Object.fromEntries((pub42.json?.results || []).map((r) => [r.channelStoreId, r.result.status]));
  const pushes42 = log.slice(b42m).filter((e) => (e.method === 'PUT' && /^\/uber\/v2\/eats\/stores\/[^/]+\/menus$/.test(e.path)) || /^\/dd\/api\/v1\/menus/.test(e.path) || e.path === '/skip/menus');
  check('publishing the follower goes to its own stores only, under its own name', Object.keys(st42).sort().join(',') === 'dd-poulet-ndg,uber-poulet-ndg' && pushes42.length === 2 && pushes42.every((e) => e.path.includes('uber-poulet-ndg') || e.body?.store?.merchant_supplied_id === 'dd-poulet-ndg') && Object.values(pushes42.find((e) => e.path.includes('uber-poulet-ndg'))?.body?.menus?.[0]?.title?.translations || {}).some((t) => String(t).startsWith('Poulet Poulet')), JSON.stringify({ st42, pushes: pushes42.map((e) => e.path) }));
  const b42a = log.length;
  const av42 = await call('POST', '/api/foodhub/availability', { body: { brand: 'Poulet Poulet', locationCode: 'NDG_MAIN', itemRefs: ['clv-item-1'], available: false, minutes: 30 } });
  const rows42 = (av42.json?.results || []).filter((r) => r.channel !== 'tgtg');
  check('an 86 on the follower reaches the NDG stores of both brands', rows42.every((r) => r.result.ok) && ['uber-poulet-ndg', 'dd-poulet-ndg'].every((sid) => rows42.some((r) => r.channelStoreId === sid)) && rows42.some((r) => r.brandName === 'Po Poulet') && log.slice(b42a).some((e) => e.method === 'PUT' && e.path === '/dd/api/v1/stores/dd-poulet-ndg/items/status' && e.body?.[0]?.is_active === false), JSON.stringify(rows42.map((r) => [r.brandName, r.channelStoreId, r.result.status])));
  const offFor = async (brand) => ((await call('GET', `/api/foodhub/menu?brand=${encodeURIComponent(brand)}`)).json?.menu?.unavailableByLocation?.NDG_MAIN || []).includes('clv-item-1');
  check('the 86 is saved once, on the shared menu (both brands show it)', (await offFor('Po Poulet')) && (await offFor('Poulet Poulet')));
  await call('POST', '/api/foodhub/availability', { body: { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['clv-item-1'], available: true } });
  check('back on from Po Poulet → back on for both brands', !(await offFor('Poulet Poulet')) && !(await offFor('Po Poulet')));

  // c) Never a late kitchen ticket from an automatic run: past DoorDash's answer window the order waits for a person.
  const b42l = log.length;
  const late42 = await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: { ...ddOrder, id: 'dd-late-42', created_at: new Date(Date.now() - 10 * 60_000).toISOString() } });
  const inbLate = await waitFor(async () => ((await call('GET', '/api/foodhub/inbox')).json?.inbox?.entries || []).find((e) => e.reference === 'dd-late-42' && e.status === 'failed'));
  check('a DoorDash order received past its answer window is kept for a person: no order, nothing in Clover', late42.status === 202 && !inbLate?.nextAt && /answer window/.test(inbLate?.lastError || '') && !(await findOrder('dd-late-42')) && !log.slice(b42l).some(isAtomic), JSON.stringify(inbLate));
  const rpLate = await call('POST', '/api/foodhub/inbox', { body: { id: inbLate?.id } });
  check('…and a person can still replay it', rpLate.json?.entry?.status === 'done' && !!(await findOrder('dd-late-42')), JSON.stringify(rpLate.json?.entry));

  console.log('\n43. Expansion: own-order delivery (DoorDash Drive), website orders, AI phone line, grocery, alcohol');
  const exp0 = (await call('GET', '/api/foodhub/expansion')).json;
  check('every expansion feature starts OFF', exp0?.features?.length === 4 && exp0.features.every((f) => f.on === false), JSON.stringify(exp0?.features?.map((f) => [f.key, f.on])));
  check('Own orders hidden from the side menu while off', !(await call('GET', '/')).text.includes('href="/direct"'));
  check('website orders refused while own delivery is off', (await call('POST', '/api/foodhub/webhooks/website-order', { auth: false, headers: { authorization: 'Bearer web-order-e2e' }, body: { id: 'W-0' } })).status === 503);
  check('owner turns own delivery on', (await call('PUT', '/api/foodhub/expansion', { body: { key: 'delivery', on: true } })).json?.features?.find((f) => f.key === 'delivery')?.on === true);
  check('Own orders now in the side menu', (await call('GET', '/')).text.includes('href="/direct"'));
  const ndgLoc = (await call('GET', '/api/foodhub/catalog')).json?.locations?.find((l) => l.code === 'NDG_MAIN');
  await call('POST', '/api/foodhub/catalog', { body: { location: { ...ndgLoc, phone: '514 555-0100' } } });
  const rules = await call('PUT', '/api/foodhub/delivery/settings', { body: { settings: { compareQuotes: false, smsTracking: true, locations: { NDG_MAIN: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } } } });
  check('delivery rule saved for NDG', rules.json?.settings?.locations?.NDG_MAIN?.enabled === true, JSON.stringify(rules.json).slice(0, 200));
  const webOrder = { id: 'WEB-1001', brand: 'Po Poulet', location: 'NDG_MAIN', customer: { name: 'Ana Bel', phone: '514-555-1234' }, fulfillment: 'delivery', address: { street: '5555 Av Monkland', unit: '3', city: 'Montréal', postalCode: 'H4A 1E1', instructions: 'Code 1234' }, items: [{ name: 'Poulet Grillé', quantity: 2, price: 14.99 }], tip: 3, paid: true };
  check('website order refused with a wrong token', (await call('POST', '/api/foodhub/webhooks/website-order', { auth: false, headers: { authorization: 'Bearer nope' }, body: webOrder })).status === 401);
  const w1 = await call('POST', '/api/foodhub/webhooks/website-order', { auth: false, headers: { authorization: 'Bearer web-order-e2e' }, body: webOrder });
  check('website order received', w1.status === 200 && /^W-\d+$/.test(w1.json?.number || ''), JSON.stringify(w1.json));
  check('same website order again → no duplicate', (await call('POST', '/api/foodhub/webhooks/website-order', { auth: false, headers: { authorization: 'Bearer web-order-e2e' }, body: webOrder })).json?.duplicate === true);
  const webTicket = sent('POST', /\/atomic_order\/orders$/).find((e) => String(e.body?.orderCart?.title || '').includes(w1.json?.number));
  check('kitchen ticket in Clover with our number and the delivery address', Boolean(webTicket) && /LIVRAISON: 5555 Av Monkland/.test(webTicket.body.orderCart.note) && webTicket.body.orderCart.lineItems.length === 2, JSON.stringify(webTicket?.body?.orderCart).slice(0, 300));
  check('customer texted the confirmation', sent('POST', /\/Messages\.json$/).some((e) => /W-\d+ reçue/.test(((e) => new URLSearchParams(String(e.body)).get('Body') || '')(e))));
  const disp = await call('POST', `/api/foodhub/delivery/${w1.json?.id}`, { body: { action: 'dispatch' } });
  check('Call a courier → DoorDash Drive booked (sandbox)', disp.status === 200 && disp.json?.running?.fleet === 'doordash_drive' && disp.json.running.status === 'created' && disp.json.running.environment === 'sandbox', JSON.stringify(disp.json).slice(0, 300));
  const dq = sent('POST', /\/drive\/v2\/quotes$/)[0]?.body;
  check('Drive quote carries every required field (address, value, business name, tip, items, instructions)', dq?.pickup_business_name === 'Po Poulet' && dq.dropoff_phone_number === '+15145551234' && dq.pickup_phone_number === '+15145550100' && Number.isInteger(dq.order_value) && dq.order_value > 0 && dq.tip === 300 && dq.items?.[0]?.name === 'Poulet Grillé' && /5555 Av Monkland, #3, Montréal, QC H4A 1E1/.test(dq.dropoff_address) && /Code 1234/.test(dq.dropoff_instructions), JSON.stringify(dq));
  check('quote accepted by our delivery id', sent('POST', /\/drive\/v2\/quotes\/[^/]+\/accept$/).length === 1);
  const dId = disp.json?.running?.id;
  check('Drive webhook with a wrong token → 401', (await call('POST', '/api/foodhub/webhooks/doordash-drive', { auth: false, headers: { authorization: 'Basic nope' }, body: { event_name: 'DASHER_CONFIRMED', external_delivery_id: dId } })).status === 401);
  const smsBefore = sent('POST', /\/Messages\.json$/).length;
  check('Dasher assigned (webhook)', (await call('POST', '/api/foodhub/webhooks/doordash-drive', { auth: false, headers: { authorization: 'Basic drive-hook-e2e' }, body: { event_name: 'DASHER_CONFIRMED', external_delivery_id: dId, dasher_name: 'Léa' } })).status === 200);
  check('order shows the courier, and the tracking link is texted once', Boolean(await waitFor(async () => (await call('GET', `/api/foodhub/delivery/${w1.json?.id}`)).json?.running?.courier?.name === 'Léa')) && Boolean(await waitFor(async () => sent('POST', /\/Messages\.json$/).length === smsBefore + 1)));
  check('kitchen strip lists it', (await call('GET', '/api/foodhub/delivery/active?location=NDG_MAIN')).json?.items?.some((i) => i.number === w1.json?.number && i.delivery?.status === 'assigned'));
  await call('POST', '/api/foodhub/webhooks/doordash-drive', { auth: false, headers: { authorization: 'Basic drive-hook-e2e' }, body: { event_name: 'DASHER_DROPPED_OFF', external_delivery_id: dId } });
  check('delivered → order completed', Boolean(await waitFor(async () => (await call('GET', `/api/foodhub/delivery/${w1.json?.id}`)).json?.order?.status === 'completed')));
  const unpaid = await call('POST', '/api/foodhub/delivery', { body: { locationCode: 'NDG_MAIN', brandName: 'Po Poulet', customer: { name: 'Bo', phone: '5145559999' }, fulfillment: 'delivery', dropoff: { street: '1 Rue Test', city: 'Montréal', postalCode: 'H4A 1A1' }, items: [{ name: 'Frites', quantity: 1, price: 4.99 }] } });
  check('an unpaid delivery waits: couriers never collect money', unpaid.status === 200 && unpaid.json?.problems?.some((x) => /Not paid yet/.test(x)) && (await call('POST', `/api/foodhub/delivery/${unpaid.json?.order?.id}`, { body: { action: 'dispatch' } })).status === 409, JSON.stringify(unpaid.json?.problems));
  check('Payment taken → courier booked', (await call('POST', `/api/foodhub/delivery/${unpaid.json?.order?.id}`, { body: { action: 'mark_paid' } })).status === 200 && (await call('POST', `/api/foodhub/delivery/${unpaid.json?.order?.id}`, { body: { action: 'dispatch' } })).status === 200);
  check('cancelling the order cancels the courier first', (await call('POST', `/api/foodhub/delivery/${unpaid.json?.order?.id}`, { body: { action: 'cancel', reason: 'customer called' } })).json?.order?.status === 'cancelled' && sent('PUT', /\/drive\/v2\/deliveries\/[^/]+\/cancel$/).length === 1);

  // AI phone line — no ANTHROPIC_API_KEY in this run: the call must go straight to the kitchen phone (never lost).
  await call('PUT', '/api/foodhub/expansion', { body: { key: 'phone', on: true } });
  const pline = await call('PUT', '/api/foodhub/phone', { body: { settings: { lines: [{ number: '+15145550199', name: 'Po Poulet NDG', locationCode: 'NDG_MAIN', brands: ['Po Poulet'], enabled: true, delivery: true }] } } });
  check('phone line saved', pline.json?.settings?.lines?.length === 1, JSON.stringify(pline.json).slice(0, 200));
  const voiceForm = new URLSearchParams({ CallSid: 'CA-e2e-1', From: '+15145551234', To: '+15145550199', CallStatus: 'ringing' });
  const twSig = (u, f) => crypto.createHmac('sha1', 'tw-e2e').update(u + [...f.keys()].sort().map((k) => k + f.get(k)).join('')).digest('base64');
  const formHeaders = (sig) => ({ 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig });
  check('voice webhook refuses an unsigned call', (await call('POST', '/api/foodhub/webhooks/voice', { auth: false, raw: voiceForm.toString(), headers: formHeaders('bad') })).status === 403);
  const callRes = await call('POST', '/api/foodhub/webhooks/voice', { auth: false, raw: voiceForm.toString(), headers: formHeaders(twSig('https://takatak.example/api/foodhub/webhooks/voice', voiceForm)) });
  check('without an AI key the call is handed to the kitchen phone (TwiML Dial)', callRes.status === 200 && /<Dial callerId="\+15145550199"[^>]*>\+15145550100<\/Dial>/.test(callRes.text), callRes.text.slice(0, 300));
  check('call logged with its reason', (await call('GET', '/api/foodhub/phone/calls?id=CA-e2e-1')).json?.call?.handoffReason === 'ANTHROPIC_API_KEY not set');

  await call('PUT', '/api/foodhub/expansion', { body: { key: 'retail', on: true } });
  const prod = await call('POST', '/api/foodhub/retail', { body: { action: 'save', product: { name: 'Lait 2 %', sku: 'MILK-2L', barcodes: ['036000291452'], price: 5.49, stock: { NDG_MAIN: 12 }, category: 'Laitiers' } } });
  check('grocery product saved (barcode check digit verified)', prod.status === 200 && prod.json?.product?.barcodes?.[0] === '036000291452', JSON.stringify(prod.json).slice(0, 200));
  check('a wrong barcode is refused', (await call('POST', '/api/foodhub/retail', { body: { action: 'save', product: { name: 'X', sku: 'X1', barcodes: ['036000291453'], price: 1 } } })).status === 400);
  check('scanner lookup by barcode', (await call('GET', '/api/foodhub/retail?barcode=036000291452')).json?.product?.sku === 'MILK-2L');
  const rprev = (await call('GET', '/api/foodhub/retail?preview=NDG_MAIN')).json?.preview;
  check('DoorDash / Uber grocery payloads built, marked "needs platform approval", nothing sent', rprev?.doordash_retail?.readiness?.status === 'needs_platform_approval' && rprev?.uber_eats_grocery?.items?.[0]?.product_info?.gtin === '00036000291452' && !log.some((e) => JSON.stringify(e.body ?? '').includes('MILK-2L')), JSON.stringify(rprev?.uber_eats_grocery?.items?.[0]?.product_info));

  await call('PUT', '/api/foodhub/expansion', { body: { key: 'alcohol', on: true } });
  const alc = (await call('GET', '/api/foodhub/alcohol')).json;
  check('alcohol closed on every channel until a permit is checked', alc?.now?.length > 0 && alc.now.every((l) => Object.values(l.channels).every((c) => c.allowed === false)));
  check('opening a channel without a checked permit is refused', String((await call('PUT', '/api/foodhub/alcohol', { body: { locationCode: 'NDG_MAIN', patch: { permitType: 'restaurant', channels: { phone: true } } } })).json?.warning || '').includes('stay closed'));
  for (const k of ['delivery', 'phone', 'retail', 'alcohol']) await call('PUT', '/api/foodhub/expansion', { body: { key: k, on: false } });

  console.log('\n44. Website orders through Clover Online Ordering — Clover keeps control, the kitchen screen mirrors them');
  // The customer orders on the restaurant's Clover online-ordering page (its website's "Order online" button): Clover
  // creates, charges and prints the order by itself, with its "Online Order Pick Up" type. Own delivery stays OFF here.
  const olp = cloverOrderTypes.find((t) => t.label === 'Online Order Pick Up');
  const webNative = (id, extra = {}) => ({
    mid: 'MAINMERCHANT', id, createdTime: Date.now() - 30_000, title: '', total: 2299, currency: 'CAD', state: 'locked', paymentState: 'PAID', orderType: { id: olp?.id },
    lineItems: { elements: [{ id: `${id}-L1`, name: 'Pizza Pepperoni', price: 1599, item: { id: 'clv-item-1' }, printed: true, modifications: { elements: [{ name: 'Extra fromage', amount: 200 }] } }, { id: `${id}-L2`, name: 'Coke', price: 300, printed: true }] },
    payments: { elements: [{ id: `${id}-P`, amount: 2299, taxAmount: 300, tipAmount: 0, result: 'SUCCESS', tender: { id: 'T-CARD-OLO', label: 'Credit Card' } }] },
    customers: { elements: [{ firstName: 'Léa', lastName: 'Tremblay' }] },
    ...extra,
  });
  cloverNativeOrders.push(webNative('OLO-WEB-1'), webNative('OLO-DINE-1', { orderType: { id: 'OT-DINE' } }));
  const injects44 = sent('POST', /\/atomic_order\/orders$/).length;
  const prints44 = sent('POST', /\/print_event$/).length;
  const sy44 = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  const main44 = sy44.json?.report?.clover?.find((c) => c.merchantId === 'MAINMERCHANT');
  check('sync reads the website order Clover Online Ordering took (and only that one)', main44?.websiteOrders === 1 && !main44.websiteOrdersError, JSON.stringify(main44));
  const webList = async () => (await call('GET', '/api/foodhub/website-orders?locations=NDG_6284')).json?.orders ?? [];
  const w44 = (await webList()).find((o) => o.posOrderId === 'OLO-WEB-1');
  check('kitchen screen: "Website / Clover Online", accepted in Clover, printed by Clover, in the pinned kitchen', w44?.source === 'clover_online' && w44.status === 'in_kitchen' && !!w44.posPrintedAt && w44.locationCode === 'NDG_6284' && w44.brandName === 'PPP Pizzeria' && w44.customer?.name === 'Léa T.' && w44.total === 22.99 && /^WEB-\d+$/.test(w44.number), JSON.stringify(w44));
  check('no second ticket: Food Hub created nothing in Clover and printed nothing', sent('POST', /\/atomic_order\/orders$/).length === injects44 && sent('POST', /\/print_event$/).length === prints44);
  check('an in-store order of the same Clover is not a website order', !(await webList()).some((o) => o.posOrderId === 'OLO-DINE-1'));
  check('not a platform order (order board and payout checks untouched)', !(await call('GET', '/api/foodhub/orders?limit=500')).json.orders.some((o) => o.posOrderId === 'OLO-WEB-1'));
  const blocked44 = await call('POST', `/api/foodhub/website-orders/${w44?.id}`, { body: { action: 'cancel' } });
  check('cancel from Food Hub refused: "do it in Clover"', blocked44.status === 409 && /Clover/.test(blocked44.json?.error || ''), JSON.stringify(blocked44.json));
  check('the own-orders API refuses it too (no resend, no courier, no refund)', (await call('POST', `/api/foodhub/delivery/${w44?.id}`, { body: { action: 'retry_clover' } })).status === 409 && (await call('POST', `/api/foodhub/delivery/${w44?.id}`, { body: { action: 'dispatch' } })).status === 409);

  // Clover Orders webhook (O:<orderId>): the next website order is on the screen at once, without waiting for a sync.
  const orderHook = (id, type, auth = 'clover-auth-e2e') => call('POST', '/api/foodhub/webhooks/clover', { auth: false, headers: auth ? { 'x-clover-auth': auth } : {}, body: { appId: 'APP', merchants: { MAINMERCHANT: [{ objectId: `O:${id}`, type, ts: Date.now() }] } } });
  cloverNativeOrders.push(webNative('OLO-WEB-2', { createdTime: Date.now() - 2000 }));
  check('Clover Orders event refused without X-Clover-Auth', (await orderHook('OLO-WEB-2', 'CREATE', null)).status === 401);
  check('Clover Orders event (CREATE) accepted', (await orderHook('OLO-WEB-2', 'CREATE')).status === 200);
  const w44b = await waitFor(async () => (await webList()).find((o) => o.posOrderId === 'OLO-WEB-2'));
  check('…and the website order is on the kitchen screen right away', w44b?.status === 'in_kitchen', JSON.stringify(w44b));
  const r44 = await call('POST', `/api/foodhub/website-orders/${w44b?.id}`, { body: { action: 'ready' } });
  check('"Ready" on the kitchen screen is local: nothing written to Clover', r44.json?.order?.status === 'ready' && !log.some((e) => e.method !== 'GET' && /OLO-/.test(e.path)), JSON.stringify(r44.json));

  // The brand's own website (pppmtl.com) takes the payment with Clover Hosted Checkout: that order has no online
  // order type; once paid, the site titles it "🌐 Site web · …" in Clover and prints it once itself.
  const prints44c = sent('POST', /\/print_event$/).length;
  cloverNativeOrders.push(webNative('HCO-WEB-1', {
    createdTime: Date.now() - 2000, orderType: undefined, customers: undefined,
    title: '🌐 Site web · PPP-AB12C · Marie', note: 'SITE WEB pppmtl.com | POUR EMPORTER / PICKUP | PAYÉ EN LIGNE / PAID ONLINE (Clover)',
  }));
  check('Clover Orders event for a website order paid with Clover Hosted Checkout accepted', (await orderHook('HCO-WEB-1', 'UPDATE')).status === 200);
  const w44c = await waitFor(async () => (await webList()).find((o) => o.posOrderId === 'HCO-WEB-1'));
  check('…recognised by its "Site web" title: on the kitchen screen, paid, named, and Food Hub prints nothing', w44c?.source === 'clover_online' && w44c.status === 'in_kitchen' && w44c.payment === 'paid' && w44c.customer?.name === 'Marie' && sent('POST', /\/print_event$/).length === prints44c, JSON.stringify(w44c));

  // Refunded in Clover → cancelled here too, at the next Orders event.
  cloverNativeOrders.find((o) => o.id === 'OLO-WEB-1').paymentState = 'REFUNDED';
  check('Clover Orders event (UPDATE) accepted', (await orderHook('OLO-WEB-1', 'UPDATE')).status === 200);
  const gone44 = await waitFor(async () => !(await webList()).some((o) => o.posOrderId === 'OLO-WEB-1'));
  check('refunded in Clover → cancelled on the kitchen screen (Clover is the source of truth)', !!gone44 && (await call('GET', `/api/foodhub/website-orders/${w44?.id}`)).json?.order?.status === 'cancelled');
  const sy44b = await call('POST', '/api/foodhub/sync', { body: { force: true } });
  check('the poller meets the webhook\'s orders: never shown twice', sy44b.json?.report?.clover?.find((c) => c.merchantId === 'MAINMERCHANT')?.websiteOrders === 0 && (await webList()).filter((o) => o.posOrderId === 'OLO-WEB-2').length === 1);

  await sleep(300);
  // A webhook "kept in the inbox" (section 41: Uber refusing the order fetch on purpose) is handled, not a crash.
  const crashes = appLog.split('\n').filter((l) => /\[foodhub\] .* failed|Unhandled|TypeError|ReferenceError/.test(l) && !/kept in the inbox/.test(l));
  check('no background job crashed during the whole run', crashes.length === 0, crashes.slice(0, 3).join(' | '));
} finally {
  if (!DEMO || failed) {
    app.kill('SIGTERM');
    mock.close();
  }
}

if (DEMO && !failed) {
  console.log(`\nDemo running with simulated platforms: http://localhost:${APP_PORT}/`);
  console.log(`Sign in with "Owner recovery sign-in": user "owner", password "${PASSWORD}". A new simulated order arrives every 40 s. Ctrl+C to stop.`);
  uberStatus.set('uber-store-uuid-1', { status: 'ONLINE' });
  let n = 100;
  const tick = async () => {
    n += 1;
    try {
      if (n % 3 === 0) await uberWebhook(`uber-demo-${n}`);
      else if (n % 3 === 1) await skipWebhook('orders', skipOrder(`skip-demo-${String(n).padStart(4, '0')}`, n % 2 ? 'NDG-POPOULET' : 'HOCH-POPOULET', `tx-demo-${n}`));
      else await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: { id: `dd-demo-${n}`, store: { merchant_supplied_id: 'dd-popoulet-ndg' }, subtotal: 2299, tax: 345, categories: [{ name: 'Plats', items: [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }, { name: 'Frites', quantity: 1, price: 499, merchant_supplied_id: 'clv-item-2', extras: [] }] }] } });
    } catch { /* demo only */ }
  };
  const timer = setInterval(tick, 40_000);
  const stop = () => { clearInterval(timer); app.kill('SIGTERM'); mock.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\n--- app log ---\n' + appLog.slice(-4000)); process.exit(1); }
