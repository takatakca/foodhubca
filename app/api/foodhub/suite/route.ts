import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { suiteStatus } from '@/lib/foodhub/suite/bus';

export const dynamic = 'force-dynamic';

// Settings → Connected apps: each Clover suite app, connected or not, and its event deliveries (no secrets).
export const GET = withPerm('admin', async () => ok({ apps: await suiteStatus(), customerKeys: (process.env.FOODHUB_SUITE_CUSTOMER_SALT ?? '').trim().length >= 16 }));
