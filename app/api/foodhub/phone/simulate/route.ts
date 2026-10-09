import { withPerm } from '@/lib/foodhub/auth';
import { requireFeature } from '@/lib/foodhub/expansion/features';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { simulateTurn } from '@/lib/foodhub/phone/voice';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Try the agent": type what a caller would say. Same agent, menu and rules as a real call; an order is never sent.
export const POST = withPerm('menu:edit', async (req) => {
  await requireFeature('phone');
  const b = await readJson(req);
  if (!b.lineId) return fail('Choose a phone line.');
  const r = await simulateTurn(String(b.lineId), b.sessionId ? String(b.sessionId) : null, String(b.text ?? '').slice(0, 500));
  return ok({ reply: r.reply, call: { ...r.call, messages: undefined, pending: undefined } });
});
