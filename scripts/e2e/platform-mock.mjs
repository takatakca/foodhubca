// TAKATAK Food Hub — simulated platforms for the end-to-end checks: Uber Eats, DoorDash (+ Drive), SkipTheDishes
// (JET Connect), Clover, Resend, Twilio, the team chat, the Order Relay partner and the Takatak MEV stand-in, plus the
// small HTTP helpers the checks use. Shared by `npm run verify:foodhub` (scripts/foodhub-e2e.mjs) and
// `npm run verify:crash` (scripts/foodhub-crash-e2e.mjs). Moved here unchanged from foodhub-e2e.mjs; the three values
// a check flips on purpose (Clover down, Uber refusing order fetches, the Uber report CSV) live on `mockState`.
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockQcmev } from './mock-qcmev.mjs';

// Ports can be moved (FOODHUB_E2E_MOCK_PORT / FOODHUB_E2E_APP_PORT) so two checkouts can verify at the same time.
export const MOCK_PORT = Number(process.env.FOODHUB_E2E_MOCK_PORT) || 4799;
export const APP_PORT = Number(process.env.FOODHUB_E2E_APP_PORT) || 4800;
export const APP = `http://127.0.0.1:${APP_PORT}`;
export const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
export const PASSWORD = 'e2e-dashboard-pass';
export const SCREENS_TOKEN = 'screens-agent-e2e-token-0123456789';
export const UBER_SECRET = 'uber-client-secret-e2e';
export const DD_SECRET_B64 = Buffer.from('doordash-signing-secret-e2e-32bytes!').toString('base64');
export const DRIVE_SECRET_B64 = Buffer.from('doordash-drive-secret-e2e-32bytes!!').toString('base64');
export const JET_API_KEY = 'jet-api-key-e2e';
export const SKIP_HMAC = 'skip-hmac-secret-e2e';
export const SKIP_NOTIFY_KEY = 'skip-notify-key-e2e';
export const CLOVER_TOKEN = 'clover-token-e2e';
export const CLOVER_APP_TOKEN = 'clover-app-token-e2e';
export const RELAY_SECRET = 'relay-secret-e2e-0123456789abcdef';
export const RELAY_CB_TOKEN = 'relay-callback-token-e2e';
// Takatak MEV (QCMEV) stand-in, mounted under /qcmev on the mock server (scripts/e2e/mock-qcmev.mjs). Throwaway key.
export const MEV_SECRET = crypto.randomBytes(32).toString('hex');
export const mevMock = createMockQcmev({ secret: MEV_SECRET, tenant: 'takatak', locations: ['E2E_MEV'] });

export const log = [];
let cloverSeq = 0;
let twilioSeq = 0;

// ---------------- mock platform state ----------------
export const uberStatus = new Map();   // store id → { status, offlineReason }
export const ddDetails = new Map();    // msid → store_details body
export const knownUberStores = new Set(['uber-store-uuid-1', 'uber-store-stl']);
export const uberPosData = new Map();  // store id → this app's pos_data (after POST /pos_data)
export const uberCreated = new Map();  // store id → orders waiting for an accept (GET created-orders)
export const cloverPayments = [
  { id: 'p1', amount: 2500, tipAmount: 300, taxAmount: 326, result: 'SUCCESS', order: { id: 'INSTORE-1' } },
  { id: 'p2', amount: 1200, tipAmount: 0, taxAmount: 156, result: 'SUCCESS', order: { id: 'INSTORE-2' } },
  { id: 'p3', amount: 999, result: 'FAIL', order: { id: 'INSTORE-3' } },
  { id: 'p4', amount: 3907, result: 'SUCCESS', order: { id: 'CLV1' } }, // a delivery order Food Hub injected → must not be counted
];
const cloverRefunds = [{ id: 'r1', amount: 200, payment: { order: { id: 'INSTORE-2' } } }];
export const cloverTenders = [{ id: 'T-CASH', label: 'Cash' }];
export const cloverOrderTypes = [{ id: 'OT-DINE', label: 'Dine In' }];
export const cloverOrderTotals = new Map(); // Clover order id → total (cents)
const cloverAtomicTitles = new Map(); // Clover order id → title Food Hub gave it
/** Values a check changes on purpose (an importer cannot reassign an imported binding, so they live on one object). */
export const mockState = {
  cloverAtomicMode: 'ok', // 'down' = Clover answers 503 to new orders (automatic retry checks)
  uberFetchFails: 0, // Uber order fetches to refuse for "uber-flaky-…" orders
  uberReportCsv: '',
};
// The merchant's Clover menus (Clover → Items → Menus): the DoorDash menu holds the items sold on DoorDash, at Clover × 1.20.
const cloverMenus = [{ id: 'MENU-POS', name: 'Default POS Menu', type: 'DEFAULT_POS_MENU' }, { id: 'MENU-DD', name: 'DoorDash (Po Poulet +20%)', type: 'OLO_MENU', channel: 'DoorDash' }];
const cloverMenuRows = { 'MENU-DD': [{ item: { id: 'clv-item-1' }, price: 1919 }, { item: { id: 'clv-item-2' }, price: 599 }, { item: { id: 'clv-item-4' }, price: 325, image_filename: 'clv-item-4.jpeg' }] };
let cloverObjSeq = 0;
export const cloverNativeOrders = []; // orders created in Clover by Clover itself (its DoorDash integration, Clover Online Ordering)
const cloverTags = [{ id: 'TAG-K', name: 'Cuisine', printers: { elements: [{ id: 'PR-1' }] } }, { id: 'TAG-B', name: 'Bar', printers: { elements: [] } }];
export const cloverTagLinks = []; // { item, tag }
export const cloverItems = [
  { id: 'clv-item-1', name: 'Poulet Grillé', price: 1499, available: true, categories: { elements: [{ id: 'clv-cat-1', name: 'Plats', sortOrder: 1 }] }, modifierGroups: { elements: [{ id: 'grp-1' }] } },
  { id: 'clv-item-2', name: 'Frites', price: 499, available: true, categories: { elements: [{ id: 'clv-cat-2', name: 'Accompagnements', sortOrder: 2 }] }, modifierGroups: { elements: [] } },
  { id: 'clv-item-3', name: 'Hidden staff meal', price: 0, hidden: true },
];

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

