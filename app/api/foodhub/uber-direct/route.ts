import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { getDelivery } from '@/lib/foodhub/delivery/store';
import {
  createUberDirectOrganization, findUberDirectStores, getUberDirectOrganization, inviteUberDirectMember, listUberDirectBusinessLocations, listUberDirectDeliveries,
  submitUberDirectRefund, UBER_DIRECT_REFUND_REASONS, uberDirect, updateUberDirectBusinessLocation, type UberDirectRefundReason,
} from '@/lib/foodhub/delivery/uber-direct';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Uber Direct account tools (Organizations, Business Locations, Find Stores, List Deliveries, Refund Submission).
// GET ?view=org|locations|deliveries|stores (stores: &lat=&lng=). Owner / manager only.
// POST { action: org_create | invite | location_update | refund }. Writes need the live switch in production.

const FILTERS = ['pending', 'pickup', 'pickup_complete', 'dropoff', 'delivered', 'canceled', 'returned', 'ongoing'] as const;

export const GET = withPerm('stores:map', async (req) => {
  const r = uberDirect.readiness();
  const q = new URL(req.url).searchParams;
  const view = q.get('view') || 'org';
  if (!r.configured) return fail(r.note, 409);
  if (view === 'org') return ok({ readiness: r, ...(await getUberDirectOrganization(q.get('organizationId') || undefined)) });
  if (view === 'locations') return ok(await listUberDirectBusinessLocations(q.get('organizationId') || undefined, q.get('page') || undefined));
  if (view === 'deliveries') {
    const filter = (FILTERS as readonly string[]).includes(q.get('filter') ?? '') ? (q.get('filter') as (typeof FILTERS)[number]) : undefined;
    return ok(await listUberDirectDeliveries({ filter, externalStoreId: q.get('store') || undefined, offset: Number(q.get('offset')) || 0 }));
  }
  if (view === 'stores') return ok(await findUberDirectStores(Number(q.get('lat')), Number(q.get('lng'))));
  return fail('view: org, locations, deliveries or stores.');
});

export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const action = String(b.action || '');
  let out: { ok: boolean; message: string; [k: string]: unknown };
  if (action === 'org_create') {
    const gate = await approvalGate(req, actor, 'team.manage', null, 'Uber Direct organization');
    if (gate) return gate;
    out = await createUberDirectOrganization({
      name: String(b.name ?? ''), merchantType: b.merchantType ? String(b.merchantType) : undefined, billingType: b.billingType === 'BILLING_TYPE_DECENTRALIZED' ? 'BILLING_TYPE_DECENTRALIZED' : 'BILLING_TYPE_CENTRALIZED',
      contact: { email: String(b.contact?.email ?? ''), firstName: String(b.contact?.firstName ?? ''), lastName: String(b.contact?.lastName ?? ''), phone: b.contact?.phone ? String(b.contact.phone) : undefined },
      address: { street1: String(b.address?.street1 ?? ''), street2: b.address?.street2 ? String(b.address.street2) : undefined, city: String(b.address?.city ?? ''), province: String(b.address?.province ?? 'QC'), postalCode: String(b.address?.postalCode ?? '') },
      invite: b.invite !== false,
    });
  } else if (action === 'invite') {
    const role = ['ROLE_ADMIN', 'ROLE_EMPLOYEE', 'ROLE_SUPPORT'].includes(b.role) ? b.role : 'ROLE_EMPLOYEE';
    out = await inviteUberDirectMember(String(b.organizationId ?? '') || String(process.env.UBER_DIRECT_CUSTOMER_ID ?? ''), { email: String(b.email ?? ''), firstName: String(b.firstName ?? ''), lastName: String(b.lastName ?? ''), phone: b.phone ? String(b.phone) : undefined, role, externalStoreId: b.externalStoreId ? String(b.externalStoreId) : undefined });
  } else if (action === 'location_update') {
    out = await updateUberDirectBusinessLocation(String(b.businessLocationId ?? ''), { name: b.name ? String(b.name) : undefined, phone: b.phone ? String(b.phone) : undefined, externalId: b.externalId ? String(b.externalId) : undefined }, b.organizationId ? String(b.organizationId) : undefined);
  } else if (action === 'refund') {
    const gate = await approvalGate(req, actor, 'order.adjust', null, 'Uber Direct refund');
    if (gate) return gate;
    const d = b.deliveryId ? await getDelivery(String(b.deliveryId)) : null;
    const fleetId = d?.fleet === 'uber_direct' ? d.fleetDeliveryId : String(b.fleetDeliveryId ?? '');
    if (!fleetId) return fail('Which Uber Direct delivery?');
    if (!(UBER_DIRECT_REFUND_REASONS as readonly string[]).includes(b.reason)) return fail(`reason: ${UBER_DIRECT_REFUND_REASONS.join(', ')}`);
    out = await submitUberDirectRefund({ fleetDeliveryId: fleetId, reason: b.reason as UberDirectRefundReason, amount: Number(b.amount), notes: b.notes ? String(b.notes) : undefined, itemsMissing: Array.isArray(b.itemsMissing) ? b.itemsMissing.map(String) : undefined });
  } else return fail('Unknown action.');
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: `uber_direct_${action}`, status: out.ok ? 'success' : 'failed', summary: `Uber Direct ${action.replace('_', ' ')}: ${out.message}` });
  return out.ok ? ok(out) : fail(out.message, 409, out);
});
