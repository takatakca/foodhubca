import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { runWatch } from '@/lib/foodhub/watch/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Check now" on the Alerts screen.
export const POST = withPerm('view', async () => ok({ report: await runWatch({ trigger: 'manual', force: true }) }));
