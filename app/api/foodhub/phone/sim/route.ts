import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { simulateCall, type SimInput } from '@/lib/foodhub/phone/sim/driver';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Call simulator (dry run): a whole call through the real phone handlers — the ON2GO menu or an AI ordering line —
// with the caller's words or keys typed in the console. Nothing is sent (texts, emails, team chat are only recorded),
// no order reaches Clover, the kitchen or a payment link. Only the AI is called for real (when its key is set).
export const POST = withPerm('menu:edit', async (req) => {
  const b = await readJson(req);
  const target = String(b.target ?? '').trim();
  if (!target) return fail('Choose the ON2GO menu or a phone line.');
  const raw: unknown[] = Array.isArray(b.inputs) ? b.inputs.slice(0, 20) : [];
  const inputs: SimInput[] = raw.map((x) => (x && typeof x === 'object' ? x as Record<string, unknown> : {})).map((x) => ({
    ...(typeof x.speech === 'string' ? { speech: x.speech.slice(0, 500) } : {}),
    ...(typeof x.digits === 'string' ? { digits: x.digits.slice(0, 30) } : {}),
  }));
  try {
    return ok({ ...(await simulateCall({ target, inputs, from: typeof b.from === 'string' ? b.from.slice(0, 20) : undefined, dial: b.dial === 'nobody' ? 'nobody' : 'answered' })) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
