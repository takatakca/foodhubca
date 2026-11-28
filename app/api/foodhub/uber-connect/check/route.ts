import { enableUberIntegration, fetchUberPosData, uberEatsAdapter, type UberPosState } from '@/lib/foodhub/adapters/uber-eats';
import { UBER_LINK_STATUS_FIELDS, uberPosForStore, uberRoutingConfirmed } from '@/lib/foodhub/adapters/uber-link';
import { activationMessage } from '@/lib/foodhub/adapters/uber-provision';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo, type FoodHubRepo } from '@/lib/foodhub/repo';
import type { ChannelResult, ChannelStore } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function currentMapping(repo: FoodHubRepo, checked: ChannelStore): Promise<ChannelStore | null> {
  const current = await repo.getStore(checked.id);
  if (!current || current.channel !== checked.channel || current.channelStoreId !== checked.channelStoreId
    || current.locationCode !== checked.locationCode) return null;
  return UBER_LINK_STATUS_FIELDS.every((key) => current.meta[key] === checked.meta[key]) ? current : null;
}

async function saveCheckedState(repo: FoodHubRepo, checked: ChannelStore, state: UberPosState): Promise<UberPosState | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await currentMapping(repo, checked);
    if (!current) return null;
    const saved = uberPosForStore(current);
    if (saved?.checkedAt && saved.checkedAt > state.checkedAt) return saved;
    if (await repo.updateStore(current.id, { meta: { ...current.meta, uberPos: state } }, current)) return state;
  }
  return null;
}

const mappingChanged = { ok: false, error: 'The Uber mapping or connection changed while it was being checked. Check it again.' };

// "Check with Uber": reads each mapped Uber store's pos_data — who receives its orders now (Food Hub, pending, or still
// UrbanPiper) and whether the order webhooks are on. Read-only, so it runs as soon as the Uber keys exist.
// { enable: true } also switches the order webhooks on where they are off (a change on Uber: needs the live switch).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const enableWebhooks = b.enable === true;
  const r = uberEatsAdapter.readiness();
  if (!r.configured) return fail(r.note, 409);
  if (enableWebhooks && !r.canSend) return fail(`Switching the order webhooks on changes your Uber stores, so it needs the live switch: ${r.note}`, 409);
  const repo = getRepo();
  const ids: string[] | null = Array.isArray(b.storeIds) && b.storeIds.length ? b.storeIds.map(String) : null;
  const stores = (await repo.listStores('uber_eats')).filter((s) => !isRelayStore(s) && inScope(actor, s.locationCode) && (!ids || ids.includes(s.id)));
  const rows: Array<{ storeId: string; channelStoreId: string; ok: boolean; orderManager: UberPosState['orderManager'] | null; integrationEnabled: boolean | null; message: string }> = [];
  for (const s of stores) {
    let read = await fetchUberPosData(s.channelStoreId, { inspection: !enableWebhooks });
    let enabled: ChannelResult | null = null;
    if (enableWebhooks && read.ok && read.state?.integrationEnabled === false) {
      if (await currentMapping(repo, s)) {
        enabled = await enableUberIntegration(s.channelStoreId);
        if (enabled.ok) read = await fetchUberPosData(s.channelStoreId);
      } else read = mappingChanged;
    }
    if (read.ok && read.state) {
      const saved = await saveCheckedState(repo, s, read.state);
      read = saved ? { ...read, state: saved } : mappingChanged;
    }
    rows.push({
      storeId: s.id, channelStoreId: s.channelStoreId, ok: read.ok, orderManager: read.state?.orderManager ?? null, integrationEnabled: read.state?.integrationEnabled ?? null,
      message: read.ok ? activationMessage({ result: { channel: 'uber_eats', ok: true, status: 'done', message: 'OK' }, enabled, pos: read.state ?? null })
        : read.httpStatus === 404 || read.httpStatus === 403 ? `Uber does not show this store to Food Hub (HTTP ${read.httpStatus}) — it is not activated for this app yet: “Connect Uber Eats”.` : read.error ?? 'Could not read the store from Uber.',
    });
  }
  const confirmed = rows.filter((x) => x.ok && uberRoutingConfirmed(x)).length;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_check', status: 'info', channel: 'uber_eats',
    summary: `Checked ${rows.length} Uber Eats store(s): ${confirmed} report Food Hub as order manager with order webhooks enabled${enableWebhooks ? ' (requested enabling where Uber reported them off)' : ''}` });
  return ok({ rows });
});
