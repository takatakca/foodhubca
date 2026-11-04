import { withPerm } from '@/lib/foodhub/auth';
import { controlPlaneStatus } from '@/lib/foodhub/control-plane/status';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
// Existing connected-apps administration permission. No client selectors, transport proxy or credential writes.
export const GET = withPerm('admin', async () => ok({ controlPlane: await controlPlaneStatus() }));
