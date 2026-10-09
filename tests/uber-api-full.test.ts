// Uber API full coverage, part 2 (task 22): the rest of the Eats Marketplace reference (current order suite, own
// delivery, Dispatch Multiple Courier, retail / grocery, current store suite, BYOC, item price) and all of Uber Direct
// (options, Courier Pick & Pack, Organizations, Business Locations, Find Stores, Refund Submission, PIN). Mocked HTTP.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchUberOrderCurrent, fetchUberStoreStatusCurrent, getUberReplacementRecommendations, listUberStoresCurrent, patchUberGroceryCart, resolveUberRetailIssues,
  sendUberByocCourierLocation, setUberByocFulfillment, setUberCourierCount, setUberItemPrice, setUberStoreStatusCurrent, validateUberItemFulfillment,
} from '../lib/foodhub/adapters/uber-api';
import { forgetUberTokenMemory, invalidateUberToken, uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { cleanSettings } from '../lib/foodhub/delivery/store';
import {
  createUberDirectOrganization, findUberDirectStores, getUberDirectBusinessLocation, getUberDirectOrganization, inviteUberDirectMember, listUberDirectBusinessLocations,
  resetUberDirectToken, submitUberDirectRefund, uberDeliveryBody, uberDirect, uberDirectRefundBody, updateUberDirectBusinessLocation,
} from '../lib/foodhub/delivery/uber-direct';
import { runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, StoredOrder } from '../lib/foodhub/types';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; raw: string | null };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown } | null) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, raw };
    calls.push(c);
    const tok = c.url.endsWith('/oauth/v2/token') ? { status: 200, body: { access_token: 'tok', expires_in: 2592000 } } : null;
    const r = tok ?? route(c) ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const api = () => calls.filter((c) => !c.url.endsWith('/oauth/v2/token'));
const API = 'https://api.uber.com';
const store = (over: Partial<ChannelStore> = {}): Omit<ChannelStore, 'id'> => ({ channel: 'uber_eats', channelStoreId: 'uber-ndg', brandName: 'Pi Pita', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: { uberPos: { orderManager: 'foodhub' } }, ...over });

async function uberOrder(status: StoredOrder['status'], over: Record<string, unknown> = {}) {
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'o-1', displayId: 'A1B2', channelStoreId: 'uber-ndg', fulfillment: 'delivery', placedAt: new Date().toISOString(),
    currency: 'CAD', subtotal: 20, tax: 3, deliveryFee: 0, tip: 0, discount: 0, total: 23, raw: {}, lines: [{ externalId: 'item-falafel', name: 'Falafel wrap', quantity: 1, unitPrice: 20, total: 20 }],
    ...over,
  } as any);
  return (await repo.updateOrder(order.id, { status, locationCode: 'NDG_MAIN' }))!;
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  Object.assign(process.env, { UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'secret', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true' });
  for (const k of ['UBER_ACCESS_TOKEN', 'UBER_BASE_URL', 'UBER_AUTH_URL', 'UBER_ENV', 'UBER_OAUTH_SCOPE', 'UBER_ORDER_API', 'FOODHUB_MENU_LOCKED_STORES']) delete process.env[k];
  forgetUberTokenMemory();
  await invalidateUberToken('orders'); await invalidateUberToken('poll');
});
afterEach(() => vi.unstubAllGlobals());

