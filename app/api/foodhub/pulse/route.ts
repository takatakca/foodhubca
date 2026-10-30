import { after } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { tickExpansion } from '@/lib/foodhub/expansion/tick';
import { tickCloverWebsiteOrders } from '@/lib/foodhub/pos/clover-website-orders';
import { tickCloverRegister } from '@/lib/foodhub/mev/clover-register';
import { tickTgtgEmail } from '@/lib/foodhub/tgtg-email/imap';
import { tickAvailability } from '@/lib/foodhub/store-availability/tick';
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
  // Clover retries and the webhook inbox first (an order recovered now is not an alarm), then the Watchtower, then the
  // expansion features' own heartbeat (courier auto-dispatch…), only once the Watchtower run is done; then the mirror of
  // the website orders Clover Online Ordering took (throttled; Clover stays the source of truth).
  after(async () => {
    await runOrderRecovery({ trigger: 'pulse' }).catch(() => undefined);
    await runWatch({ trigger: 'pulse' }).catch(() => undefined);
    await tickExpansion();
    await tickCloverWebsiteOrders();
    // Clover register sales → Takatak MEV invoices (FOODHUB_MEV_CLOVER_REGISTER=on only; throttled catch-up poll).
    await tickCloverRegister();
    // Too Good To Go order e-mails (throttled to TGTG_IMAP_POLL_S; nothing when no mailbox is configured).
    await tickTgtgEmail();
    // Store availability center: busy schedule + tablet-off guard (at most every 30 s, never throws).
    await tickAvailability();
  });
  return ok({ ...(await buildPulse({ locationCodes: scope.length ? scope : actor.locations.length ? ['__none__'] : undefined })) });
});
