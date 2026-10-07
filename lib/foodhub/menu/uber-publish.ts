// One click: the master menu (shared by every brand, or each brand's own) → every mapped Uber Eats store, minus the
// stores marked "Do not touch". The plan is a dry run: it builds exactly the PUT /v2/eats/stores/{id}/menus body each
// store would receive and checks it, without calling Uber. Publishing goes through publishMenu (same logging, same
// Do-not-touch guard, same live switch), so nothing is ever shown as sent unless Uber answered OK.
import { type Actor } from '../activity';
import { uberEatsAdapter } from '../adapters/uber-eats';
import { isRelayStore } from '../adapters/relay';
import { result } from '../config';
import { getHours, publishContext } from '../hours';
import { isDoNotTouch, menuForLocation, publishMenu, type FanOutRow } from '../ops';
import { getRepo } from '../repo';
import type { ChannelStore, HoursConfig, MasterMenu } from '../types';
import { getMenuLanguages } from './language';
import { getBrandMenu, getMenuSharing, sourceOf, type MenuSharing } from './shared';
import { checkUberMenu, markupPct, priceFor, toUberMenu, type UberMenuIssue } from './translate';
import { verifyMenu } from './verify';

export type UberPlanSkip = 'do_not_touch' | 'no_menu' | 'menu_errors';

export interface UberPlanRow {
  storeId: string;
  channelStoreId: string;
  brandName: string;
  locationCode: string;
  /** Brand whose stored menu is used (the shared menu's brand, or the brand itself). */
  menuFrom: string | null;
  action: 'publish' | 'skip';
  skip?: UberPlanSkip;
  /**
   * Uber confirmed the activation (store.provisioned or pos_data), Food Hub is waiting for it, another integration
   * (UrbanPiper) still receives the store's orders, Uber disconnected it, or it was mapped by hand.
   */
  provisioning: 'confirmed' | 'waiting' | 'elsewhere' | 'disconnected' | 'unknown';
  counts: { menus: number; categories: number; items: number; suspended: number; modifierGroups: number; modifierOptions: number } | null;
  markupPct: number;
  /** A few items: base (Clover) price → price on Uber. */
  samples: Array<{ name: string; base: number; uber: number }>;
  hoursSet: boolean;
  holidays: number;
  issues: UberMenuIssue[];
}

export interface UberPlan {
  canSend: boolean;
  note: string;
  rows: UberPlanRow[];
  summary: { stores: number; publish: number; doNotTouch: number; blocked: number };
}

/** Activation state: Uber's store.provisioned webhook, or what "Check with Uber" read from pos_data (meta.uberPos). */
function provisioning(store: ChannelStore): UberPlanRow['provisioning'] {
  const manager = (store.meta?.uberPos as { orderManager?: string } | undefined)?.orderManager;
  if (store.meta?.provisioned === false) return 'disconnected';
  if (manager === 'other') return 'elsewhere';
  if (store.meta?.provisioned === true || manager === 'foodhub' || manager === 'pending') return 'confirmed';
  return store.meta?.awaitingProvision === true ? 'waiting' : 'unknown';
}

/** Uber stores an actor may publish to (relay stores never receive a menu; a manager only sees their locations). */
async function uberStores(scope: { storeIds?: string[]; locations?: string[] } = {}) {
  return (await getRepo().listStores('uber_eats')).filter((s) => !isRelayStore(s)
    && (!scope.storeIds?.length || scope.storeIds.includes(s.id))
    && (!scope.locations?.length || scope.locations.includes(s.locationCode)));
}

/** The exact Uber menu body one store would receive now (what "View JSON" shows). */
export async function uberPayloadFor(store: ChannelStore, ctx: { sharing?: MenuSharing; hours?: HoursConfig } = {}) {
  const menu = await getBrandMenu(store.brandName, ctx.sharing);
  if (!menu) return null;
  const languages = await getMenuLanguages();
  const pctx = { ...(await publishContext(store.brandName, store.locationCode, ctx.hours ?? await getHours())), language: languages.uber_eats };
  return { menu, ctx: pctx, body: toUberMenu(menuForLocation(menu, store.locationCode), pctx) };
}

