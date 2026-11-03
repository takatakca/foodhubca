import { whatsappRoute } from '@/lib/foodhub/phone/whatsapp';

export const dynamic = 'force-dynamic';

// Twilio → Messaging → WhatsApp sender → "When a message comes in": Webhook, this URL, HTTP POST.
// Requests are signed with the token of the account that owns the number (FOODHUB_WHATSAPP_AUTH_TOKEN, else TWILIO_AUTH_TOKEN).
export async function POST(req: Request) {
  return whatsappRoute(req);
}
