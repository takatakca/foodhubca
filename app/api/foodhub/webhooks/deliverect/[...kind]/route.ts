import { NextResponse, type NextRequest } from 'next/server';
import { verifyDeliverectWebhook } from '@/lib/foodhub/adapters/deliverect';
import {
  applyDeliverectCancel, classifyDeliverectOrder, deliverectTaxCalculation, handleDeliverectKdsProducts, handleDeliverectKdsRegister, handleDeliverectProductSyncCallback, handleDeliverectRegister,
  handleDeliverectReporting, handleDeliverectRetailEvent, handleDeliverectStoreStatus, keepDeliverectEvent, pushDeliverectProducts, validateDeliverectCart,
} from '@/lib/foodhub/deliverect-ops';
import { getRepo } from '@/lib/foodhub/repo';
import { background, keepUnparsed, parseJson, queueOrder, retryLater } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Every webhook Deliverect (Too Good To Go's POS partner) calls, on one address: /api/foodhub/webhooks/deliverect/<kind>
//   register · orders · sync-products (GET) · sync-tables (GET) · sync-floors (GET) · tax-calculation · validate-order
//   store-status · reporting · product-sync-callback · kds/register · kds/orders · kds/order-status · kds/product-update
//   retail/events · retail/amendments · retail/substitutes/<channelOrderId>/<plu> (GET)
// Signed with x-server-authorization-hmac-sha256 (hex HMAC-SHA256 of the raw body; empty for GET) or the ?token= Food Hub
// put in the URLs it returned at registration. Deliverect wants the answer fast: work continues after the response.
type Ctx = { params: Promise<{ kind: string[] }> };

const ok = (body: unknown = { ok: true }, status = 200) => NextResponse.json(body, { status });
const noContent = () => new NextResponse(null, { status: 204 });
const deny = () => NextResponse.json({ ok: false, error: 'Deliverect webhook check failed.' }, { status: 401 });

async function handle(req: NextRequest, ctx: Ctx, method: 'GET' | 'POST'): Promise<Response> {
  const kind = (await ctx.params).kind.join('/');
  const url = new URL(req.url);
  const raw = method === 'GET' ? '' : await req.text();
  const body = method === 'GET' ? undefined : parseJson(raw);
  if (!verifyDeliverectWebhook(req.headers, raw, url, body)) return deny();
  if (method === 'POST' && body === undefined) return ok({ ok: false, error: 'Invalid JSON' }, 400);

  switch (`${method} ${kind}`) {
    case 'POST register': {
      const urls = await handleDeliverectRegister(body);
      return urls ? ok(urls) : ok({ ok: false, error: 'locationId is required' }, 400);
    }
    case 'POST kds/register': {
      const urls = handleDeliverectKdsRegister(body);
      return urls ? ok(urls) : ok({ ok: false, error: 'locationId is required' }, 400);
    }
    case 'POST orders': case 'POST kds/orders': {
      const outcome = classifyDeliverectOrder(body);
      if (outcome.kind === 'cancel') {
        background(`deliverect cancel ${outcome.deliverectOrderId}`, () => applyDeliverectCancel(outcome.deliverectOrderId, body), { channel: 'tgtg', body, reference: outcome.externalOrderId, kind: 'order' });
        return ok();
      }
      if (outcome.kind === 'ignored') {
        background('keep ignored deliverect order', () => keepUnparsed('tgtg', body, `Deliverect: ${outcome.reason}`, body?._id ? String(body._id) : null));
        return ok({ ok: true, ignored: outcome.reason });
      }
      if (!(await queueOrder(outcome.order))) return retryLater('tgtg');
      return ok();
    }
    case 'GET sync-products': {
      const location = url.searchParams.get('locationID') || url.searchParams.get('locationId') || '';
      // 204 = "I will send the products to Insert Products myself" (the asynchronous way).
      background(`deliverect sync ${location}`, () => pushDeliverectProducts(location));
      return noContent();
    }
    case 'GET sync-tables': return ok({ tables: [{ id: 'DLVY', name: 'delivery' }] });
    case 'GET sync-floors': return ok({ floors: [] });
    case 'POST tax-calculation': return ok(deliverectTaxCalculation(body));
    case 'POST validate-order': return ok(await validateDeliverectCart(body));
    case 'POST store-status': {
      await handleDeliverectStoreStatus(body);
      return ok();
    }
    case 'POST reporting': {
      background('deliverect reporting', () => handleDeliverectReporting(body), { channel: 'tgtg', body, kind: 'order' });
      return ok();
    }
    case 'POST product-sync-callback': {
      background('deliverect product sync callback', () => handleDeliverectProductSyncCallback(body));
      return ok();
    }
    case 'POST kds/order-status': {
      background('deliverect kds order status', () => keepDeliverectEvent('kds-order-status', body, String(body?.orderId ?? '') || null));
      return ok();
    }
    case 'POST kds/product-update': {
      background('deliverect kds product update', () => handleDeliverectKdsProducts(body));
      return ok();
    }
    case 'POST retail/events': case 'POST retail/amendments': {
      const which = kind === 'retail/events' ? 'events' : 'amendments';
      background(`deliverect retail ${which}`, () => handleDeliverectRetailEvent(which, body));
      return ok();
    }
    default: {
      // GET retail/substitutes/<channelOrderId>/<plu>: Food Hub offers no substitute items.
      if (method === 'GET' && /^retail\/substitutes\/[^/]+\/[^/]+$/.test(kind)) return ok({ substituteItems: [] });
      // Never lost: an unknown kind is kept for support.
      await getRepo().addJob({ kind: 'webhook_unparsed', channel: 'tgtg', reference: null, status: 'error', request: { body: (body ?? {}) as Record<string, unknown> }, result: { reason: `Deliverect: unknown webhook "${kind}"` } }).catch(() => undefined);
      return ok({ ok: false, error: `Unknown Deliverect webhook "${kind}"` }, 404);
    }
  }
}

export async function GET(req: NextRequest, ctx: Ctx) { return handle(req, ctx, 'GET'); }
export async function POST(req: NextRequest, ctx: Ctx) { return handle(req, ctx, 'POST'); }