function planRow(store: ChannelStore, menu: MasterMenu | null, menuFrom: string | null, built: Awaited<ReturnType<typeof uberPayloadFor>>, stores: ChannelStore[], hours: HoursConfig): UberPlanRow {
  const base = { storeId: store.id, channelStoreId: store.channelStoreId, brandName: store.brandName, locationCode: store.locationCode, menuFrom, provisioning: provisioning(store) };
  if (!menu || !built) return { ...base, action: 'skip', skip: 'no_menu', counts: null, markupPct: 0, samples: [], hoursSet: false, holidays: 0, issues: [{ level: 'error', code: 'no_menu', message: `No master menu saved for ${store.brandName}${menuFrom && menuFrom !== store.brandName ? ` (it follows ${menuFrom})` : ''}.` }] };
  const body = built.body;
  const check = verifyMenu(menu, { stores, hours });
  const issues: UberMenuIssue[] = [...check.errors, ...checkUberMenu(body)];
  if (provisioning(store) === 'waiting') issues.push({ level: 'warning', code: 'awaiting_provision', message: 'Uber has not confirmed this store’s activation yet (store.provisioned) — Uber refuses the menu until it does.' });
  if (provisioning(store) === 'elsewhere') issues.push({ level: 'warning', code: 'other_integration', message: 'Another integration (e.g. UrbanPiper) still receives this store’s orders and may overwrite this menu — consider “Do not touch” until it lets go (Stores → Check with Uber).' });
  if (provisioning(store) === 'disconnected') issues.push({ level: 'warning', code: 'deprovisioned', message: 'Uber disconnected this store from Food Hub (store.deprovisioned) — reconnect it under Stores before publishing.' });
  if (!built.ctx.hours) issues.push({ level: 'warning', code: 'no_hours', message: 'No store hours set — Uber would show the store open 24/7. Set them in Stores → Hours.' });
  const pct = markupPct(menu, 'uber_eats');
  if (!pct && !menu.items.some((i) => typeof i.channelPrices?.uber_eats === 'number')) issues.push({ level: 'warning', code: 'no_markup', message: 'No Uber Eats markup: Uber prices would equal the in-store (Clover) prices. Your Uber stores sell at +20% today — set it in Menus → Prices by platform.' });
  const optionIds = new Set(body.modifier_groups.flatMap((g) => g.modifier_options.map((o) => o.id)));
  const sellable = body.items.filter((i) => !optionIds.has(i.id));
  const blocked = issues.some((i) => i.level === 'error');
  return {
    ...base,
    action: isDoNotTouch(store) || blocked ? 'skip' : 'publish',
    ...(isDoNotTouch(store) ? { skip: 'do_not_touch' as const } : blocked ? { skip: 'menu_errors' as const } : {}),
    counts: {
      menus: body.menus.length, categories: body.categories.length, items: sellable.length,
      suspended: sellable.filter((i) => 'suspension_info' in i).length, modifierGroups: body.modifier_groups.length, modifierOptions: optionIds.size,
    },
    markupPct: pct,
    samples: menu.items.filter((i) => i.price > 0).slice(0, 4).map((i) => ({ name: i.name, base: i.price, uber: priceFor(i, 'uber_eats', menu) })),
    hoursSet: Boolean(built.ctx.hours),
    holidays: built.ctx.holidays.length,
    issues,
  };
}

/** Dry run: what "Publish to all Uber stores" would send, store by store. Calls nothing on Uber. */
export async function planUberPublish(scope: { storeIds?: string[]; locations?: string[] } = {}): Promise<UberPlan> {
  const [stores, allStores, sharing, hours] = await Promise.all([uberStores(scope), getRepo().listStores(), getMenuSharing(), getHours()]);
  const rows: UberPlanRow[] = [];
  for (const store of stores) {
    const built = await uberPayloadFor(store, { sharing, hours });
    rows.push(planRow(store, built?.menu ?? null, sourceOf(sharing, store.brandName), built, allStores, hours));
  }
  rows.sort((a, b) => (a.locationCode + a.brandName).localeCompare(b.locationCode + b.brandName, 'fr'));
  const r = uberEatsAdapter.readiness();
  return {
    canSend: r.canSend,
    note: r.note,
    rows,
    summary: { stores: rows.length, publish: rows.filter((x) => x.action === 'publish').length, doNotTouch: rows.filter((x) => x.skip === 'do_not_touch').length, blocked: rows.filter((x) => x.skip === 'no_menu' || x.skip === 'menu_errors').length },
  };
}

/**
 * Publishes to every Uber store the plan marks "publish" (optionally only `storeIds`), one brand at a time.
 * Do-not-touch and blocked stores are returned as skipped rows — never sent.
 */
export async function publishAllUber(opts: { storeIds?: string[]; locations?: string[]; actor?: Actor } = {}): Promise<{ plan: UberPlan; results: FanOutRow[] }> {
  const plan = await planUberPublish({ storeIds: opts.storeIds, locations: opts.locations });
  const go = plan.rows.filter((r) => r.action === 'publish');
  const results: FanOutRow[] = [];
  for (const brand of [...new Set(go.map((r) => r.brandName))]) {
    results.push(...(await publishMenu(brand, { storeIds: go.filter((r) => r.brandName === brand).map((r) => r.storeId), channels: ['uber_eats'], actor: opts.actor })));
  }
  // Do not touch = the owner's choice ('skipped'); a menu that cannot be published = 'blocked'. Neither reached Uber.
  for (const r of plan.rows.filter((x) => x.action === 'skip')) {
    const res = r.skip === 'do_not_touch'
      ? result('uber_eats', 'skipped', 'Not sent: this store is marked “Do not touch”.')
      : result('uber_eats', 'blocked', `Not sent: ${r.issues.find((i) => i.level === 'error')?.message ?? 'the menu has errors'}`);
    results.push({ storeId: r.storeId, channel: 'uber_eats', channelStoreId: r.channelStoreId, brandName: r.brandName, locationCode: r.locationCode, result: res });
  }
  return { plan, results };
}