export const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  const url = new URL(req.url, MOCK);
  const entry = { method: req.method, path: url.pathname, query: url.search, headers: req.headers, body };
  log.push(entry);
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)); };
  const p = url.pathname;

  // ---- Takatak MEV (QCMEV) integration API stand-in ----
  if (p.startsWith('/qcmev/')) {
    const hdr = {};
    for (const [k, v] of Object.entries(req.headers)) hdr[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v);
    const r = mevMock.handle(req.method, p.slice('/qcmev'.length), hdr, raw);
    return send(r.status, r.json);
  }
  // ---- Uber Reporting API download link (signed S3-style URL in real life) ----
  if (p === '/reports/uber-payment.csv') { res.writeHead(200, { 'content-type': 'text/csv' }); return res.end(mockState.uberReportCsv); }
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
    // "uber-flaky-…" orders: Uber refuses the fetch while mockState.uberFetchFails > 0 (webhook inbox retry checks).
    if (order && order[1].startsWith('uber-flaky') && mockState.uberFetchFails > 0) { mockState.uberFetchFails -= 1; return send(503, { message: 'temporarily unavailable' }); }
    if (order) return send(200, UBER_ORDER(order[1], order[1].includes('stl') ? 'uber-store-stl' : order[1].includes('mev') ? 'uber-store-mev' : 'uber-store-uuid-1', order[1].includes('sched') ? 60.4 : 15));
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
      if (mockState.cloverAtomicMode === 'down') { cloverOrderTotals.delete(`CLV${cloverSeq}`); return send(503, { message: 'Service Unavailable' }); }
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
export const basic = `Basic ${Buffer.from(`owner:${PASSWORD}`).toString('base64')}`;
export async function call(method, path, { body, headers = {}, auth = true, raw, redirect, cookie } = {}) {
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
export const TZ = 'America/Toronto';
export const localDay = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * 86400_000));
export const localHour = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
export const sent = (method, pathRe) => log.filter((e) => e.method === method && pathRe.test(e.path));
/** Same rule as lib/foodhub/deadline.ts: the platform's clock starts at placedAt when it is plausible. */
export function expectedDeadlineMs(o, minutes) {
  const created = new Date(o.createdAt).getTime();
  const placed = o.placedAt ? Date.parse(o.placedAt) : NaN;
  const start = Number.isFinite(placed) && placed <= created && created - placed <= 30 * 60_000 ? placed : created;
  return start + minutes * 60_000;
}
export async function findOrder(externalId) {
  const r = await call('GET', '/api/foodhub/orders?limit=500');
  return (r.json?.orders || []).find((o) => o.externalOrderId === externalId);
}
export function jetHash(raw, secret = SKIP_HMAC) {
  return `HMAC-SHA256 t=${Date.now()},signature=${crypto.createHmac('sha256', secret).update(raw).digest('base64')}`;
}
export async function skipWebhook(path, payload, { hmac = true, key } = {}) {
  const raw = JSON.stringify(payload);
  const headers = hmac ? { 'x-jet-connect-hash': jetHash(raw) } : { authorization: key ?? SKIP_NOTIFY_KEY };
  return call('POST', `/api/foodhub/webhooks/skip/${path}`, { auth: false, raw, headers });
}
export const skipOrder = (id, posLocationId, tx) => ({
  id, transmission_id: tx, third_party_order_reference: `SK${id.slice(-4)}`, type: 'delivery-by-delivery-partner', posLocationId,
  items: [
    { name: 'Poulet Grillé', plu: 'clv-item-1', price: 1549, quantity: 1, notes: '', children: [{ name: 'Piri-piri', plu: 'mod-1', price: 100 }] },
    { name: 'Frites', plu: 'clv-item-2', price: 499, quantity: 2, children: [] },
  ],
  created_at: String(Math.floor(Date.now() / 1000)), collect_at: String(Math.floor(Date.now() / 1000) + 1200), kitchen_notes: 'Allergie arachides',
  payment: { items_in_cart: { inc_tax: 2647, tax: 345 }, final: { inc_tax: 2647, tax: 345 } }, delivery: { first_name: '****' }, total: 2647,
});
export function uberSigned(raw) {
  return call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } });
}
export async function uberWebhook(orderId) {
  const raw = JSON.stringify({ event_type: 'orders.notification', event_id: `evt-${orderId}`, meta: { resource_id: orderId, status: 'pos', user_id: 'uber-store-uuid-1' }, resource_href: `${MOCK}/uber/v2/eats/order/${orderId}` });
  return call('POST', '/api/foodhub/webhooks/uber-eats', { auth: false, raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } });
}
// Food Hub Order Relay: the partner posts to ?token=<FOODHUB_RELAY_SECRET> (UrbanPiper-compatible "Order Relay" shapes).
export const relayHook = (body, token = RELAY_SECRET) => call('POST', `/api/foodhub/webhooks/relay${token ? `?token=${encodeURIComponent(token)}` : ''}`, { auth: false, body });
export const relayOrder = (id, channel = 'Too Good To Go', storeRef = 'tgtg-partner-77') => ({
  customer: { name: 'Julie T.', phone: '5145550123' },
  order: {
    details: { id, channel, created: Date.now() - 30_000, order_type: 'pickup', order_subtotal: 11.98, total_taxes: 0, total_charges: 0, discount: 0, order_total: 11.98,
      instructions: 'Sac réutilisable', brand: { name: 'Po Poulet' }, ext_platforms: [{ id: `TGTG-${id}`, kind: 'food_aggregator', name: channel }] },
    items: [{ id: 1, title: 'Panier surprise', price: 5.99, quantity: 2, total: 11.98 }],
    store: { id: 77, merchant_ref_id: storeRef, name: 'TGTG NDG' },
  },
});
export const relayStatus = (id, state, message) => ({ order_id: id, new_state: state, ...(message ? { message } : {}), additional_info: { external_channel: { name: 'Too Good To Go', order_id: `TGTG-${id}` } } });

