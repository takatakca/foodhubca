import { handleFleetWebhook } from '@/lib/foodhub/delivery/webhook';

export const dynamic = 'force-dynamic';

// Uber Direct delivery status and courier updates, signed with the webhook signing key (UBER_DIRECT_WEBHOOK_SECRET).
export async function POST(req: Request) {
  return handleFleetWebhook('uber_direct', req);
}
