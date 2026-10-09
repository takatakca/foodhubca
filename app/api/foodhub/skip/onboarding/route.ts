import { skipReadiness } from '@/lib/foodhub/adapters/skip';
import { withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { configureSkipOnboarding, goLiveSkipOnboarding, listSkipOnboarding, startSkipOnboarding } from '@/lib/foodhub/skip-ops';
import type { ChannelResult } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const reply = (res: ChannelResult, extra: Record<string, unknown> = {}) => (res.ok ? ok({ result: res, ...extra }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res }));

// JET Connect partner onboarding, step by step (the JET location id comes from the Skip account manager):
//   GET                                                               sessions and where each stands
//   POST { action: "start", market, jetLocationId, posLocationId? }   JET claims the location for Food Hub
//   POST { action: "configure", sessionId, posLocationId, orderUrl? } sends the catalogue and order addresses
//   POST { action: "go-live", posLocationId }                         asks for activation
// A location that is live with another integrator answers 409: Skip must release it first.
export const GET = withPerm('stores:map', async () => {
  const state = await listSkipOnboarding();
  const r = skipReadiness();
  return ok({ ...state, ready: r.canSend, note: r.note, notificationUrl: `${publicBaseUrl()}/api/foodhub/webhooks/skip/onboarding`, signed: Boolean(process.env.SKIP_ONBOARDING_HMAC_SECRET) });
});

export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const action = String(b.action ?? '');
  if (action === 'start') {
    if (!b.market || !b.jetLocationId) return fail('market (two letters) and jetLocationId are required');
    return reply(await startSkipOnboarding({ market: String(b.market), jetLocationId: String(b.jetLocationId), posLocationId: b.posLocationId ? String(b.posLocationId) : undefined }, actor));
  }
  if (action === 'configure') {
    if (!b.sessionId || !b.posLocationId) return fail('sessionId and posLocationId are required');
    const orderUrl = String(b.orderUrl || process.env.SKIP_ONBOARDING_ORDER_URL || `${publicBaseUrl()}/api/foodhub/webhooks/skip/orders`);
    return reply(await configureSkipOnboarding(String(b.sessionId), { catalogueLocationId: String(b.posLocationId), order: { orderInjectionUrl: orderUrl, locationId: String(b.posLocationId) } }, actor), { orderUrl });
  }
  if (action === 'go-live') {
    if (!b.posLocationId) return fail('posLocationId is required');
    return reply(await goLiveSkipOnboarding(String(b.posLocationId), actor));
  }
  return fail('action must be start, configure or go-live');
});