/** The environment the real app runs with against the simulated platforms (memory mode; verify:crash swaps in a database). */
export function appEnv() {
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
    TGTG_EMAIL_WEBHOOK_SECRET: 'tgtg-mail-e2e',
    SKIP_ONBOARDING_HMAC_SECRET: 'skip-onboard-e2e', DELIVERECT_WEBHOOK_SECRET: 'dlv-hook-e2e', DELIVERECT_TGTG_CHANNEL_IDS: '777',
    FOODHUB_SCREENS_AGENT_TOKEN: SCREENS_TOKEN,
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
    // Takatak MEV: configured for the whole run, but the owner switch stays OFF until section 48 (zero calls before it).
    FOODHUB_MEV: 'simulator', FOODHUB_MEV_URL: `${MOCK}/qcmev`, FOODHUB_MEV_SECRET: MEV_SECRET, FOODHUB_MEV_LOCATIONS: 'E2E_MEV',
    FOODHUB_MEV_RETRY_S: '1,2', FOODHUB_MEV_OFFLINE_POLL_S: '1',
  };
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UBER_ACCESS_TOKEN', 'TGTG_SPEC_CONFIRMED', 'SESSION_SECRET', 'FOODHUB_CLOVER_AUTOPRINT', 'CLOVER_PRINT_DEVICE_ID', 'FOODHUB_SYNC_MIN_INTERVAL_S', 'FOODHUB_CLOVER_RECORD_PAYMENT', 'FOODHUB_CLOVER_ORDER_TYPES', 'FOODHUB_CLOVER_INVENTORY_SYNC', 'FOODHUB_CLOVER_DELETE_CANCELLED', 'FOODHUB_SCHEDULED_AFTER_MIN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'FOODHUB_INSECURE_SHOW_CODES', 'TWILIO_MESSAGING_SERVICE_SID', 'FOODHUB_OWNER_EMAIL', 'FOODHUB_OWNER_PHONE', 'FOODHUB_FEATURE_DELIVERY', 'FOODHUB_FEATURE_RETAIL', 'FOODHUB_FEATURE_ALCOHOL', 'FOODHUB_FEATURE_PHONE', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_ORDER_TYPES', 'FOODHUB_CLOVER_WEBSITE_POLL_S', 'FOODHUB_CLOVER_WEBSITE_CLOSE_MIN', 'FOODHUB_PUBLIC_HOME', 'FOODHUB_APP_MARKET_URL', 'FOODHUB_APP_MARKET_STATUS', 'FOODHUB_PUBLIC_LIVE_PLATFORMS', 'FOODHUB_PUBLIC_SAME_AS', 'NEXT_PUBLIC_CLOVER_APPS_LIVE', 'FOODHUB_FEATURE_MEV', 'FOODHUB_MEV_TRIGGER', 'FOODHUB_MEV_CLOVER_NOTE', 'FOODHUB_MEV_SEND_RECEIPT', 'FOODHUB_MEV_USER', 'FOODHUB_MEV_TIMEOUT_MS', 'FOODHUB_TENANT_ID']) delete env[k];
  return env;
}
