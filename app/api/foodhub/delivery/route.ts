import { inScope, withPerm } from '@/lib/foodhub/auth';
import { normalizePostal } from '@/lib/foodhub/delivery/address';
import { dispatchProblems, fleetReadiness } from '@/lib/foodhub/delivery/dispatch';
import { createDirectOrder, lineTotal } from '@/lib/foodhub/delivery/orders';
import { getDeliverySettings, listDeliveries, listDirectOrders } from '@/lib/foodhub/delivery/store';
import type { DirectLine } from '@/lib/foodhub/delivery/types';
import { requireFeature } from '@/lib/foodhub/expansion/features';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { normalizePhone } from '@/lib/foodhub/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Own orders board: direct orders of the last days (phone, Clover delivery, website, typed in) with their courier.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 2));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const [orders, deliveries, settings] = await Promise.all([
    listDirectOrders({ since, limit: 1000 }),
    listDeliveries({ since: new Date(Date.parse(since) - 86400_000).toISOString(), limit: 2000 }),
    getDeliverySettings(),
  ]);
  const byId = new Map(deliveries.map((d) => [d.id, d]));
  return ok({
    orders: orders.filter((o) => inScope(actor, o.locationCode)).map((o) => ({ ...o, delivery: o.deliveryId ? byId.get(o.deliveryId) ?? null : null })),
    fleets: fleetReadiness(),
    settings: { primaryFleet: settings.primaryFleet, compareQuotes: settings.compareQuotes, customerFee: settings.customerFee, defaultTip: settings.defaultTip },
  });
});

// A person takes an order by hand (phone, counter) — same path as every direct order (Clover ticket, courier rules).
export const POST = withPerm('orders:act', async (req, _ctx, actor) => {
  await requireFeature('delivery');
  const b = await readJson(req);
  if (!inScope(actor, b.locationCode)) return fail('Not your location.', 403);
  const items: any[] = Array.isArray(b.items) ? b.items : [];
  const lines: DirectLine[] = items.filter((i) => String(i?.name ?? '').trim()).map((i) => {
    const quantity = Math.max(1, Math.min(99, Math.round(Number(i.quantity) || 1)));
    const unitPrice = Math.max(0, Math.round((Number(i.price) || 0) * 100) / 100);
    return { name: String(i.name).trim().slice(0, 120), quantity, unitPrice, total: lineTotal(unitPrice, quantity, []), modifiers: [], notes: i.notes ? String(i.notes).slice(0, 200) : undefined, ...(i.alcohol === true ? { alcohol: true } : {}) };
  });
  if (!lines.length) return fail('Add at least one item with a name and a price.');
  const fulfillment = b.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  const a = b.dropoff ?? {};
  const settings = await getDeliverySettings();
  const order = await createDirectOrder({
    source: b.source === 'phone' ? 'phone' : 'manual', brandName: String(b.brandName ?? ''), locationCode: String(b.locationCode ?? ''),
    customer: { name: String(b.customer?.name ?? '').trim() || undefined, phone: normalizePhone(b.customer?.phone) ?? undefined, lang: b.customer?.lang === 'en' ? 'en' : 'fr' },
    fulfillment, lines, notes: b.notes ? String(b.notes).slice(0, 300) : undefined,
    dropoff: fulfillment === 'delivery'
      ? { street: String(a.street ?? '').trim(), unit: a.unit ? String(a.unit).trim() : undefined, city: String(a.city || 'Montréal').trim(), province: 'QC', postalCode: normalizePostal(a.postalCode) ?? String(a.postalCode ?? ''), country: 'CA', instructions: a.instructions ? String(a.instructions).slice(0, 200) : undefined }
      : undefined,
    payment: b.payment === 'paid' ? 'paid' : fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid',
    tip: Number(b.tip) || 0,
    deliveryFee: fulfillment === 'delivery' ? (b.deliveryFee !== undefined && b.deliveryFee !== '' ? Number(b.deliveryFee) || 0 : settings.customerFee) : 0,
    confirmBySms: b.confirmBySms === true,
  }, actor);
  return ok({ order, problems: fulfillment === 'delivery' ? await dispatchProblems(order) : [] });
});
