import { enableUberIntegration, fetchUberPosData, uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { activationMessage } from '@/lib/foodhub/adapters/uber-provision';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import type { ChannelResult } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// "Check with Uber": reads each mapped Uber store's pos_data — who receives its orders now (Food Hub, pending, or still
// UrbanPiper) and whether the order webhooks are on. Read-only, so it runs as soon as the Uber keys exist.
// { enable: true } also switches the order webhooks on where they are off (a change on Uber: needs the live switch).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const r = uberEatsAdapter.readiness();
  if (!r.configured) return fail(r.note, 409);
  if (b.enable === true && !r.canSend) return fail(`Switching the order webhooks on changes your Uber stores, so it needs the live switch: ${r.note}`, 409);
  const repo = getRepo();
  const ids: string[] | null = Array.isArray(b.storeIds) && b.storeIds.length ? b.storeIds.map(String) : null;
  const stores = (await repo.listStores('uber_eats')).filter((s) => !isRelayStore(s) && inScope(actor, s.locationCode) && (!ids || ids.includes(s.id)));
  const rows: Array<{ storeId: string; ok: boolean; orderManager: string | null; integrationEnabled: boolean | null; message: string }> = [];
  for (const s of stores) {
    let read = await fetchUberPosData(s.channelStoreId);
    let enabled: ChannelResult | null = null;
    if (b.enable === true && read.ok && read.state?.integrationEnabled === false) {
      enabled = await enableUberIntegration(s.channelStoreId);
      if (enabled.ok) read = await fetchUberPosData(s.channelStoreId);
    }
    if (read.ok && read.state) await repo.updateStore(s.id, { meta: { ...s.meta, uberPos: read.state } });
    rows.push({
      storeId: s.id, ok: read.ok, orderManager: read.state?.orderManager ?? null, integrationEnabled: read.state?.integrationEnabled ?? null,
      message: read.ok ? activationMessage({ result: { channel: 'uber_eats', ok: true, status: 'done', message: 'OK' }, enabled, pos: read.state ?? null })
        : read.httpStatus === 404 || read.httpStatus === 403 ? `Uber does not show this store to Food Hub (HTTP ${read.httpStatus}) — it is not activated for this app yet: “Connect Uber Eats”.` : read.error ?? 'Could not read the store from Uber.',
    });
  }
  const mine = rows.filter((x) => x.orderManager === 'foodhub').length;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_check', status: 'info', channel: 'uber_eats',
    summary: `Checked ${rows.length} Uber Eats store(s) with Uber: ${mine} send their orders to Food Hub${b.enable === true ? ' (order webhooks switched on where they were off)' : ''}` });
  return ok({ rows });
});
