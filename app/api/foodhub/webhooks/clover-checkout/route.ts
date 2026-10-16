import { notePaymentDeclined, LAST_WEBHOOK_KEY, orderIdForSession, releasePaidOrder } from '@/lib/foodhub/delivery/paylink';
import { ecommMerchants, hcoWebhookSecret, parseHostedCheckoutEvent, verifyCloverSignature } from '@/lib/foodhub/pos/clover-checkout';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY = 64 * 1024;

// Clover Hosted Checkout webhook (Clover dashboard → Settings → Ecommerce → Hosted Checkout → Webhook URL =
// <FOODHUB_PUBLIC_URL>/api/foodhub/webhooks/clover-checkout, signing secret in CLOVER_HCO_WEBHOOK_SECRET).
//   - signature first (Clover-Signature, HMAC-SHA256, 5-minute window): 401 when wrong, 503 when the secret is missing;
//   - only PAYMENT events of merchants with a Hosted Checkout key;
//   - a session Food Hub created → its held order is released exactly once (paylink.ts); a session it did not create
//     (the brand website's own checkout on the same merchant) is forwarded untouched to CLOVER_HCO_FORWARD_URL;
//   - 503 when Clover could not be read yet: Clover sends the event again, and the poller catches it anyway.
export async function POST(req: Request) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return new Response('Payload too large', { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('Payload too large', { status: 413 });
  const signature = req.headers.get('clover-signature');
  const check = verifyCloverSignature(raw, signature, hcoWebhookSecret());
  if (check !== 'ok') {
    if (check === 'missing_secret') return new Response('Webhook not configured', { status: 503 });
    return new Response('Rejected', { status: 401 });
  }
  const event = parseHostedCheckoutEvent(raw);
  if (!event || event.type !== 'PAYMENT' || !event.sessionId) return Response.json({ received: true, ignored: true });
  if (event.merchantId && !ecommMerchants().includes(event.merchantId)) return new Response('Unknown merchant', { status: 401 });
  await getRepo().setKv(LAST_WEBHOOK_KEY, { at: new Date().toISOString(), status: event.status }).catch(() => undefined);

  const orderId = await orderIdForSession(event.sessionId);
  if (!orderId) return forward(raw, signature);

  if (event.status === 'APPROVED' && event.paymentId) {
    // Replays are harmless (the release is idempotent); this key only saves work.
    const key = `hco_evt:${event.paymentId}:APPROVED`;
    if (await getRepo().getKv<string>(key).catch(() => null)) return Response.json({ received: true, duplicate: true });
    const r = await releasePaidOrder(orderId, { paymentId: event.paymentId, via: 'webhook' });
    if (r.state === 'retry' || r.state === 'pending') return new Response('Payment not readable yet', { status: 503, headers: { 'Retry-After': '30' } });
    await getRepo().setKv(key, new Date().toISOString()).catch(() => undefined);
    return Response.json({ received: true, state: r.state });
  }
  if (event.status === 'DECLINED') {
    await notePaymentDeclined(orderId, event.paymentId);
    return Response.json({ received: true, state: 'declined' });
  }
  return Response.json({ received: true, ignored: true });
}

/** A session Food Hub did not create: passed on untouched (same body, same signature) when a forward URL is set. */
async function forward(raw: string, signature: string | null): Promise<Response> {
  const url = process.env.CLOVER_HCO_FORWARD_URL?.trim();
  if (!url || !/^https:\/\//.test(url)) return Response.json({ received: true, ours: false });
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'Clover-Signature': signature } : {}) }, body: raw, signal: AbortSignal.timeout(10_000) });
    return new Response(res.ok ? 'Forwarded' : 'Forward refused', { status: res.ok ? 200 : 502 });
  } catch {
    return new Response('Forward failed', { status: 502 });
  }
}
