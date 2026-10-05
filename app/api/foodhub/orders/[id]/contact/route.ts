import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { CHANNEL_LABELS } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { maskContact, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { customerContact, lateMessage } from '@/lib/foodhub/watch/customer';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// GET → how this customer can be reached (relay number, access code, textable?) + ready-made messages.
export const GET = withPerm<Ctx>('orders:act', async (_req, ctx, actor) => {
  const { id } = await ctx.params;
  const o = await getRepo().getOrder(id);
  if (!o || !inScope(actor, o.locationCode)) return fail('Order not found', 404);
  const c = customerContact(o);
  const late = lateMessage(o, 10);
  return ok({ contact: { name: c.name, tel: c.tel, canSms: c.canSms, masked: c.phone ? maskContact(c.phone) : null, hasCode: Boolean(c.code) }, templates: { late } });
});

// POST { text } → operational SMS to the customer (manager PIN for staff; logged with who sent it).
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const o = await getRepo().getOrder(id);
  if (!o || !inScope(actor, o.locationCode)) return fail('Order not found', 404);
  const c = customerContact(o);
  if (!c.canSms || !c.phone) return fail('La plateforme ne partage pas de numéro texto pour ce client — appelez-le. / No textable number — call instead.', 409);
  const b = await readJson(req);
  const text = String(b.text || '').trim().slice(0, 320);
  if (!text) return fail('Message vide. / Empty message.');
  const tag = `${CHANNEL_LABELS[o.channel]} #${o.displayId || o.externalOrderId.slice(0, 8)}`;
  const gate = await approvalGate(req, actor, 'customer.contact', o.locationCode, `text customer of ${tag}`);
  if (gate) return gate;
  const r = await sendSms({ to: c.phone, body: text }, { purpose: 'customer', orderId: o.id, by: actor.name });
  await getRepo().addEvent(o.id, r.ok ? 'customer_sms' : 'customer_sms_failed', { message: r.message, by: actor.name, to: maskContact(c.phone) });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'message', action: 'customer_sms', status: r.ok ? 'success' : 'failed', channel: o.channel, brandName: o.brandName, locationCode: o.locationCode, orderId: o.id,
    summary: `Text to the customer of ${tag}${actor.approvedBy ? ` (approved by ${actor.approvedBy})` : ''}: ${r.ok ? 'sent' : r.message}` });
  return r.ok ? ok({ result: r }) : fail(r.message, 502);
});
