// verify:foodhub — Takatak MEV (QCMEV) section: Food Hub orders → invoices through the stand-in QCMEV
// (scripts/e2e/mock-qcmev.mjs, mounted on the e2e mock server under /qcmev). Placeholder data only, no network.
//
// The whole suite before this section runs with FOODHUB_MEV=simulator configured but the owner switch OFF: Takatak
// MEV must have seen zero calls. Then one test kitchen (E2E_MEV) is switched to QCMEV and the scenarios run:
//   S1 Uber delivery (courier tip, platform fees)      → LVT, no tip, no fees, platform mention
//   S2 DoorDash pickup with a restaurant promotion,
//      then a DoorDash order adjustment               → sale, credit note, corrected receipt naming the first
//   S3 Skip order handed to the tablet (tax 0)         → tax computed from the base
//   S4 phone pickup, cash at the counter, tip $2       → CMP, ARG, pourb; with QCMEV stopped meanwhile (outbox)
//   S5 website own delivery paid online, fee $4.99     → LVR, e-commerce, card; with MEV-WEB down (offline receipt)
//   S6 Skip cancels after acceptance                   → full credit note
//   S7 Too Good To Go daily bag log                    → skipped (never a sale)
//   S8 the same Uber webhook three times               → one transaction
//   S9 civil date / time                               → datTrans = the local wall clock of occurredAt
//   S10 a $0 order                                     → AUC
//   S11 reprint (RPR) and merchant copy (DUP)          → transmitted, merchant copy mention
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from './mock-qcmev.mjs';

export const MEV_LOCATION = 'E2E_MEV';
const LOC = MEV_LOCATION;

