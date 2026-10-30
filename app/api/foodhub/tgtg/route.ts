import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { mevGate } from '@/lib/foodhub/mev/config';
import { listBagDays, listBagPickups, pickupCodeRequired, recordBagPickup, saveBagDay, withInvoiceCounts } from '@/lib/foodhub/tgtg';
import { startOfLocalDayMs } from '@/lib/foodhub/time';

export const dynamic = 'force-dynamic';

// ?locations=A,B (the viewer's locations): which of them issue their invoices through Takatak MEV (nothing is read when
// FOODHUB_MEV=off). For those: each day's bags with their own invoice, the « Sac remis » of today and yesterday, and
// where the reservation code is required (TGTG e-mails are read for that kitchen: never a second sale for one bag).
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const days = (await listBagDays(q.get('from') || undefined, q.get('to') || undefined)).filter((d) => inScope(actor, d.locationCode));
  const asked = String(q.get('locations') ?? '').split(',').map((s) => s.trim()).filter((c) => c && inScope(actor, c));
  const codes = [...new Set([...asked, ...days.map((d) => d.locationCode)])].slice(0, 50);
  const mev: Record<string, boolean> = {};
  for (const c of codes) mev[c] = (await mevGate(c).catch(() => ({ active: false }))).active;
  const on = codes.filter((c) => mev[c]);
  const pickups = on.length ? await listBagPickups(new Date(startOfLocalDayMs(Date.now()) - 86400_000).toISOString(), on) : [];
  const codeRequired = on.length ? await pickupCodeRequired(on) : {};
  return ok({ days: await withInvoiceCounts(days), mev, pickups, codeRequired });
});

// { date, locationCode, bagsOffered, bagsSold, pricePerBag, note? }  — the day's count (a report, never a sale)
// { action: 'pickup', locationCode, pricePerBag, quantity?, code?, firstName? } — « Sac remis »: one sale, printed now
export const POST = withPerm('orders:act', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.locationCode || !inScope(actor, String(b.locationCode))) return fail('Choose one of your locations.', 403);
  try {
    if (b.action === 'pickup') {
      const pickup = await recordBagPickup({ locationCode: String(b.locationCode), pricePerBag: Number(b.pricePerBag), quantity: b.quantity === undefined ? 1 : Number(b.quantity), code: b.code ? String(b.code) : undefined, firstName: b.firstName ? String(b.firstName) : undefined }, actor);
      return ok({ pickup });
    }
    const day = await saveBagDay({ date: String(b.date || ''), locationCode: String(b.locationCode), bagsOffered: Number(b.bagsOffered), bagsSold: Number(b.bagsSold), pricePerBag: Number(b.pricePerBag), note: b.note ? String(b.note) : undefined }, actor);
    return ok({ day });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
