// A stand-in for Takatak MEV (QCMEV) — the foodhub.sale.v1 integration API only — for Food Hub's own tests:
// npm test (tests/mev-outbox.test.ts) and npm run verify:foodhub (scripts/e2e/mev-scenarios.mjs). No network, no
// Revenu Québec: it checks the signature and the contract the way QCMEV does, numbers per device and civil day, signs
// with a throwaway ECDSA P-256 key (88-character signatures chained by signa.preced) and renders a receipt.
// Placeholder data only. QR links point to a local host, never to a Revenu Québec or MEV-WEB domain.
import crypto from 'node:crypto';

const PREFIX = '/api/v1/integrations/foodhub';
const KEY_PART = /^[A-Za-z0-9._:#-]{1,160}$/;

export function canonicalJson(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = (body) => { const { payloadHash: _x, ...rest } = body; void _x; return sha256(canonicalJson(rest)); };
const lineCents = (unit, q) => { const n = unit * Math.round(Number(q) * 1000); const s = n < 0 ? -1 : 1; return s * Math.floor((2 * Math.abs(n) + 1000) / 2000); };

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function createMockQcmev({ secret, tenant = 'takatak', locations = null, environment = 'SIMULATOR', certified = false } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const state = {
    environment, certified, down: false, mevDown: false, unauthorized: false,
    calls: [], events: new Map(), keys: new Map(), seq: new Map(), chain: [], transactions: [],
  };
  const allowed = (loc) => !locations || locations.includes(loc);

  function verify(h, raw) {
    const ts = h['x-timestamp'] || ''; const id = h['x-event-id'] || ''; const sig = String(h['x-signature'] || '').replace(/^sha256=/, '');
    if (h['x-integration-id'] !== 'foodhub' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(h['x-tenant-id'] || '') || !id || !/^[a-f0-9]{64}$/.test(sig)) return false;
    const ms = /^\d{9,11}$/.test(ts) ? Number(ts) * 1000 : /^\d{12,14}$/.test(ts) ? Number(ts) : NaN;
    if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 5 * 60_000) return false;
    const want = Buffer.from(crypto.createHmac('sha256', secret).update(`${ts}.${id}.${raw}`).digest('hex'), 'hex');
    const got = Buffer.from(sig, 'hex');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  /** Civil date + local time from the ISO offset Food Hub sends (the device's day in Montréal). */
  function civil(occurredAt) {
    const m = String(occurredAt).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)$/);
    if (!m) return null;
    return { day: `${m[1]}${m[2]}${m[3]}`, datTrans: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`, utc: m[7] === 'Z' ? '+00:00' : m[7] };
  }

  /** Now in Montréal civil time with its offset: QCMEV dates a credit note or a copy when it issues it (CONTRACT.md §7). */
  function montrealNow() {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const off = Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    const sign = off < 0 ? '-' : '+';
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm = String(Math.abs(off) % 60).padStart(2, '0');
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
  }
  /** datTrans (AAAAMMJJhhmmss) as QCMEV prints it: AAAA-MM-JJ hh:mm:ss */
  const shown = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}`;

  function sign(t) {
    const preced = state.chain.length ? state.chain[state.chain.length - 1].actu : '='.repeat(88);
    const data = [t.noTrans, t.datTrans, t.gstCents, t.qstCents, t.totalCents, t.modImpr, t.modTrans, preced].join('|');
    const actu = crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    state.chain.push({ actu, preced, data, key: t.key });
    return { actu, preced };
  }

  function issue({ key, kind, saleKey, locationId, occurredAt, amounts, typServ, mentions, lines, modImpr, modTrans, original, ref = null, format = 'PAP', footer = [] }) {
    const c = civil(occurredAt) || civil(new Date().toISOString());
    const dev = `DEV-${locationId}`;
    const n = (state.seq.get(`${dev}:${c.day}`) || 0) + 1;
    state.seq.set(`${dev}:${c.day}`, n);
    // As QCMEV today (CONTRACT.md §7): "1", "2", "3"… per device and civil day, an opaque string; never parse it.
    const noTrans = String(n);
    const id = `tx_${String(state.transactions.length + 1).padStart(6, '0')}`;
    const t = { id, key, kind, saleKey, locationId, deviceId: dev, noTrans, datTrans: c.datTrans, utc: c.utc, ...amounts, typServ, modImpr, modTrans, mentions, footer, format, lines, original, ref, mevStatus: state.mevDown ? 'OFFLINE_PENDING' : 'ACCEPTED', mevNumber: null };
    if (!state.mevDown) t.mevNumber = psiNoTrans();
    t.signa = sign(t);
    state.transactions.push(t);
    return t;
  }

  /** MEV-WEB's number as QCMEV's simulator gives it (SIM + 9 digits): opaque, passed through as received. */
  let mevSeq = 0;
  const psiNoTrans = () => `SIM${String(++mevSeq).padStart(9, '0')}`;

  function flush() {
    if (state.mevDown) return;
    for (const t of state.transactions) if (t.mevStatus === 'OFFLINE_PENDING') { t.mevStatus = 'ACCEPTED'; t.mevNumber = psiNoTrans(); }
  }

  // The same layout as QCMEV's renderer (SW-76 §4.4.1): items and subtotal, then "=", TPS, TVQ, TOTAL, tip, mentions,
  // [CODE QR], (electronic: the link), processing time, MEV-WEB number, device id, "=", footer mentions. Offline: the
  // processing time and the MEV-WEB number read « PROBLÈME DE COMMUNICATION ».
  function render(t) {
    const money = (c) => `${(c / 100).toFixed(2).replace('.', ',')} $`;
    const qr = `http://127.0.0.1/mev-sim/qr?f=e1.${encodeURIComponent(Buffer.from(t.noTrans).toString('base64url'))}`;
    const off = t.mevStatus === 'OFFLINE_PENDING';
    const doc = (electronic) => [
      'RESTAURANT D’ESSAI (SIMULATEUR)', '-'.repeat(42), `Date : ${shown(t.datTrans)} (${t.utc})`, `Transaction : ${t.noTrans}`,
      // The reference to the original is a TEXT LINE before the items, never a mention (CONTRACT.md §7)
      ...(t.ref ? [`Réf. : transaction ${t.ref.noTrans}`, `du ${shown(t.ref.datTrans)}`] : []), '-'.repeat(42),
      ...t.lines.map((l) => `${l.quantity} x ${l.description}`.slice(0, 30).padEnd(31) + money(l.totalCents).padStart(11)),
      '-'.repeat(42), `Sous-total ${money(t.subtotalCents)}`, 'No TPS : 000000000RT0001', 'No TVQ : 0000000000TQ0001',
      ...(t.kind === 'credit_note' ? ['Crédité à : ______________________________', 'Date de la remise : ______________________'] : []),
      '='.repeat(42), `TPS 5 % : ${money(t.gstCents)}`, `TVQ 9,975 % : ${money(t.qstCents)}`, `TOTAL : ${money(t.totalCents)}`,
      ...(t.tipCents ? [`Pourboire : ${money(t.tipCents)}`] : []),
      ...t.mentions, '[CODE QR]', ...(electronic ? ['Consulter la transaction en ligne'] : []),
      off ? 'PROBLÈME DE COMMUNICATION' : new Date().toISOString().slice(0, 19).replace('T', ' '), off ? 'PROBLÈME DE COMMUNICATION' : t.mevNumber, t.deviceId,
      '='.repeat(42), ...t.footer, ...(electronic && t.format === 'PEL' ? ['Copie électronique'] : []),
    ];
    const text80mm = doc(t.format === 'ELE');
    const electronic = t.format === 'ELE' || t.format === 'PEL' ? { mentions: [...t.mentions, ...t.footer, ...(t.format === 'PEL' ? ['Copie électronique'] : [])], lines: doc(true), html: '' } : null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><path d="M1 1h7v7H1zM13 1h7v7h-7zM1 13h7v7H1z" fill="#000"/></svg>`;
    return {
      qcmevTransactionId: t.id, noTrans: t.noTrans, datTrans: t.datTrans, utc: t.utc, deviceId: t.deviceId, mevStatus: t.mevStatus,
      mevProcessedAt: t.mevStatus === 'ACCEPTED' ? new Date().toISOString() : null, mevTransactionNumber: t.mevNumber, issuedAt: new Date().toISOString(),
      mentions: [...t.mentions, ...(off ? ['PROBLÈME DE COMMUNICATION'] : []), ...t.footer], text80mm, html: '', electronic, qr: { content: qr, svg, pngDataUrl: TINY_PNG }, renderHash: sha256(text80mm.join('\n')),
    };
  }

  const answer = (t) => ({ status: t.mevStatus === 'ACCEPTED' ? 'accepted' : 'offline_pending', kind: t.kind, key: t.key, saleKey: t.saleKey, warnings: [], errors: [],
    amounts: { subtotalCents: t.subtotalCents, gstCents: t.gstCents, qstCents: t.qstCents, totalCents: t.totalCents, tipCents: t.tipCents || 0 }, receipt: render(t) });

  function checkSale(b) {
    const e = [];
    if (b?.schema !== 'foodhub.sale.v1') e.push('schema');
    if (b?.tenantId !== tenant) e.push('tenantId');
    if (!KEY_PART.test(b?.saleKey || '') || !String(b?.saleKey).startsWith(`fh:${tenant}:`)) e.push('saleKey');
    if (!civil(b?.occurredAt)) e.push('occurredAt');
    if (!['LVT', 'LVR', 'CMP', 'TBL'].includes(b?.serviceType)) e.push('serviceType');
    let items = 0;
    for (const l of b?.lines || []) {
      if (!(Number(l.quantity) > 0) || !(l.unitPriceCents >= 0) || !(l.totalCents >= 0) || Math.abs(lineCents(l.unitPriceCents, l.quantity) - l.totalCents) > 1) e.push(`line ${l.description}`);
      items += l.totalCents;
      for (const m of l.modifiers || []) { if (!(m.totalCents >= 0)) e.push('modifier'); items += m.totalCents; }
    }
    if (!(b?.lines || []).length) e.push('lines');
    const sub = items + (b?.serviceType === 'LVR' ? b?.fees?.deliveryCents || 0 : 0) + (b?.fees?.serviceFeeCents || 0) - (b?.discountCents || 0);
    const a = b?.amounts || {};
    if (sub !== a.subtotalCents) e.push(`amounts.subtotalCents ${sub}`);
    if (a.totalCents !== a.subtotalCents + a.gstCents + a.qstCents) e.push('amounts.totalCents');
    if (!['ARG', 'CHQ', 'CRE', 'DEB', 'CPR', 'MIX', 'AUT', 'INC', 'AUC'].includes(b?.payment?.mode)) e.push('payment.mode');
    if (b?.payloadHash !== hashOf(b || {})) e.push('payloadHash');
    return e;
  }

  /** Same idempotency as QCMEV: same key + same hash → the stored answer; another hash → 409. */
  function once(key, body, make) {
    const h = hashOf(body);
    const seen = state.keys.get(key);
    if (seen) return seen.hash === h ? { status: 200, json: answer(seen.t) } : { status: 409, json: { error: 'idempotency_conflict', key } };
    const t = make();
    if (t.status) return t;
    state.keys.set(key, { hash: h, t });
    return { status: 200, json: answer(t) };
  }

  /** (method, path, headers lower-cased, raw body) → { status, json }. */
  function handle(method, path, headers, raw) {
    state.calls.push({ method, path, at: Date.now(), headers: { 'x-event-id': headers['x-event-id'], 'idempotency-key': headers['idempotency-key'], 'x-tenant-id': headers['x-tenant-id'] }, body: raw ? JSON.parse(raw) : null });
    if (state.down) return { status: 503, json: { error: 'down' } };
    if (!path.startsWith(PREFIX)) return { status: 404, json: { error: 'not_found' } };
    if (state.unauthorized || !verify(headers, raw)) return { status: 401, json: { error: 'invalid_signature' } };
    const p = path.slice(PREFIX.length);
    flush();
    if (method === 'GET' && p === '/health') {
      const pending = state.transactions.filter((t) => t.mevStatus !== 'ACCEPTED');
      return { status: 200, json: { status: 'ok', environment: state.environment, certified: state.certified, certificateValidUntil: null, mevReachable: !state.mevDown, queueDepth: pending.length, oldestQueuedAt: null, locations: (locations || []).map((l) => ({ locationId: l, deviceReady: true, certReady: true, usersReady: true })) } };
    }
    const id = headers['x-event-id'];
    const bodyHash = sha256(raw || '');
    if (method === 'POST') {
      const prev = state.events.get(id);
      if (prev && prev !== bodyHash) return { status: 409, json: { error: 'replay_conflict' } };
      state.events.set(id, bodyHash);
    }
    const body = raw ? JSON.parse(raw) : null;
    const getSale = p.match(/^\/sales\/([^/]+)$/);
    if (method === 'GET' && getSale) {
      const s = state.keys.get(decodeURIComponent(getSale[1]));
      return s ? { status: 200, json: answer(s.t) } : { status: 404, json: { error: 'sale_not_found' } };
    }
    if (method === 'POST' && p === '/sales') {
      const errs = checkSale(body);
      if (errs.length) return { status: 422, json: { error: 'validation', fields: errs } };
      if (headers['idempotency-key'] !== body.saleKey) return { status: 400, json: { error: 'idempotency_key_mismatch' } };
      if (!allowed(body.locationId)) return { status: 423, json: { error: 'location_not_ready' } };
      const corrected = body.referenceSaleKey ? state.keys.get(body.referenceSaleKey)?.t : null;
      if (body.referenceSaleKey && !corrected) return { status: 422, json: { error: 'validation_failed', errors: [{ field: 'referenceSaleKey', message: 'no receipt exists for this saleKey' }] } };
      return once(body.saleKey, body, () => issue({
        key: body.saleKey, kind: 'sale', saleKey: body.saleKey, locationId: body.locationId, occurredAt: body.occurredAt, amounts: body.amounts, typServ: body.serviceType,
        ref: corrected ? { noTrans: corrected.noTrans, datTrans: corrected.datTrans } : null,
        mentions: ['PAIEMENT REÇU', ...(body.referenceSaleKey ? ['Facture corrigée'] : []), ...(body.serviceType === 'LVT' ? ['COMMANDE PAR UNE PLATEFORME NUMÉRIQUE'] : [])],
        footer: body.testMode ? ['***DOCUMENT DE FORMATION***', 'NE PAS REMETTRE AU CLIENT'] : [], format: body.receipt?.format ?? 'PAP',
        lines: body.lines, modImpr: 'FAC', modTrans: body.testMode ? 'FOR' : 'OPE', original: body,
      }));
    }
    const credit = p.match(/^\/sales\/([^/]+)\/credit-notes$/);
    if (method === 'POST' && credit) {
      const saleKey = decodeURIComponent(credit[1]);
      if (body?.schema !== 'foodhub.credit.v1' || !String(body.creditKey).startsWith(`${saleKey}:cn:`) || hashOf(body) !== body.payloadHash || !(body.amounts?.subtotalCents >= 0)) return { status: 422, json: { error: 'validation' } };
      const s = state.keys.get(saleKey);
      if (!s) return { status: 404, json: { error: 'sale_not_found' } };
      return once(body.creditKey, body, () => issue({
        key: body.creditKey, kind: 'credit_note', saleKey, locationId: s.t.locationId, occurredAt: montrealNow(), typServ: s.t.typServ,
        amounts: { subtotalCents: -s.t.subtotalCents, gstCents: -s.t.gstCents, qstCents: -s.t.qstCents, totalCents: -s.t.totalCents, tipCents: 0 },
        ref: { noTrans: s.t.noTrans, datTrans: s.t.datTrans },
        mentions: ['NOTE DE CRÉDIT'], footer: s.t.footer, format: s.t.format, lines: s.t.lines, modImpr: 'FAC', modTrans: s.t.modTrans, original: s.t,
      }));
    }
    const print = p.match(/^\/sales\/([^/]+)\/prints$/);
    if (method === 'POST' && print) {
      const saleKey = decodeURIComponent(print[1]);
      if (body?.schema !== 'foodhub.print.v1' || !String(body.printKey).startsWith(`${saleKey}:pr:`) || !['RPR', 'DUP'].includes(body.mode) || hashOf(body) !== body.payloadHash) return { status: 422, json: { error: 'validation' } };
      const s = state.keys.get(saleKey);
      if (!s) return { status: 404, json: { error: 'sale_not_found' } };
      return once(body.printKey, body, () => issue({
        key: body.printKey, kind: 'print', saleKey, locationId: s.t.locationId, occurredAt: montrealNow(), typServ: s.t.typServ,
        ref: { noTrans: s.t.noTrans, datTrans: s.t.datTrans },
        amounts: { subtotalCents: s.t.subtotalCents, gstCents: s.t.gstCents, qstCents: s.t.qstCents, totalCents: s.t.totalCents, tipCents: s.t.tipCents },
        mentions: s.t.mentions, footer: body.mode === 'DUP' ? ['***COPIE DU COMMERÇANT***', 'NE PAS REMETTRE AU CLIENT'] : ['REPRODUCTION'], format: s.t.format, lines: s.t.lines, modImpr: body.mode, modTrans: s.t.modTrans, original: s.t,
      }));
    }
    return { status: 404, json: { error: 'not_found' } };
  }

  /** Every signature is 88 characters, verifies with the device key, and chains (preced = previous actu; first = 88 "="). */
  function verifyChain() {
    let prev = '='.repeat(88);
    for (const c of state.chain) {
      if (c.actu.length !== 88 || c.preced !== prev) return { ok: false, at: c.key };
      if (!crypto.verify('sha256', Buffer.from(c.data), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(c.actu, 'base64'))) return { ok: false, at: c.key };
      prev = c.actu;
    }
    return { ok: true, count: state.chain.length };
  }

  return { state, handle, verifyChain, flush, PREFIX };
}

/** A fetch that routes one base URL to the mock (unit tests); anything else goes to `fallback`. */
export function mockQcmevFetch(mock, base, fallback) {
  return async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (!url.startsWith(base)) return fallback(input, init);
    const h = {};
    for (const [k, v] of Object.entries(init.headers || {})) h[k.toLowerCase()] = String(v);
    const r = mock.handle(String(init.method || 'GET').toUpperCase(), new URL(url).pathname.replace(new URL(base).pathname.replace(/\/$/, ''), ''), h, typeof init.body === 'string' ? init.body : '');
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}
