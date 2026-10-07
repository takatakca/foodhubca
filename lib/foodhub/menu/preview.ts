// Publish dry run: what a publish WOULD send to each store, and what that changes compared with what the store
// received last time — without sending anything. Per store: will it be sent (or why not: menu locked, platform not
// live, linked through Clover), how many categories / items / options, which items are new, gone, repriced, 86'd or
// back, a few sample prices, and the hours and holidays that go with it.
import { getAdapter } from '../adapters';
import { CHANNEL_MARKETPLACE } from '../config';
import { getHours, publishContext } from '../hours';
import { menuForLocation, storesFor } from '../ops';
import type { ChannelKey } from '../types';
import { getMenuLanguages } from './language';
import { menuLockOf } from './lock';
import { getBrandMenu } from './shared';
import { diffSnapshots, menuSnapshot, type MenuSnapshot, type SnapshotDiff } from './snapshot';
import { priceFor } from './translate';

export type PreviewSend = 'yes' | 'locked' | 'not_live' | 'via_clover';

export interface PreviewRow {
  storeId: string;
  brandName: string;
  channel: ChannelKey;
  locationCode: string;
  channelStoreId: string;
  send: PreviewSend;
  /** Why it would not be sent (lock reason, platform readiness note), in English and French. */
  reason?: string;
  reasonFr?: string;
  counts: { categories: number; items: number; available: number; unavailable: number; options: number };
  hoursSet: boolean;
  holidays: number;
  language: string;
  /** null = never published from Food Hub: everything is new to the platform. */
  diff: SnapshotDiff | null;
  lastPublishedAt: string | null;
  sample: Array<{ name: string; price: number }>;
}

export async function previewPublish(brands: string[], opts: { storeIds?: string[]; channels?: ChannelKey[]; locationCodes?: string[] } = {}): Promise<PreviewRow[]> {
  const hours = await getHours();
  const languages = await getMenuLanguages();
  const rows: PreviewRow[] = [];
  for (const brandName of brands) {
    const menu = await getBrandMenu(brandName);
    if (!menu) continue;
    const stores = await storesFor({ brandName, storeIds: opts.storeIds, channels: opts.channels, locationCodes: opts.locationCodes });
    for (const store of stores) {
      const ctx = await publishContext(brandName, store.locationCode, hours);
      const language = store.channel === 'tgtg' ? 'en' : languages[store.channel];
      const local = menuForLocation(menu, store.locationCode);
      const snap = menuSnapshot(local, store.channel, language);
      const prev = (store.meta?.lastPublished ?? null) as MenuSnapshot | null;
      const lock = menuLockOf(store);
      const readiness = getAdapter(store.channel).readiness();
      const send: PreviewSend = lock.locked ? 'locked' : readiness.viaClover ? 'via_clover' : readiness.canSend ? 'yes' : 'not_live';
      const items = Object.values(snap.items);
      const mk = CHANNEL_MARKETPLACE[store.channel];
      rows.push({
        storeId: store.id, brandName, channel: store.channel, locationCode: store.locationCode, channelStoreId: store.channelStoreId,
        send,
        ...(send === 'locked' ? { reason: lock.reason, reasonFr: lock.reasonFr } : send !== 'yes' ? { reason: readiness.note, reasonFr: readiness.noteFr ?? readiness.note } : {}),
        counts: { categories: snap.categories, items: items.length, available: items.filter((i) => i.a).length, unavailable: items.filter((i) => !i.a).length, options: Object.keys(snap.mods).length },
        hoursSet: Boolean(ctx.hours),
        holidays: ctx.holidays.length,
        language,
        diff: prev ? diffSnapshots(prev, snap) : null,
        lastPublishedAt: typeof store.meta?.lastPublishedAt === 'string' ? store.meta.lastPublishedAt : null,
        sample: local.items.filter((i) => i.available).slice(0, 4).map((i) => ({ name: snap.items[i.ref]?.n ?? i.name, price: priceFor(i, mk, local) })),
      });
    }
  }
  return rows;
}
