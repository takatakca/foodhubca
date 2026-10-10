import { handleFleetWebhook } from '@/lib/foodhub/delivery/webhook';

export const dynamic = 'force-dynamic';

// Skip Delivery (Delivery as a Service) events: COURIERJOBSTATUS, CANCELJOBSTATUS, COURIERCOLLECTIONTIME, DELIVERYCREATED,
// COURIERLOCATION, DELIVERYREJECTED, COURIERDELIVERYTIME, PROOFOFDELIVERY, PROOFOFDELIVERY_PICTURE.
// Skip sends the secret registered with notification-config back as x-api-key (or Basic). It does not retry: answer fast.
export async function POST(req: Request) {
  return handleFleetWebhook('skip_daas', req);
}
