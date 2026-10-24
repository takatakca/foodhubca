import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getDirectOrder } from '@/lib/foodhub/delivery/store';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { directBaseKey, requestMevPrint, setDirectTender, storedBaseKey } from '@/lib/foodhub/mev/hooks';
import { jobsFor, replayJob } from '@/lib/foodhub/mev/outbox';
import type { MevJob, MevPayMode } from '@/lib/foodhub/mev/types';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

async function load(model: string, id: string) {
  if (model === 'direct') {
    const d = await getDirectOrder(id);
    return d ? { locationCode: d.locationCode, baseKey: directBaseKey(d), mev: d.mev ?? null } : null;
  }
  const o = await getRepo().getOrder(id);
  return o ? { locationCode: o.locationCode, baseKey: storedBaseKey(o), mev: o.timeline?.mev ?? null } : null;
}

/** The outbox rows of an order, without their payloads (states, keys, attempts, the last error). */
const view = (j: MevJob) => ({
  id: j.id, key: j.key, kind: j.kind, status: j.status, wait: j.wait ?? null, attempts: j.attempts, nextAt: j.nextAt, lastError: j.lastError ?? null, lastHttp: j.lastHttp ?? null,
  shadow: Boolean(j.shadow), creditedBy: j.creditedBy ?? null, createdAt: j.createdAt, doneAt: j.doneAt ?? null,
  amounts: 'amounts' in j.payload ? j.payload.amounts : null, mode: 'mode' in j.payload ? j.payload.mode : null, result: j.result?.status ?? null,
});

// The invoice (MEV) of one order: ?model=stored (platform order, default) | direct (own order).
export const GET = withPerm<Ctx>('view', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const model = new URL(req.url).searchParams.get('model') === 'direct' ? 'direct' : 'stored';
  const o = await load(model, id);
  if (!o || !inScope(actor, o.locationCode)) return fail('Order not found.', 404);
  return ok({ mev: o.mev, jobs: (await jobsFor(o.baseKey)).map(view) });
});

// { model, action: "reprint" | "merchant_copy" | "tender" | "replay", tender?: ARG|CRE|DEB|CPR|MIX, jobId? }
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const model = b.model === 'direct' ? 'direct' : 'stored';
  const o = await load(model, id);
  if (!o || !inScope(actor, o.locationCode)) return fail('Order not found.', 404);
  if (b.action === 'reprint' || b.action === 'merchant_copy') {
    const r = await requestMevPrint(model, id, b.action === 'reprint' ? 'RPR' : 'DUP', actor);
    if (!r.ok) return fail(r.message, 409);
    return ok({ message: r.message, key: r.key, jobs: (await jobsFor(o.baseKey)).map(view) });
  }
  if (b.action === 'tender') {
    if (model !== 'direct') return fail('Only an own order paid at the counter needs its tender.');
    const tender = String(b.tender ?? '') as MevPayMode;
    if (!['ARG', 'CRE', 'DEB', 'CPR', 'MIX'].includes(tender)) return fail('tender must be ARG, CRE, DEB, CPR or MIX.');
    const d = await setDirectTender(id, tender, actor);
    return ok({ mev: d?.mev ?? null, jobs: (await jobsFor(o.baseKey)).map(view) });
  }
  if (b.action === 'replay') {
    const jobs = await jobsFor(o.baseKey);
    const j = jobs.find((x) => x.id === b.jobId) ?? jobs.find((x) => x.status === 'needs_human');
    if (!j || j.status !== 'needs_human') return fail('Nothing waits for a person on this order.', 409);
    await replayJob(j.id, actor);
    return ok({ jobs: (await jobsFor(o.baseKey)).map(view) });
  }
  return fail('action must be reprint, merchant_copy, tender or replay.');
});