describe('Eats: current order suite, own delivery, DMC, retail, current store suite, BYOC, item price', () => {
  it('UBER_ORDER_API=current: accept / deny / cancel go to /v1/delivery/order with the documented bodies', async () => {
    process.env.UBER_ORDER_API = 'current';
    const o = await uberOrder('new');
    const ready = new Date(Date.now() + 15 * 60_000).toISOString();
    mockFetch(() => ({ status: 200, body: {} }));
    await uberEatsAdapter.acceptOrder({ ...o, timeline: { ...o.timeline, readyTarget: ready } }, 'CLV-1');
    expect(api()[0]).toMatchObject({ url: `${API}/v1/delivery/order/o-1/accept`, body: { accepted_by: 'TAKATAK Food Hub', external_reference_id: 'CLV-1', ready_for_pickup_time: ready } });
    await uberEatsAdapter.denyOrder(o, 'Item out of stock');
    expect(api()[1]).toMatchObject({ url: `${API}/v1/delivery/order/o-1/deny`, body: { deny_reason: { info: 'Item out of stock', type: 'ITEM_ISSUE' } } });
    await uberEatsAdapter.cancelOrder(o, 'too_busy');
    expect(api()[2]).toMatchObject({ url: `${API}/v1/delivery/order/o-1/cancel`, body: { cancellation_reason: { info: 'Cancelled by restaurant', type: 'RESTAURANT_TOO_BUSY' } } });
    delete process.env.UBER_ORDER_API;
    await uberEatsAdapter.denyOrder(o, 'closed');
    expect(api()[3].url).toBe(`${API}/v1/eats/orders/o-1/deny_pos_order`);
  });

  it('an Uber Eats order our own driver delivers: Picked up / Completed tell Uber started / delivered', async () => {
    const o = await uberOrder('ready', { raw: { type: 'DELIVERY_BY_RESTAURANT' } });
    mockFetch(() => ({ status: 204 }));
    const r = await runOrderAction(o.id, 'dispatch');
    expect(r.result.message).toMatch(/Uber Eats shows it/);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/eats/orders/o-1/restaurantdelivery/status`, body: { status: 'started' } });
    await runOrderAction(o.id, 'complete');
    expect(api()[1].body).toEqual({ status: 'delivered' });
    const byUber = await uberOrder('ready', { externalOrderId: 'o-2', raw: { type: 'DELIVERY_BY_UBER' } });
    mockFetch(() => null);
    await runOrderAction(byUber.id, 'dispatch');
    expect(api()).toHaveLength(0);
  });

  it('Dispatch Multiple Courier, current order details, retail resolve / validate / replacements, grocery Patch Cart', async () => {
    mockFetch((c) => c.url.endsWith('/validate-item-fulfillment') ? { status: 200, body: { results: [{ level: 'WARN', code: 'BARCODE_MISMATCH' }] } }
      : c.url.endsWith('/get-replacement-recommendations') ? { status: 200, body: { replacement_recommendations: [{ id: 'r1' }] } }
        : c.url.includes('/v1/delivery/order/o-1?') ? { status: 200, body: { order: { id: 'o-1', state: 'ACCEPTED' } } } : { status: 200, body: {} });
    expect((await setUberCourierCount('o-1', 6)).ok).toBe(false);
    await setUberCourierCount('o-1', 2);
    expect(api()[0]).toMatchObject({ url: `${API}/v1/delivery/order/o-1/update-delivery-partner-count`, body: { delivery_partner_count: 2 } });
    expect((await fetchUberOrderCurrent('o-1')).order).toEqual({ id: 'o-1', state: 'ACCEPTED' });
    expect(api()[1].url).toBe(`${API}/v1/delivery/order/o-1?expand=carts,deliveries,payment`);
    expect((await resolveUberRetailIssues('o-1', [{ issueType: 'OUT_OF_ITEM', cartItemId: 'ci-1' }])).ok).toBe(false);
    await resolveUberRetailIssues('o-1', [
      { issueType: 'OUT_OF_ITEM', actionType: 'REPLACE_FOR_ME', cartItemId: 'ci-1', itemSubstitute: { id: 'sku-2' } },
      { issueType: 'FOUND_ITEM', actionType: 'REMOVE_ITEM', cartItemId: 'ci-2', scannedBarcode: '0123' },
    ]);
    expect(api()[2].body.fulfillment_issues).toEqual([
      { issue_type: 'OUT_OF_ITEM', action_type: 'REPLACE_FOR_ME', item: { cart_item_id: 'ci-1' }, item_substitute: { id: 'sku-2' } },
      { issue_type: 'FOUND_ITEM', item: { cart_item_id: 'ci-2', scanned_barcode: { value: '0123' } } },
    ]);
    expect(await validateUberItemFulfillment('o-1', { issueType: 'FOUND_ITEM', cartItemId: 'ci-2', scannedBarcode: '0123' })).toMatchObject({ ok: true, blocking: false });
    expect(api()[3].url).toBe(`${API}/v1/delivery/order/o-1/validate-item-fulfillment`);
    expect((await getUberReplacementRecommendations('o-1', 'uber-ndg', 'sku-1')).recommendations).toEqual([{ id: 'r1' }]);
    expect(api()[4]).toMatchObject({ url: `${API}/v1/delivery/get-replacement-recommendations`, body: { id: 'sku-1', order_id: 'o-1', store_id: 'uber-ndg' } });
    await patchUberGroceryCart('o-1', [{ type: 'OUT_OF_ITEM', action: 'REPLACE_FOR_ME', instanceId: 'inst-1', substitute: { id: 'sku-9', quantity: 1 } }]);
    expect(api()[5]).toMatchObject({ method: 'PATCH', url: `${API}/v2/eats/orders/o-1/cart`, body: { fulfillment_issues: [{ fulfillment_issue_type: 'OUT_OF_ITEM', fulfillment_action_type: 'REPLACE_FOR_ME', root_item: { instance_id: 'inst-1' }, item_substitute: { id: 'sku-9', quantity: 1 } }] } });
  });

  it('current Store suite (stores, status get / set), BYOC configuration + courier location, item price never on a locked store', async () => {
    mockFetch((c) => c.url.includes('/v1/delivery/stores?') ? { status: 200, body: { stores: [{ id: 's1' }], pagination_data: { next_page_token: 'n' } } }
      : c.url.endsWith('/status') ? { status: 200, body: { status: 'OFFLINE', is_offline_until: '2026-10-09T20:00:00Z', offline_reason: 'Paused' } } : { status: 200, body: {} });
    expect(await listUberStoresCurrent()).toEqual({ ok: true, stores: [{ id: 's1' }], nextPageToken: 'n' });
    expect(await fetchUberStoreStatusCurrent('uber-ndg')).toEqual({ ok: true, status: 'OFFLINE', offlineUntil: '2026-10-09T20:00:00Z', reason: 'Paused' });
    await setUberStoreStatusCurrent('uber-ndg', false, Date.parse('2026-10-09T20:00:00Z'), 'Rush');
    expect(api()[2]).toMatchObject({ url: `${API}/v1/delivery/store/uber-ndg/update-store-status`, body: { status: 'OFFLINE', is_offline_until: '2026-10-09T20:00:00.000Z', reason: 'Rush' } });
    await setUberByocFulfillment('uber-ndg', { custom_min_etd_minutes: 30 });
    expect(api()[3]).toMatchObject({ url: `${API}/v1/delivery/store/uber-ndg/update-fulfillment-configuration`, body: { override_config: { custom_min_etd_minutes: 30 } } });
    await sendUberByocCourierLocation({ orderWorkflowId: 'wf', restaurantId: 'uber-ndg', events: [{ latitude: 45.47, longitude: -73.61 }] });
    expect(api()[4]).toMatchObject({ url: `${API}/v1/eats/byoc/restaurants/orders/event/location`, body: { location_request: { order_workflow_uuid: 'wf', restaurant_uuid: 'uber-ndg', is_batched_order: false } } });
    const s = await getRepo().upsertStore(store());
    await setUberItemPrice(s, 'i1', 12.5);
    expect(api()[5]).toMatchObject({ url: `${API}/v2/eats/stores/uber-ndg/menus/items/i1`, body: { price_info: { price: 1250 } } });
    const locked = await getRepo().upsertStore(store({ channelStoreId: 'uber-locked', meta: { menuLocked: true } }));
    expect((await setUberItemPrice(locked, 'i1', 9)).status).toBe('skipped');
    expect(api()).toHaveLength(6);
  });
});

describe('all of Uber Direct: options, CPP, organizations, business locations, find stores, refunds, PIN', () => {
  beforeEach(() => {
    Object.assign(process.env, { UBER_DIRECT_CUSTOMER_ID: 'cus_1', UBER_DIRECT_CLIENT_ID: 'd-id', UBER_DIRECT_CLIENT_SECRET: 'd-secret' });
    delete process.env.UBER_DIRECT_ENV; delete process.env.UBER_DIRECT_REFUND_EMAIL;
    resetUberDirectToken();
  });
  const req = (over: Record<string, unknown> = {}) => ({
    id: 'fhd-1', reference: 'M-1', pickup: { businessName: 'Pi Pita', address: 'x', phone: '514 555 0100', locationCode: 'NDG' }, dropoff: { name: 'Ana', address: 'y', phone: '5145551234' },
    orderValue: 30, tip: 3, currency: 'CAD', items: [{ name: 'Wrap', quantity: 1, price: 12 }], containsAlcohol: false, undeliverable: 'dispose' as const, fleetSms: true, ...over,
  });

  it('Create Delivery options: idempotency, external store, leave at door + photo, PIN (meet at door, return), alcohol ID, CPP', () => {
    const leave = uberDeliveryBody(req({ uber: { deliverableAction: 'leave_at_door', proof: 'picture', pickPackPay: false } }));
    expect(leave).toMatchObject({ idempotency_key: 'fhd-1', external_store_id: 'NDG', pickup_business_name: 'Pi Pita', deliverable_action: 'deliverable_action_leave_at_door', dropoff_verification: { picture: true }, undeliverable_action: 'leave_at_door' });
    const pin = uberDeliveryBody(req({ uber: { deliverableAction: 'leave_at_door', proof: 'pincode', pickPackPay: true } }));
    expect(pin).toMatchObject({ deliverable_action: 'deliverable_action_meet_at_door', dropoff_verification: { pincode: { enabled: true } }, undeliverable_action: 'return', pickup_action: 'pick_pack_pay' });
    const alcohol = uberDeliveryBody(req({ containsAlcohol: true, minAge: 18, uber: { deliverableAction: 'leave_at_door', proof: 'signature', pickPackPay: false } }));
    expect(alcohol).toMatchObject({ deliverable_action: 'deliverable_action_meet_at_door', dropoff_verification: { signature: true, identification: { min_age: 18 } }, undeliverable_action: 'return' });
    expect('strict' in alcohol).toBe(false);
    expect(uberDeliveryBody(req())).not.toHaveProperty('deliverable_action');
  });

  it('settings: leave at door only with a photo or nothing; the PIN Uber returns is kept', async () => {
    expect(cleanSettings({ uberDirect: { deliverableAction: 'leave_at_door', proof: 'signature', pickPackPay: false } } as any).uberDirect).toEqual({ deliverableAction: 'meet_at_door', proof: 'signature', pickPackPay: false });
    expect(cleanSettings({ uberDirect: { deliverableAction: 'leave_at_door', proof: 'none' } } as any).uberDirect).toEqual({ deliverableAction: 'leave_at_door', proof: 'picture', pickPackPay: false });
    expect(cleanSettings(null).uberDirect).toEqual({ deliverableAction: 'meet_at_door', proof: 'picture', pickPackPay: false });
    mockFetch((c) => c.url.endsWith('/delivery_quotes') ? { status: 200, body: { id: 'dqt_1', fee: 899, expires: new Date(Date.now() + 600_000).toISOString() } }
      : { status: 200, body: { id: 'del_1', status: 'pending', fee: 899, dropoff: { verification_requirements: { pincode: { value: '4321' } } } } });
    const q = await uberDirect.quote(req({ uber: { deliverableAction: 'meet_at_door', proof: 'pincode', pickPackPay: true } }));
    expect(api()[0].body).toMatchObject({ external_store_id: 'NDG', pickup_action: 'pick_pack_pay', manifest_items: [{ name: 'Wrap', quantity: 1, size: 'small', price: 1200 }] });
    const r = await uberDirect.create(req({ uber: { deliverableAction: 'meet_at_door', proof: 'pincode', pickPackPay: false } }), q);
    expect(r).toMatchObject({ ok: true, fleetDeliveryId: 'del_1', dropoffPin: '4321' });
    expect(api()[1].body.quote_id).toBe('dqt_1');
  });

  it('Organizations (direct.organizations token): create a sub-organization, read it, invite a user', async () => {
    mockFetch((c) => c.url.endsWith('/direct/organizations') ? { status: 200, body: { organization_id: 'org-2' } }
      : c.url.endsWith('/memberships/invite') ? { status: 200, body: { membership_id: 'm-1' } } : { status: 200, body: { organization_id: 'cus_1', billing_info: { billing_status: 'BILLING_STATUS_ACTIVE' } } });
    const r = await createUberDirectOrganization({ name: 'Resto Client', contact: { email: 'owner@resto.test', firstName: 'Ana', lastName: 'B', phone: '514-555-0100' }, address: { street1: '1 Rue Test', city: 'Montréal', province: 'QC', postalCode: 'H1H 1H1' }, invite: false });
    expect(r).toMatchObject({ ok: true, organizationId: 'org-2' });
    const tok = calls.find((c) => c.url.endsWith('/oauth/v2/token'))!;
    expect(new URLSearchParams(String(tok.raw)).get('scope')).toBe('direct.organizations');
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/direct/organizations`, body: {
      info: { name: 'Resto Client', billing_type: 'BILLING_TYPE_CENTRALIZED', merchant_type: 'MERCHANT_TYPE_RESTAURANT', point_of_contact: { email: 'owner@resto.test', first_name: 'Ana', last_name: 'B', phone_details: { phone_number: '15145550100', country_code: '1', subscriber_number: '5145550100' } }, address: { street1: '1 Rue Test', street2: '', city: 'Montréal', state: 'QC', zipcode: 'H1H 1H1', country_iso2: 'CA' } },
      hierarchy_info: { parent_organization_id: 'cus_1' }, options: { onboarding_invite_type: 'ONBOARDING_INVITE_TYPE_INVALID' } } });
    expect((await getUberDirectOrganization()).organization).toMatchObject({ billing_info: { billing_status: 'BILLING_STATUS_ACTIVE' } });
    expect(api()[1].url).toBe(`${API}/v1/direct/organizations/cus_1`);
    expect(await inviteUberDirectMember('org-2', { email: 'cook@resto.test', firstName: 'C', lastName: 'K', role: 'ROLE_EMPLOYEE', externalStoreId: 'NDG' })).toMatchObject({ ok: true, membershipId: 'm-1' });
    expect(api()[2].body).toMatchObject({ roles: ['ROLE_EMPLOYEE'], role_assignments: { role: 'ROLE_EMPLOYEE', role_scope: { organization_id: 'org-2', store_identifier: { organization_id: 'org-2', external_store_id: 'NDG' } } } });
  });

  it('Business Locations list / get / update, Find Stores', async () => {
    mockFetch((c) => c.url.includes('/business_locations?') ? { status: 200, body: { business_locations: [{ business_location_id: 'bl-1', name: 'Pi Pita NDG', external_business_location_id: 'NDG', organization_id: 'cus_1' }], next_page_token: '2' } }
      : c.url.includes('/stores?') ? { status: 200, body: { stores: [{ store_id: 'bl-1' }] } } : { status: 200, body: { business_location: { business_location_id: 'bl-1', name: 'New name', external_business_location_id: 'NDG' } } });
    expect(await listUberDirectBusinessLocations()).toMatchObject({ ok: true, nextPageToken: '2', locations: [{ id: 'bl-1', name: 'Pi Pita NDG', externalId: 'NDG' }] });
    expect(api()[0].url).toBe(`${API}/v1/direct/organizations/cus_1/business_locations?limit=100`);
    expect((await getUberDirectBusinessLocation('bl-1')).location?.name).toBe('New name');
    const u = await updateUberDirectBusinessLocation('bl-1', { externalId: 'NDG', address: { street1: '6280 Somerled', city: 'Montréal', province: 'QC', postalCode: 'H4V 1R9' }, lat: 45.47, lng: -73.61 });
    expect(u.ok).toBe(true);
    expect(api()[2]).toMatchObject({ method: 'PATCH', body: { external_business_location_id: 'NDG', detailed_address: { street_address_1: '6280 Somerled', city: 'Montréal', state: 'QC', zip_code: 'H4V 1R9', country: 'CA' }, location: { lat: 45.47, lng: -73.61 } } });
    expect((await updateUberDirectBusinessLocation('bl-1', {})).ok).toBe(false);
    expect((await findUberDirectStores(45.47, -73.61)).stores).toEqual([{ store_id: 'bl-1' }]);
    expect(api()[3].url).toBe(`${API}/v1/direct/organizations/cus_1/stores?latitude=45.47&longitude=-73.61`);
  });

  it('Refund Submission: E5 amount, documented reasons, admin email required, 409 = already asked', async () => {
    expect(uberDirectRefundBody({ fleetDeliveryId: 'del_1', reason: 'uber_missing_items', amount: 10, itemsMissing: ['Fries'], requesterEmail: 'admin@x.test' }))
      .toEqual({ delivery_id: 'del_1', requester_email_id: 'admin@x.test', refund_reason: 'uber_missing_items', items_missing: ['Fries'], total_refund_amount: { amount: 1000000, currency_code: 'CAD' } });
    mockFetch(() => ({ status: 200, body: { code: 'OK' } }));
    expect((await submitUberDirectRefund({ fleetDeliveryId: 'del_1', reason: 'uber_order_delivered_late', amount: 5 })).message).toMatch(/UBER_DIRECT_REFUND_EMAIL/);
    process.env.UBER_DIRECT_REFUND_EMAIL = 'admin@x.test';
    expect((await submitUberDirectRefund({ fleetDeliveryId: 'del_1', reason: 'uber_order_delivered_late', amount: 5 })).ok).toBe(true);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/direct/cus_1/submit_refund`, body: { refund_reason: 'uber_order_delivered_late', total_refund_amount: { amount: 500000 } } });
    mockFetch(() => ({ status: 409, body: { code: 'conflict' } }));
    expect((await submitUberDirectRefund({ fleetDeliveryId: 'del_1', reason: 'uber_never_pick_up', amount: 5 })).message).toMatch(/already/);
  });
});
