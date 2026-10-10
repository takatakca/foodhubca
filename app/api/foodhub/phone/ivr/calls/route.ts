import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { maskPhone } from '@/lib/foodhub/notify';
import { callMatches, getIvrCall, listIvrCalls, listPlatformRefs, listTickets, updateTicket, type IvrCall } from '@/lib/foodhub/phone/ivr/records';

export const dynamic = 'force-dynamic';

// The ON2GO line's call log: every call with its path, captured order numbers, platform, tickets, voicemail and outcome.
// Search by phone number or order number (?q=). Lists show masked numbers; one call (?id=) shows the number to call
// back and the transcript. The ON2GO line serves every kitchen: only people who see every location can read it.
const lite = (c: IvrCall) => ({ ...c, from: maskPhone(c.from), messages: undefined, prompt: undefined, pending: undefined, transcript: undefined, transcriptLength: c.transcript.length });

export const GET = withPerm('orders:act', async (req, _ctx, actor) => {
  if (actor.locations.length) return fail('The ON2GO line serves every location: ask the owner.', 403);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 14));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const [refs, tickets] = await Promise.all([listPlatformRefs({ since }), listTickets({ since })]);
  if (id) {
    const call = await getIvrCall(id);
    if (!call) return fail('Call not found.', 404);
    return ok({ call: { ...call, messages: undefined, prompt: undefined, pending: undefined }, refs: refs.filter((r) => r.callId === id), tickets: tickets.filter((t) => t.callId === id) });
  }
  const q = (url.searchParams.get('q') ?? '').slice(0, 60);
  const calls = (await listIvrCalls({ since, limit: 2000 })).filter((c) => callMatches(c, refs, tickets, q));
  const ids = new Set(calls.map((c) => c.id));
  return ok({
    calls: calls.map(lite),
    refs: refs.filter((r) => ids.has(r.callId)).map((r) => ({ ...r, from: maskPhone(r.from) })),
    tickets: tickets.filter((t) => ids.has(t.callId) || !q).map((t) => ({ ...t, from: maskPhone(t.from), transcript: undefined })),
  });
});

// Close or reopen a ticket.
export const PATCH = withPerm('orders:act', async (req, _ctx, actor) => {
  if (actor.locations.length) return fail('The ON2GO line serves every location: ask the owner.', 403);
  const b = await readJson(req);
  const status = b.status === 'done' ? 'done' : 'open';
  const t = await updateTicket(String(b.ticketId ?? ''), status === 'done' ? { status, doneAt: new Date().toISOString(), doneBy: actor.name } : { status, doneAt: undefined, doneBy: undefined });
  if (!t) return fail('Ticket not found.', 404);
  return ok({ ticket: t });
});
