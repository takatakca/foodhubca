import crypto from 'node:crypto';
import { isChannelKey } from '@/lib/foodhub/adapters';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { getHours } from '@/lib/foodhub/hours';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { cancelScheduled, listScheduled, schedulePublish, type ScheduledPublish } from '@/lib/foodhub/menu/schedule';
import { getMenuLanguages } from '@/lib/foodhub/menu/language';
import { getBrandMenu, getMenuSharing, groupOf } from '@/lib/foodhub/menu/shared';
import { previewPublish } from '@/lib/foodhub/menu/preview';
import { verifyMenu } from '@/lib/foodhub/menu/verify';
import { publishMenu, type FanOutRow } from '@/lib/foodhub/ops';
import { getRepo } from '@/lib/foodhub/repo';
import type { ChannelKey } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

// Publish status for a brand: verification result, latest result per mapped store, scheduled publishes.
export const GET = withPerm('menu:edit', async (req) => {
  const brand = new URL(req.url).searchParams.get('brand');
  if (!brand) return fail('brand is required');
  const repo = getRepo();
  const sharing = await getMenuSharing();
  // Relay stores ("relay:<id>") receive orders only — a menu is never sent to them, so they are not listed here.
  const [menu, allStores, jobs, hours] = await Promise.all([getBrandMenu(brand, sharing), repo.listStores(), repo.listJobs(500), getHours()]);
  const stores = allStores.filter((s) => !isRelayStore(s));
  const mine = stores.filter((s) => s.brandName === brand);
  // Jobs fill up fast with 86 toggles; when a store's last publish is older than the job window, fall back to
  // the activity log (publishes are rare there) so a live, published menu never shows as "never".
  const publishes = mine.some((s) => !jobs.some((j) => j.kind === 'menu_push' && j.request?.storeId === s.id))
    ? (await repo.listActivity({ kinds: ['menu_publish'], limit: 500 }).catch(() => [])).filter((a) => a.action === 'publish' && a.storeId)
    : [];
  const status = mine.map((s) => {
    const job = jobs.find((j) => j.kind === 'menu_push' && j.request?.storeId === s.id);
    if (job) return { storeId: s.id, channel: s.channel, locationCode: s.locationCode, channelStoreId: s.channelStoreId, status: job.status, at: job.updatedAt, message: (job.result as { message?: string } | undefined)?.message ?? null };
    const act = publishes.find((a) => a.storeId === s.id);
    const res = (act?.detail as { result?: { status?: string; message?: string } } | undefined)?.result;
    const st = res?.status === 'queued' ? 'queued' : res?.status === 'done' ? 'done' : act ? 'error' : 'never';
    return { storeId: s.id, channel: s.channel, locationCode: s.locationCode, channelStoreId: s.channelStoreId, status: st, at: act?.at ?? null, message: res?.message ?? null };
  });
  // group = every brand publishing this same menu (the dialog offers to publish them all at once).
  // Scheduled publishes of every brand sharing this menu (an "all brands" schedule shows — and cancels — as one group).
  const group = groupOf(sharing, brand);
  const scheduled = (await listScheduled()).filter((s) => group.includes(s.brand));
  return ok({ check: menu ? verifyMenu(menu, { stores, hours, languages: await getMenuLanguages() }) : null, stores: status, scheduled, group });
});

// Publish now, or schedule (body.at = ISO date-time). Verification errors block the publish.
// allBrands: true → publish for every brand that shares this brand's menu (store selection is then ignored).
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.brand) return fail('brand is required');
  const brand = String(b.brand);
  const repo = getRepo();
  const sharing = await getMenuSharing();
  const brands = b.allBrands === true ? groupOf(sharing, brand) : [brand];
  const stores = (await repo.listStores()).filter((s) => !isRelayStore(s));
  const hours = await getHours();
  let check: ReturnType<typeof verifyMenu> | undefined;
  for (const name of brands) {
    const menu = await getBrandMenu(name, sharing);
    if (!menu) return fail(`No master menu saved for ${name}. Import from Clover or create items first.`, 409);
    const c = verifyMenu(menu, { stores, hours });
    if (name === brand) check = c;
    // A dry run still answers (with the check): it shows what blocks the publish next to what it would send.
    if (!c.ok && b.dryRun !== true) return fail(`Fix ${c.errors.length} error(s) before publishing${brands.length > 1 ? ` ${name}` : ''}: ${c.errors.slice(0, 3).map((e) => e.message).join(' ')}`, 422, { check: c });
  }
  const channels = (Array.isArray(b.channels) ? b.channels : []).filter((c: string) => isChannelKey(c)) as ChannelKey[];
  let storeIds: string[] | undefined = brands.length === 1 && Array.isArray(b.storeIds) && b.storeIds.length ? b.storeIds.map(String) : undefined;
  const label = brands.join(', ');
  // A manager limited to some locations only publishes to the stores at those locations.
  if (actor.locations.length) {
    storeIds = stores.filter((s) => brands.includes(s.brandName) && actor.locations.includes(s.locationCode) && (!storeIds || storeIds.includes(s.id))).map((s) => s.id);
    if (!storeIds.length) return fail(`No ${label} stores at your locations.`, 403);
  }
  if (!stores.some((s) => brands.includes(s.brandName) && (!storeIds || storeIds.includes(s.id)))) return fail(`No stores are mapped for ${label}. Map them in Food Hub → Stores first.`, 409);
  // Dry run: what each store would receive and what changes — nothing is sent, so no approval is needed.
  if (b.dryRun === true) {
    const targets = brands.filter((name) => stores.some((s) => s.brandName === name && (!storeIds || storeIds.includes(s.id))));
    const ids = (name: string) => storeIds?.filter((id) => stores.some((s) => s.id === id && s.brandName === name));
    const preview = (await Promise.all(targets.map((name) => previewPublish([name], { storeIds: ids(name), channels: channels.length ? channels : undefined })))).flat();
    return ok({ dryRun: true, preview, check });
  }
  const gate = await approvalGate(req, actor, 'menu.publish', null, label);
  if (gate) return gate;
  // Brands without a mapped store (in scope) are skipped rather than failing the whole publish.
  const targets = brands.filter((name) => stores.some((s) => s.brandName === name && (!storeIds || storeIds.includes(s.id))));
  if (b.at) {
    try {
      const scheduled: ScheduledPublish[] = [];
      const groupId = targets.length > 1 ? crypto.randomUUID() : undefined;
      for (const name of targets) {
        const ids = storeIds?.filter((id) => stores.some((s) => s.id === id && s.brandName === name));
        scheduled.push(await schedulePublish({ brand: name, storeIds: ids, channels: channels.length ? channels : undefined, at: String(b.at), groupId }, actor));
      }
      return ok({ scheduled: scheduled[0], scheduledAll: scheduled, check });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
  const results: FanOutRow[] = [];
  for (const name of targets) {
    const ids = storeIds?.filter((id) => stores.some((s) => s.id === id && s.brandName === name));
    results.push(...(await publishMenu(name, { storeIds: ids, channels, actor })));
  }
  const okCount = results.filter((r) => r.result.ok).length;
  const blockedCount = results.filter((r) => r.result.status === 'blocked').length;
  return ok({ results, check, okCount, blockedCount, errorCount: results.length - okCount - blockedCount });
});

export const DELETE = withPerm('menu:edit', async (req, _ctx, actor) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('id is required');
  if (!(await cancelScheduled(id, actor))) return fail('No scheduled publish with that id (it may already have run).', 404);
  return ok();
});
