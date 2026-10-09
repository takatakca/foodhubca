import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { fleetReadiness } from '@/lib/foodhub/delivery/dispatch';
import { getDeliverySettings, saveDeliverySettings } from '@/lib/foodhub/delivery/store';
import { ok, readJson } from '@/lib/foodhub/http';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Dispatch rules (fleet, quote comparison, tip, fee, per-kitchen auto-dispatch and area) and the fleets' state.
// `?reveal=1` (owner, same rule as Platforms & Clover → Show secrets) returns the two tokens the owner pastes elsewhere:
// the DoorDash Drive webhook token and the website order token. Fleet API keys are never returned.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const url = new URL(req.url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const reveal = url.searchParams.get('reveal') === '1' && can(actor.role, 'admin') && (Boolean(process.env.DASHBOARD_PASSWORD) || local);
  return ok({
    settings: await getDeliverySettings(), fleets: fleetReadiness(), baseUrl: publicBaseUrl(),
    secrets: reveal ? { driveWebhook: process.env.DOORDASH_DRIVE_WEBHOOK_SECRET || '', websiteOrder: process.env.FOODHUB_WEBSITE_ORDER_SECRET || '' } : null,
  });
});

export const PUT = withPerm('stores:map', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'delivery rules');
  if (gate) return gate;
  const b = await readJson(req);
  const settings = await saveDeliverySettings(b.settings ?? {});
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'delivery_rules', status: 'success',
    summary: `Own delivery rules saved — ${Object.entries(settings.locations).filter(([, r]) => r.enabled).map(([c, r]) => `${c}${r.autoDispatch ? ` (auto −${r.leadMinutes} min)` : ''}`).join(', ') || 'no kitchen on'}` });
  return ok({ settings, fleets: fleetReadiness() });
});
