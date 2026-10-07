import { after } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { buildPulse } from '@/lib/foodhub/pulse';
import { runOrderRecovery } from '@/lib/foodhub/recovery';
import { runWatch } from '@/lib/foodhub/watch/engine';

export const dynamic = 'force-dynamic';

// Polled every few seconds by every open screen. ?locations=A,B narrows it (people limited to some
// locations only ever see theirs). After answering, the Watchtower gets its heartbeat (throttled).
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const wanted = (q.get('locations') || '').split(',').filter(Boolean);
  const scope = actor.locations.length ? (wanted.length ? wanted.filter((c) => actor.locations.includes(c)) : actor.locations) : wanted;
  // Clover retries and the webhook inbox first (an order recovered now is not an alarm), then the Watchtower.
  after(async () => {
    await runOrderRecovery({ trigger: 'pulse' }).catch(() => undefined);
    await runWatch({ trigger: 'pulse' }).catch(() => undefined);
  });
  return ok({ ...(await buildPulse({ locationCodes: scope.length ? scope : actor.locations.length ? ['__none__'] : undefined })) });
});