export async function runMevScenarios(h) {
  const { call, check, waitFor, sleep, findOrder, uberWebhook, skipWebhook, skipOrder, mevMock, secret, localDay, appLog } = h;
  const st = mevMock.state;
  const sales = () => st.calls.filter((c) => c.method === 'POST' && /\/sales$/.test(c.path));
  const saleFor = (key) => sales().filter((c) => c.body?.saleKey === key);
  const credits = () => st.calls.filter((c) => c.method === 'POST' && /\/credit-notes$/.test(c.path));
  const prints = () => st.calls.filter((c) => c.method === 'POST' && /\/prints$/.test(c.path));
  const mevOf = async (externalId) => (await findOrder(externalId))?.timeline?.mev;
  const directMev = async (id) => (await call('GET', `/api/foodhub/delivery/${id}`)).json?.order?.mev;
  const report = { at: new Date().toISOString(), scenarios: {} };

  console.log('\n48. Revenu Québec invoices through Takatak MEV (QCMEV stand-in)');
  check('MEV switch OFF for the whole run so far: zero calls to Takatak MEV', st.calls.length === 0, `${st.calls.length} call(s)`);
  const s0 = (await call('GET', '/api/foodhub/mev')).json;
  check('MEV status: simulator mode, address and key set, the key value is never shown', s0?.readiness?.mode === 'simulator' && s0.readiness.urlSet && s0.readiness.secretSet && !JSON.stringify(s0).includes(secret), JSON.stringify(s0?.readiness));
  const exp = (await call('GET', '/api/foodhub/expansion')).json;
  check('the MEV owner switch is listed on Expansion, OFF', exp?.features?.some((f) => f.key === 'mev' && f.on === false && f.checks.length >= 3), JSON.stringify(exp?.features?.find((f) => f.key === 'mev')));

  // A test kitchen with its platform stores, own orders on, invoices through QCMEV.
  await call('POST', '/api/foodhub/catalog', { body: { location: { code: LOC, name: 'E2E MEV — cuisine d’essai', address: '1 Rue Essai', city: 'Montréal', phone: '514 555-0177', active: true } } });
  const mk = async (b) => (await call('POST', '/api/foodhub/stores', { body: b })).json?.store;
  const stores = [
    await mk({ channel: 'uber_eats', channelStoreId: 'uber-store-mev', brandName: 'Po Poulet', locationCode: LOC }),
    await mk({ channel: 'doordash', channelStoreId: 'dd-mev-e2e', brandName: 'Po Poulet', locationCode: LOC }),
    await mk({ channel: 'skip', channelStoreId: 'MEV-SKIP', brandName: 'Po Poulet', locationCode: LOC }),
  ];
  check('test kitchen E2E_MEV with Uber, DoorDash and Skip stores', stores.every((s) => s?.id));
  await call('PUT', '/api/foodhub/expansion', { body: { key: 'delivery', on: true } });
  check('not active yet: the owner switch is off', (await call('GET', '/api/foodhub/mev')).json?.locations?.find((l) => l.code === LOC)?.why === 'switch_off');
  const sev = await call('PUT', '/api/foodhub/mev', { body: { locationCode: LOC, sevOfRecord: 'qcmev' } });
  check('owner sets « Takatak MEV » for the kitchen', sev.json?.locations?.find((l) => l.code === LOC)?.sevOfRecord === 'qcmev');
  check('the invoicing system cannot be changed without signing in', (await call('PUT', '/api/foodhub/mev', { body: { locationCode: LOC, sevOfRecord: 'none' }, auth: false })).status === 401);
  const on = await call('PUT', '/api/foodhub/expansion', { body: { key: 'mev', on: true } });
  check('owner turns the MEV switch on', on.json?.features?.find((f) => f.key === 'mev')?.on === true);
  const hc = await call('POST', '/api/foodhub/mev', { body: { action: 'health' } });
  check('Takatak MEV /health read (signed): SIMULATOR, kitchen active', hc.json?.health?.health?.environment === 'SIMULATOR' && hc.json.locations.find((l) => l.code === LOC)?.active === true, JSON.stringify(hc.json?.health));

  // S1 — Uber delivery
  check('S1 Uber webhook accepted', (await uberWebhook('uber-mev-1')).status === 200);
  const m1 = await waitFor(async () => { const m = await mevOf('uber-mev-1'); return m?.status === 'accepted' ? m : null; }, 15000);
  const s1 = saleFor('fh:takatak:stored:uber_eats:uber-mev-1')[0]?.body;
  check('S1 Uber → one LVT sale, no courier tip, no platform fees', !!m1 && s1?.serviceType === 'LVT' && s1.amounts.tipCents === 0 && s1.fees.deliveryCents === 0 && s1.payment.mode === 'AUT' && s1.testMode === true, JSON.stringify(s1 && { t: s1.serviceType, a: s1.amounts, f: s1.fees }));
  check('S1 receipt on the order: number, QR image, platform mention', /^\d{6}-\d{4}$/.test(m1?.noTrans || '') && /^data:image\//.test(m1?.qrImage || '') && m1.mentions?.includes('COMMANDE PAR UNE PLATEFORME NUMÉRIQUE'), JSON.stringify(m1 && { n: m1.noTrans, m: m1.mentions }));
  const o1 = await findOrder('uber-mev-1');
  check('S1 kitchen ticket page answers', (await call('GET', `/ticket/${o1?.id}?autoprint=0`)).status === 200);
  const pub = await call('GET', `/r/${m1?.token}`, { auth: false });
  check('S1 electronic copy /r/<token> is public, shows the lines, the QR and « Consulter la transaction en ligne »', pub.status === 200 && pub.text.includes(m1?.noTrans) && pub.text.includes('Consulter la transaction en ligne') && pub.text.includes('data:image/'), String(pub.status));
  check('a wrong receipt token → 404', (await call('GET', '/r/AAAAAAAAAAAAAAAAAAAAAA', { auth: false })).status === 404);
  report.scenarios.S1 = { noTrans: m1?.noTrans, serviceType: s1?.serviceType, amounts: s1?.amounts };

  // S8 — the same Uber webhook again (twice)
  await uberWebhook('uber-mev-1'); await uberWebhook('uber-mev-1'); await sleep(800);
  check('S8 the same Uber order three times → one transaction', st.transactions.filter((t) => t.key === 'fh:takatak:stored:uber_eats:uber-mev-1').length === 1);

  // S2 — DoorDash pickup with a restaurant promotion, then an adjustment
  const dd = (items, subtotal, tax) => ({ id: 'dd-mev-2', store: { merchant_supplied_id: 'dd-mev-e2e' }, consumer: { first_name: 'Luc' }, fulfillment_type: 'pickup', subtotal, tax, total_merchant_funded_discount_amount: 200, categories: [{ name: 'Plats', items }] });
  const both = [{ name: 'Poulet Grillé', quantity: 1, price: 1499, merchant_supplied_id: 'clv-item-1', extras: [] }, { name: 'Frites', quantity: 1, price: 499, merchant_supplied_id: 'clv-item-2', extras: [] }];
  await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: dd(both, 1998, 269) });
  const m2 = await waitFor(async () => { const m = await mevOf('dd-mev-2'); return m?.status === 'accepted' ? m : null; }, 15000);
  const s2 = saleFor('fh:takatak:stored:doordash:dd-mev-2')[0]?.body;
  check('S2 DoorDash pickup: restaurant-funded promotion as the discount, LVT', !!m2 && s2?.discountCents === 200 && s2.amounts.subtotalCents === 1798 && s2.serviceType === 'LVT', JSON.stringify(s2 && { d: s2.discountCents, a: s2.amounts }));
  const adj = await call('POST', '/api/foodhub/webhooks/doordash', { auth: false, headers: { authorization: 'dd-hook-e2e' }, body: { order: dd([both[0]], 1499, 195), order_adjustment_metadata: { adjusted_order_items: [{ adjustment_type: 'ITEM_REMOVE' }], adjustment_source: 'MERCHANT', adjustment_timestamp: new Date().toISOString() } } });
  const m2b = await waitFor(async () => { const m = await mevOf('dd-mev-2'); return m?.saleKey?.endsWith(':r1') && m.status === 'accepted' ? m : null; }, 15000);
  const cn2 = credits().find((c) => c.body?.saleKey === 'fh:takatak:stored:doordash:dd-mev-2');
  const re2 = saleFor('fh:takatak:stored:doordash:dd-mev-2:r1')[0]?.body;
  check('S2 adjustment → full credit note of the first receipt + a corrected receipt that names it', adj.status === 200 && !!cn2 && cn2.body.creditKey === 'fh:takatak:stored:doordash:dd-mev-2:cn:1' && re2?.replacesSaleKey === 'fh:takatak:stored:doordash:dd-mev-2' && re2.amounts.subtotalCents === 1299 && !!m2b && m2b.creditNotes?.length === 1, JSON.stringify({ adj: adj.status, cn: cn2?.body?.creditKey, re: re2 && { r: re2.replacesSaleKey, a: re2.amounts } }));
  report.scenarios.S2 = { first: m2?.noTrans, corrected: m2b?.noTrans, creditNote: m2b?.creditNotes?.[0]?.noTrans };

  // S3 — Skip handed to the tablet, tax 0 in the feed
  await skipWebhook('failed', { validationError: 'unknownReference', order: { orderId: 'skip-mev-failed-1', friendlyOrderReference: '9911', totalPrice: 2497, restaurant: { id: 'MEV-SKIP' }, fulfilment: { type: 'delivery' }, items: [{ name: 'Poulet Grillé', plu: 'clv-item-1', price: 1499, quantity: 1 }, { name: 'Frites', plu: 'clv-item-2', price: 499, quantity: 2 }] } }, { hmac: false });
  const m3 = await waitFor(async () => { const m = await mevOf('skip-mev-failed-1'); return m?.status === 'accepted' ? m : null; }, 15000);
  const s3 = saleFor('fh:takatak:stored:skip:skip-mev-failed-1')[0]?.body;
  check('S3 Skip tablet order (tax 0 in the feed) → tax computed from the base', !!m3 && s3?.flags?.taxComputed === true && s3.amounts.gstCents === 125 && s3.amounts.qstCents === 249 && s3.amounts.totalCents === 2871, JSON.stringify(s3?.amounts));

  // S4 — phone pickup, cash at the counter, tip $2; Takatak MEV stopped while the invoice is due
  const ph = await call('POST', '/api/foodhub/delivery', { body: { source: 'phone', locationCode: LOC, brandName: 'Po Poulet', customer: { name: 'Client Essai' }, fulfillment: 'pickup', tip: 2, items: [{ name: 'Poulet Grillé', quantity: 1, price: 14.99 }, { name: 'Frites', quantity: 2, price: 4.99 }] } });
  const phId = ph.json?.order?.id;
  await call('POST', `/api/foodhub/delivery/${phId}`, { body: { action: 'picked_up' } });
  const w4 = await waitFor(async () => { const m = await directMev(phId); return m?.reason === 'tender_unknown' ? m : null; }, 10000);
  check('S4 picked up, Clover payment unreadable → the invoice waits for the tender (never sent as INC)', !!w4 && w4.status === 'pending' && saleFor(`fh:takatak:direct:phone:${phId}`).length === 0, JSON.stringify(w4));
  st.down = true;
  const tender = await call('POST', `/api/foodhub/mev/orders/${phId}`, { body: { model: 'direct', action: 'tender', tender: 'ARG' } });
  const p4 = await waitFor(async () => { const j = (await call('GET', `/api/foodhub/mev/orders/${phId}?model=direct`)).json?.jobs?.[0]; return j?.wait === 'qcmev_unreachable' ? j : null; }, 10000);
  const q4 = (await call('GET', '/api/foodhub/mev')).json?.outbox;
  check('S4 Takatak MEV stopped: the invoice waits in the outbox (pending), nothing lost', tender.status === 200 && !!p4 && p4.status === 'pending' && q4?.pending >= 1 && (await directMev(phId))?.status === 'pending', JSON.stringify({ p4, q4 }));
  st.down = false;
  await sleep(1300);
  await call('POST', '/api/foodhub/mev', { body: { action: 'run' } });
  const m4 = await waitFor(async () => { const m = await directMev(phId); return m?.status === 'accepted' ? m : null; }, 10000);
  const s4 = saleFor(`fh:takatak:direct:phone:${phId}`).map((c) => c.body);
  const tx4 = st.transactions.filter((t) => t.key === `fh:takatak:direct:phone:${phId}`);
  check('S4 back up → sent with the same key and event id, one transaction: CMP, ARG, pourb 2,00 $', !!m4 && tx4.length === 1 && tx4[0].noTrans === m4.noTrans && s4.length >= 2 && new Set(saleFor(`fh:takatak:direct:phone:${phId}`).map((c) => c.headers['x-event-id'])).size === 1 && s4[0].serviceType === 'CMP' && s4[0].payment.mode === 'ARG' && s4[0].amounts.tipCents === 200, JSON.stringify({ n: tx4.length, posts: s4.length, p: s4[0]?.payment, tip: s4[0]?.amounts?.tipCents }));
  report.scenarios.S4 = { noTrans: m4?.noTrans, attempts: s4.length };

  // S5 — website own delivery paid online, $4.99 fee; MEV-WEB down → offline receipt, then numbered
  st.mevDown = true;
  const web = await call('POST', '/api/foodhub/webhooks/website-order', { auth: false, headers: { authorization: 'Bearer web-order-e2e' }, body: { id: 'WEB-MEV-5', brand: 'Po Poulet', location: LOC, customer: { name: 'Client Web' }, fulfillment: 'delivery', address: { street: '5555 Av Essai', city: 'Montréal', postalCode: 'H4A 1E1' }, items: [{ name: 'Poulet Grillé', quantity: 1, price: 14.99 }], deliveryFee: 4.99, paid: true } });
  const webId = web.json?.id;
  const m5 = await waitFor(async () => { const m = await directMev(webId); return m?.status === 'offline' ? m : null; }, 15000);
  const s5 = saleFor(`fh:takatak:direct:website:${webId}`)[0]?.body;
  check('S5 website delivery paid online → LVR, e-commerce, card, the delivery fee is the restaurant’s', s5?.serviceType === 'LVR' && s5.ecommerce === true && s5.payment.mode === 'CRE' && s5.fees.deliveryCents === 499, JSON.stringify(s5 && { t: s5.serviceType, p: s5.payment, f: s5.fees }));
  check('S5 MEV-WEB down → offline receipt with its number and a local QR', !!m5 && !!m5.noTrans && /^data:image\//.test(m5.qrImage || '') && /HORS LIGNE/.test((m5.text80mm || []).join('\n')), JSON.stringify(m5 && { s: m5.status, n: m5.noTrans }));
  st.mevDown = false;
  await sleep(1300);
  await call('POST', '/api/foodhub/mev', { body: { action: 'run' } });
  const m5b = await waitFor(async () => { const m = await directMev(webId); return m?.status === 'accepted' && m.mevNumber ? m : null; }, 10000);
  check('S5 MEV-WEB back → the same receipt gets its MEV number (batch flush)', !!m5b && m5b.noTrans === m5?.noTrans && /^MEV-/.test(m5b.mevNumber || ''), JSON.stringify(m5b && { n: m5b.noTrans, mev: m5b.mevNumber }));

  // S6 — Skip cancels after acceptance
  await skipWebhook('orders', skipOrder('skip-mev-0006', 'MEV-SKIP', 'tx-mev-6'));
  const m6 = await waitFor(async () => { const m = await mevOf('skip-mev-0006'); return m?.status === 'accepted' ? m : null; }, 15000);
  await skipWebhook('cancel', { orderID: 'skip-mev-0006', reason: { code: 'customer_cancelled' }, happenedAt: new Date().toISOString() }, { hmac: false });
  const m6b = await waitFor(async () => { const m = await mevOf('skip-mev-0006'); return m?.status === 'credited' && m.creditNotes?.[0]?.status === 'accepted' ? m : null; }, 15000);
  const cn6 = st.transactions.find((t) => t.key === 'fh:takatak:stored:skip:skip-mev-0006:cn:1');
  check('S6 cancelled after acceptance → full credit note, negative amounts, names the original', !!m6 && !!m6b && cn6?.totalCents < 0 && cn6.mentions.includes(`RÉF. FACTURE ${m6.noTrans}`), JSON.stringify(cn6 && { total: cn6.totalCents, m: cn6.mentions }));

  // S7 — Too Good To Go daily bag log
  const today = localDay(0);
  await call('POST', '/api/foodhub/tgtg', { body: { date: today, locationCode: LOC, bagsOffered: 5, bagsSold: 3, pricePerBag: 5.99 } });
  const ord7 = (await call('GET', `/api/foodhub/orders?limit=500&from=${today}&to=${today}`)).json?.orders?.find((o) => o.externalOrderId === `tgtg-log-${LOC}-${today}`);
  check('S7 Too Good To Go bag log → skipped, nothing sent', ord7?.timeline?.mev?.status === 'skipped' && ord7.timeline.mev.reason === 'log_order' && !st.calls.some((c) => JSON.stringify(c.body ?? '').includes('tgtg-log-')), JSON.stringify(ord7?.timeline?.mev));

  // S10 — a $0 order
  const z = await call('POST', '/api/foodhub/delivery', { body: { source: 'phone', locationCode: LOC, brandName: 'Po Poulet', customer: { name: 'Repas offert' }, fulfillment: 'pickup', items: [{ name: 'Repas offert', quantity: 1, price: 0 }] } });
  await call('POST', `/api/foodhub/delivery/${z.json?.order?.id}`, { body: { action: 'mark_paid' } });
  const m10 = await waitFor(async () => { const m = await directMev(z.json?.order?.id); return m?.status === 'accepted' ? m : null; }, 10000);
  const s10 = saleFor(`fh:takatak:direct:phone:${z.json?.order?.id}`)[0]?.body;
  check('S10 a $0 order → AUC', !!m10 && s10?.payment?.mode === 'AUC' && s10.amounts.totalCents === 0, JSON.stringify(s10?.payment));

  // S11 — merchant copy and reprint
  const dup = await call('POST', `/api/foodhub/mev/orders/${o1?.id}`, { body: { model: 'stored', action: 'merchant_copy' } });
  const rpr = await call('POST', `/api/foodhub/mev/orders/${o1?.id}`, { body: { model: 'stored', action: 'reprint' } });
  const m11 = await waitFor(async () => { const m = await mevOf('uber-mev-1'); return (m?.prints ?? []).filter((p) => p.status === 'accepted').length === 2 ? m : null; }, 10000);
  check('S11 merchant copy (DUP) and reprint (RPR) transmitted; the copy says « COPIE DU COMMERÇANT / NE PAS REMETTRE AU CLIENT »', dup.status === 200 && rpr.status === 200 && prints().map((c) => c.body.mode).join(',') === 'DUP,RPR' && /COPIE DU COMMERÇANT[\s\S]*NE PAS REMETTRE AU CLIENT/.test((m11?.prints?.find((p) => p.mode === 'DUP')?.text80mm || []).join('\n')), JSON.stringify(m11?.prints?.map((p) => [p.mode, p.status])));

  // ---- assertions over everything QCMEV received ----
  const allSales = sales().map((c) => c.body);
  const uniqueSales = [...new Map(allSales.map((s) => [s.saleKey, s])).values()];
  const okMath = uniqueSales.every((s) => s.amounts.totalCents === s.amounts.subtotalCents + s.amounts.gstCents + s.amounts.qstCents);
  const half = (n, d) => Math.floor((2 * n + d) / (2 * d));
  const okRound = uniqueSales.filter((s) => !s.flags?.taxGap && s.lines.every((l) => l.taxCode === 'FP')).every((s) => s.amounts.gstCents === half(Math.max(0, s.amounts.subtotalCents) * 5, 100) && s.amounts.qstCents === half(Math.max(0, s.amounts.subtotalCents) * 9975, 100000));
  check('every sale: apresTax = avantTax + TPS + TVQ to the cent; TPS and TVQ rounded one by one', okMath && okRound);
  check('pourb only on the phone pickup (S4): never on a platform order', uniqueSales.filter((s) => s.amounts.tipCents > 0).map((s) => s.source.channel).join(',') === 'phone', uniqueSales.filter((s) => s.amounts.tipCents > 0).map((s) => s.saleKey).join(' '));
  check('service types: LVT for platforms, CMP for the phone pickup, LVR for our delivery', uniqueSales.every((s) => (['uber_eats', 'doordash', 'skip'].includes(s.source.channel) ? s.serviceType === 'LVT' : s.source.channel === 'website' ? s.serviceType === 'LVR' : s.serviceType === 'CMP')));
  const days = new Map();
  for (const t of st.transactions) { const k = `${t.deviceId}:${t.datTrans.slice(0, 8)}:${t.noTrans}`; days.set(k, (days.get(k) || 0) + 1); }
  check('noTrans unique per device and civil day', [...days.values()].every((n) => n === 1) && st.transactions.length > 0, `${st.transactions.length} transactions`);
  // S9: the civil date/time QCMEV used is the Montréal wall clock of occurredAt (the 23:30 edge is unit-tested).
  check('S9 datTrans = the local date and time Food Hub sent (America/Montreal, offset kept)', uniqueSales.every((s) => { const t = st.transactions.find((x) => x.key === s.saleKey); return t && t.datTrans === s.occurredAt.slice(0, 19).replace(/[-T:]/g, '') && /^[+-]0[45]:00$/.test(t.utc); }));
  const chain = mevMock.verifyChain();
  check('every signature is 88 characters, verifies (ECDSA P-256) and chains; the first preced is 88 "="', chain.ok && chain.count === st.transactions.length && st.chain[0]?.preced === '='.repeat(88), JSON.stringify(chain));
  // Replay and conflict, straight against the stand-in with Food Hub's own signed request.
  const first = sales()[0];
  const sign = (raw, id, key) => { const ts = String(Date.now()); return { 'x-integration-id': 'foodhub', 'x-tenant-id': 'takatak', 'x-event-id': id, 'x-timestamp': ts, 'idempotency-key': key, 'x-signature': `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${id}.${raw}`).digest('hex')}` }; };
  const raw1 = JSON.stringify(first.body);
  const again = mevMock.handle('POST', '/api/v1/integrations/foodhub/sales', sign(raw1, first.headers['x-event-id'], first.body.saleKey), raw1);
  const changed = { ...first.body, source: { ...first.body.source, displayId: 'CHANGED' } };
  changed.payloadHash = crypto.createHash('sha256').update(canonicalJson({ ...changed, payloadHash: undefined })).digest('hex');
  const raw2 = JSON.stringify(changed);
  const conflict = mevMock.handle('POST', '/api/v1/integrations/foodhub/sales', sign(raw2, crypto.randomUUID(), first.body.saleKey), raw2);
  check('replaying a sale returns the same receipt; the same key with another body → 409', again.status === 200 && again.json.receipt.noTrans === st.transactions.find((t) => t.key === first.body.saleKey)?.noTrans && conflict.status === 409, `${again.status} ${conflict.status}`);
  const leaks = [secret, 'BEGIN PRIVATE KEY', 'BEGIN EC PRIVATE KEY'];
  const mevApi = JSON.stringify((await call('GET', `/api/foodhub/mev/orders/${o1?.id}`)).json) + JSON.stringify((await call('GET', '/api/foodhub/mev')).json);
  check('no secret, key or identity number in the logs, the API answers or the payloads', !leaks.some((x) => appLog().includes(x) || mevApi.includes(x)) && !/\b\d{9}RT\d{4}\b|\b\d{10}TQ\d{4}\b/.test(JSON.stringify(st.calls.map((c) => c.body))));

  const counts = { sales: uniqueSales.length, creditNotes: [...new Set(credits().map((c) => c.body.creditKey))].length, prints: [...new Set(prints().map((c) => c.body.printKey))].length, skipped: 1, transactions: st.transactions.length, requests: st.calls.length };
  check(`counts: ${counts.sales} receipts, ${counts.creditNotes} credit notes, ${counts.prints} copies, ${counts.skipped} skipped`, counts.sales === 8 && counts.creditNotes === 2 && counts.prints === 2, JSON.stringify(counts));
  report.counts = counts;
  report.chain = chain;
  report.transactions = st.transactions.map((t) => ({ key: t.key, kind: t.kind, noTrans: t.noTrans, datTrans: t.datTrans, utc: t.utc, typServ: t.typServ, totalCents: t.totalCents, mevStatus: t.mevStatus, signatureLength: t.signa.actu.length }));

  await call('PUT', '/api/foodhub/expansion', { body: { key: 'mev', on: false } });
  await call('PUT', '/api/foodhub/expansion', { body: { key: 'delivery', on: false } });
  const before = st.calls.length;
  await uberWebhook('uber-mev-after-off');
  await waitFor(async () => (await findOrder('uber-mev-after-off'))?.status === 'accepted', 10000);
  await sleep(500);
  check('MEV switched off again → an accepted order makes no call', st.calls.length === before, `${st.calls.length - before} call(s)`);
  if (process.env.FOODHUB_E2E_MEV_REPORT) { try { fs.writeFileSync(process.env.FOODHUB_E2E_MEV_REPORT, JSON.stringify(report, null, 2)); } catch { /* report is optional */ } }
  return report;
}
