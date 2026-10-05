import { approvalGate, inScope, scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { maskContact, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { customerContact } from '@/lib/foodhub/watch/customer';
import { actOnIncident, addIncidentStep, getIncident, listIncidents } from '@/lib/foodhub/watch/engine';
import type { IncidentStatus } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

const STATUSES: IncidentStatus[] = ['open', 'acknowledged', 'snoozed', 'resolved'];

// GET ?status=open,acknowledged&days=3
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const status = (q.get('status') || '').split(',').filter((s) => STATUSES.includes(s as IncidentStatus)) as IncidentStatus[];
  const days = Math.max(1, Math.min(30, Number(q.get('days') || 3)));
  const list = await listIncidents({ status, since: new Date(Date.now() - days * 86400_000).toISOString(), locationCodes: scopeFilter(actor) });
  const one = q.get('id');
  return ok({ incidents: one ? list.filter((i) => i.id === one) : list });
});

// { id, action: 'ack' | 'resolve' | 'snooze' | 'note' | 'reopen' | 'customer_sms', minutes?, note?, text? }
export const POST = withPerm('orders:act', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const inc = await getIncident(String(b.id || ''));
  if (!inc || !inScope(actor, inc.locationCode)) return fail('Incident not found', 404);
  const action = String(b.action || '');
  if (action === 'customer_sms') {
    const order = inc.orderId ? await getRepo().getOrder(inc.orderId) : null;
    const c = order ? customerContact(order) : null;
    if (!c?.canSms || !c.phone) return fail('La plateforme ne partage pas de numéro texto pour ce client — appelez-le plutôt. / No textable number for this customer — call instead.', 409);
    const text = String(b.text || inc.customer?.draftFr || '').trim().slice(0, 320);
    if (!text) return fail('Message vide. / Empty message.');
    const gate = await approvalGate(req, actor, 'customer.contact', inc.locationCode, `text customer of #${order!.displayId || order!.externalOrderId.slice(0, 8)}`);
    if (gate) return gate;
    const r = await sendSms({ to: c.phone, body: text }, { purpose: 'customer', incidentId: inc.id, orderId: inc.orderId ?? undefined, by: actor.name });
    await addIncidentStep(inc.id, { at: new Date().toISOString(), kind: 'customer_sms', to: maskContact(c.phone), ok: r.ok, message: r.message, by: actor.approvedBy ? `${actor.name} (✓ ${actor.approvedBy})` : actor.name });
    return r.ok ? ok({ result: r }) : fail(r.message, 502);
  }
  if (!['ack', 'resolve', 'snooze', 'note', 'reopen'].includes(action)) return fail('action must be ack, resolve, snooze, note, reopen or customer_sms');
  const i = await actOnIncident(inc.id, action as 'ack', actor, { minutes: Number(b.minutes) || undefined, note: b.note ? String(b.note) : undefined });
  return ok({ incident: i });
});
