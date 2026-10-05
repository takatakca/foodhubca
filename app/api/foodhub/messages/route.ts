import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { channelsStatus, listOutbox } from '@/lib/foodhub/notify';

export const dynamic = 'force-dynamic';

// Everything the system sent (SMS, calls, emails, chat), recipients masked. Sign-in codes are never stored.
export const GET = withPerm('stores:map', async () => ok({ messages: await listOutbox(300), channels: channelsStatus() }));
