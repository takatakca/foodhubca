import { handleFleetWebhook } from '@/lib/foodhub/delivery/webhook';

export const dynamic = 'force-dynamic';

// DoorDash Drive delivery events (Dasher assigned, at the store, picked up, delivered, cancelled, returned…).
// Developer Portal → Drive → Webhooks: this URL, authentication "Basic", header "Authorization",
// token = DOORDASH_DRIVE_WEBHOOK_SECRET (Settings → Expansion → Delivery shows it).
export async function POST(req: Request) {
  return handleFleetWebhook('doordash_drive', req);
}
