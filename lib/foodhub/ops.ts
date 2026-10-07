// Operations fan-out: one click in the dashboard → every connected channel.
// Every action is logged in the activity log (who, what, where, result) — Atlas "Store Action Report".
import { logActivity, resultStatus, SYSTEM_ACTOR, type Actor } from './activity';
import { getAdapter } from './adapters';
import { isRelayStore } from './adapters/relay';
import { CHANNEL_LABELS, nowIso, result } from './config';
import { getHours, holidaysFor, localDate, publishContext } from './hours';
import { getMenuLanguages } from './menu/language';
import { activeMenus, getBrandMenu, getMenuSharing, groupOf, sourceOf } from './menu/shared';
import { getRepo } from './repo';
import { foodhubTimeZone, startOfLocalDayMs } from './time';
import type { ChannelKey, ChannelResult, ChannelStore, FoodHubJob, MasterMenu, PlatformStatus } from './types';

export interface FanOutRow { storeId: string; channel: ChannelKey; channelStoreId: string; brandName: string; locationCode: string; result: ChannelResult }
/** okCount counts done/queued/skipped; allFailed = at least one store and none ok (nothing reached a platform). */
export interface FanOutSummary { okCount: number; blockedCount: number; errorCount: number; allFailed: boolean }
/** Per-store rows (array, as before) plus summary flags — JSON-serialized callers still get the plain array. */
export type FanOut = FanOutRow[] & { summary: FanOutSummary };

export function summarize(rows: FanOutRow[]): FanOutSummary {
  const okCount = rows.filter((r) => r.result.ok).length;
  const blockedCount = rows.filter((r) => r.result.status === 'blocked').length;
  return { okCount, blockedCount, errorCount: rows.length - okCount - blockedCount, allFailed: rows.length > 0 && okCount === 0 };
}

function withSummary(rows: FanOutRow[]): FanOut { return Object.assign(rows, { summary: summarize(rows) }); }

/** Wall-clock time in the hub's zone (Vercel runs in UTC), e.g. "15 h 30" — for persisted summaries. */
function hhmm(ms: number): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: foodhubTimeZone(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

async function record(kind: FoodHubJob['kind'], store: ChannelStore, res: ChannelResult, request: Record<string, unknown>) {
  await getRepo().addJob({
    kind,
    channel: store.channel,
    reference: res.reference ?? null,
    status: res.status === 'queued' ? 'queued' : res.ok ? 'done' : 'error',
    request: { ...request, storeId: store.id, channelStoreId: store.channelStoreId },
    // The platform's answer (truncated) is kept so Platforms → recent jobs can show exactly what was refused.
    result: { status: res.status, message: res.message, httpStatus: res.httpStatus ?? null, ...(res.ok || res.response === undefined ? {} : { response: truncateJson(res.response) }) },
  });
}

function truncateJson(v: unknown): unknown {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text && text.length > 4000 ? `${text.slice(0, 4000)}…` : v;
}

function row(store: ChannelStore, res: ChannelResult): FanOutRow {
  return { storeId: store.id, channel: store.channel, channelStoreId: store.channelStoreId, brandName: store.brandName, locationCode: store.locationCode, result: res };
}

function logStore(actor: Actor, kind: 'store_status' | 'item_availability' | 'menu_publish', action: string, store: ChannelStore, res: ChannelResult, summary: string, detail: Record<string, unknown> = {}) {
  return logActivity({
    actor: actor.name, source: actor.source, kind, action, status: resultStatus(res),
    channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `${summary} — ${store.brandName} · ${store.locationCode} on ${CHANNEL_LABELS[store.channel]}${res.ok ? '' : ` (${res.message})`}`,
    detail: { ...detail, channelStoreId: store.channelStoreId, result: { status: res.status, message: res.message } },
  });
}

/**
 * Stores an outbound action (publish, 86, pause) goes to. Stores reached through the Food Hub relay
 * ("relay:<id>") only receive orders: the platform's own API does not know them, so they are never included.
 */
export async function storesFor(filter: { brandName?: string; brandNames?: string[]; locationCode?: string; storeIds?: string[]; channels?: ChannelKey[]; locationCodes?: string[] }) {
  const all = await getRepo().listStores();
  return all.filter((s) => !isRelayStore(s) &&
    (!filter.brandName || s.brandName === filter.brandName) &&
    (!filter.brandNames || filter.brandNames.includes(s.brandName)) &&
    (!filter.locationCode || s.locationCode === filter.locationCode) &&
    (!filter.locationCodes?.length || filter.locationCodes.includes(s.locationCode)) &&
    (!filter.storeIds?.length || filter.storeIds.includes(s.id)) &&
    (!filter.channels?.length || filter.channels.includes(s.channel)));
}

/**
 * "Do not touch" (store.meta.doNotTouch): Food Hub never sends this store a menu, holiday hours or an 86 — its menu is
 * managed elsewhere (still on UrbanPiper, a special menu…). Orders, store status and pause / resume keep working.
 */
export function isDoNotTouch(store: Pick<ChannelStore, 'meta'>): boolean {
  return store.meta?.doNotTouch === true;
}

const DO_NOT_TOUCH_MESSAGE = 'Not sent: this store is marked “Do not touch” (Stores → edit the store to change it).';

/** Refs 86'd at a location right now (timed 86s that already ended are ignored). */
export function offRefsAt(menu: MasterMenu, locationCode: string, now = Date.now()): Set<string> {
  const until = menu.unavailableUntil ?? {};
  return new Set((menu.unavailableByLocation?.[locationCode] ?? []).filter((ref) => !(until[`${locationCode}|${ref}`] && until[`${locationCode}|${ref}`] <= now)));
}

/** The menu as it should appear at one location: 86'd items and modifiers switched off. */
export function menuForLocation(menu: MasterMenu, locationCode: string, now = Date.now()): MasterMenu {
  const off = offRefsAt(menu, locationCode, now);
  if (off.size === 0) return menu;
  return {
    ...menu,
    items: menu.items.map((i) => (off.has(i.ref) ? { ...i, available: false } : i)),
    modifierGroups: menu.modifierGroups.map((g) => ({ ...g, modifiers: g.modifiers.map((m) => (off.has(m.ref) ? { ...m, available: false } : m)) })),
  };
}

/**
 * Push the brand's master menu (with store hours, holidays, category schedules) to the mapped stores.
 * A brand that shares another brand's menu publishes that menu under its own name, hours and stores.
 */
export async function publishMenu(brandName: string, opts: { storeIds?: string[]; channels?: ChannelKey[]; locationCodes?: string[]; actor?: Actor } = {}): Promise<FanOut> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const menu = await getBrandMenu(brandName);
  if (!menu) throw new Error(`No master menu saved for ${brandName}. Import from Clover or create items first.`);
  const stores = await storesFor({ brandName, storeIds: opts.storeIds, channels: opts.channels, locationCodes: opts.locationCodes });
  const hours = await getHours();
  const languages = await getMenuLanguages();
  const rows: FanOutRow[] = [];
  for (const store of stores) {
    // Never sent, never recorded as a publish: the store's last real publish stays what the Menus page shows.
    if (isDoNotTouch(store)) { rows.push(row(store, result(store.channel, 'skipped', DO_NOT_TOUCH_MESSAGE))); continue; }
    const ctx = { ...(await publishContext(brandName, store.locationCode, hours)), language: store.channel === 'tgtg' ? 'en' as const : languages[store.channel] };
    const res = await getAdapter(store.channel).publishMenu(store, menuForLocation(menu, store.locationCode), ctx);
    await record('menu_push', store, res, { brandName, hoursSet: Boolean(ctx.hours), holidays: ctx.holidays.length });
    await logStore(actor, 'menu_publish', 'publish', store, res, `Menu published (${menu.items.length} items${ctx.hours ? '' : ', no store hours set'})`);
    rows.push(row(store, res));
  }
  return withSummary(rows);
}

/**
 * 86 / un-86 items AND modifiers at a location (all channels), or everywhere when no location is given.
 * untilMs = automatic re-enable (Uber/Skip natively; DoorDash and the menu by Food Hub's sync).
 * Brands that share one menu share its 86 state too (same kitchen, same items): the 86 is saved on the shared menu
 * and sent to the stores of every brand that uses it.
 */
export async function setItemAvailability(brandName: string, refs: string[], available: boolean, opts: { locationCode?: string; untilMs?: number; actor?: Actor; ownMenu?: boolean } = {}): Promise<FanOut> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const repo = getRepo();
  // ownMenu: this brand's own stored menu and stores only (a brand that now shares another menu finishing the timed
  // 86s it had before it started sharing) — never the shared menu.
  const sharing = opts.ownMenu ? {} : await getMenuSharing();
  const brands = groupOf(sharing, brandName);
  const menu = await repo.getMenu(sourceOf(sharing, brandName));
  const modifierRefs = new Set((menu?.modifierGroups ?? []).flatMap((g) => g.modifiers.map((m) => m.ref)));
  const itemRefs = refs.filter((r) => !modifierRefs.has(r));
  const modRefs = refs.filter((r) => modifierRefs.has(r));
  const names = new Map<string, string>([...(menu?.items ?? []).map((i) => [i.ref, i.name] as [string, string]), ...(menu?.modifierGroups ?? []).flatMap((g) => g.modifiers.map((m) => [m.ref, m.name] as [string, string]))]);
  const label = refs.map((r) => names.get(r) ?? r).join(', ');
  if (menu) {
    const byLoc = { ...(menu.unavailableByLocation ?? {}) };
    const until = { ...(menu.unavailableUntil ?? {}) };
    const locations = opts.locationCode ? [opts.locationCode] : [...new Set([...(await storesFor({ brandNames: brands })).map((s) => s.locationCode), ...Object.keys(byLoc)])];
    for (const loc of locations) {
      const set = new Set(byLoc[loc] ?? []);
      for (const ref of refs) {
        if (available) { set.delete(ref); delete until[`${loc}|${ref}`]; } else {
          set.add(ref);
          if (opts.untilMs) until[`${loc}|${ref}`] = opts.untilMs; else delete until[`${loc}|${ref}`];
        }
      }
      byLoc[loc] = [...set];
    }
    await repo.saveMenu({ ...menu, unavailableByLocation: byLoc, unavailableUntil: until });
  }
  const stores = await storesFor({ brandNames: brands, locationCode: opts.locationCode });
  const rows: FanOutRow[] = [];
  for (const store of stores) {
    if (isDoNotTouch(store)) { rows.push(row(store, result(store.channel, 'skipped', DO_NOT_TOUCH_MESSAGE))); continue; }
    const adapter = getAdapter(store.channel);
    let res: ChannelResult = result(store.channel, 'skipped', 'Nothing to update.');
    if (itemRefs.length) res = await adapter.setItemAvailability(store, itemRefs, available, opts.untilMs, 'item');
    if (modRefs.length && (res.ok || !itemRefs.length)) {
      const m = await adapter.setItemAvailability(store, modRefs, available, opts.untilMs, 'modifier');
      res = itemRefs.length && m.ok ? { ...res, message: `${res.message}; modifiers: ${m.message}` } : m;
    }
    await record('item_toggle', store, res, { brandName: store.brandName, itemRefs, modifierRefs: modRefs, available, untilMs: opts.untilMs ?? null });
    await logStore(actor, 'item_availability', available ? 'item_on' : 'item_off', store, res,
      `${available ? 'Back in stock' : "86'd"}: ${label}${!available && opts.untilMs ? ` until ${hhmm(opts.untilMs)}` : ''}`, { refs });
    rows.push(row(store, res));
  }
  const out = withSummary(rows);
  if (!stores.length) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'item_availability', action: available ? 'item_on' : 'item_off', status: 'info', brandName, locationCode: opts.locationCode ?? null,
      summary: `${available ? 'Back in stock' : "86'd"} in Food Hub only (no mapped stores): ${label} — ${brandName}${opts.locationCode ? ` · ${opts.locationCode}` : ''}` });
  } else if (out.summary.allFailed) {
    // Food Hub state is saved, but no platform got it: say so plainly instead of letting the per-store rows be the only hint.
    await logActivity({ actor: actor.name, source: actor.source, kind: 'item_availability', action: available ? 'item_on' : 'item_off', status: 'failed', brandName, locationCode: opts.locationCode ?? null,
      summary: `${available ? 'Back in stock' : "86'd"} in Food Hub only — no platform received it (${out.summary.blockedCount} blocked, ${out.summary.errorCount} failed): ${label} — ${brandName}${opts.locationCode ? ` · ${opts.locationCode}` : ''}`, detail: { refs, notSent: true, summary: out.summary } });
  }
  return out;
}

/** Pause / resume stores on every channel. */
export async function setStoresOnline(storeIds: string[], online: boolean, opts: { untilMs?: number; reason?: string; actor?: Actor } = {}): Promise<FanOut> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const repo = getRepo();
  const stores = await storesFor({ storeIds });
  const rows: FanOutRow[] = [];
  for (const store of stores) {
    const res = await getAdapter(store.channel).setStoreOnline(store, online, opts.untilMs, opts.reason);
    if (res.ok) {
      const until = !online && opts.untilMs ? new Date(opts.untilMs).toISOString() : null;
      const platformStatus: PlatformStatus = { state: online ? 'online' : 'paused', detail: online ? undefined : opts.reason || 'Paused from TAKATAK', until, checkedAt: nowIso(), source: 'dashboard' };
      await repo.updateStore(store.id, { online, pausedUntil: until, lastStatusSource: 'foodhub', meta: { ...store.meta, platformStatus, ...(opts.reason === HOLIDAY_REASON ? { holidayPause: localDate(Date.now()) } : {}) } });
    }
    await record('store_toggle', store, res, { online, untilMs: opts.untilMs ?? null, reason: opts.reason ?? null });
    await logStore(actor, 'store_status', online ? 'resume' : 'pause', store, res,
      online ? 'Store resumed' : `Store paused${opts.untilMs ? ` until ${hhmm(opts.untilMs)}` : ''}${opts.reason ? ` (${opts.reason})` : ''}`, { online, untilMs: opts.untilMs ?? null });
    rows.push(row(store, res));
  }
  const out = withSummary(rows);
  if (out.summary.allFailed) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'store_status', action: online ? 'resume' : 'pause', status: 'failed',
      summary: `Store ${online ? 'resume' : 'pause'} not applied on any platform (${out.summary.blockedCount} blocked, ${out.summary.errorCount} failed): ${stores.map((s) => `${s.brandName} · ${s.locationCode} (${CHANNEL_LABELS[s.channel]})`).join(', ')}`,
      detail: { online, untilMs: opts.untilMs ?? null, reason: opts.reason ?? null, notSent: true, summary: out.summary } });
  }
  return out;
}

/** Minutes to wait before retrying a failed automatic re-open: 5, 15, then every 60. */
const REOPEN_RETRY_MIN = [5, 15, 60];

/** Re-opens stores whose timed pause has expired (for channels without native timed pause). */
export async function reopenExpiredPauses(now = Date.now()): Promise<FanOut> {
  const repo = getRepo();
  const due = (await repo.listStores()).filter((s) => !s.online && s.pausedUntil && new Date(s.pausedUntil).getTime() <= now);
  // A failed re-open backs off (meta.reopenAttempts / reopenAttemptAt) instead of a failed job + alert on every sync.
  const stores = due.filter((s) => {
    const attempts = Number(s.meta?.reopenAttempts ?? 0);
    const last = s.meta?.reopenAttemptAt ? new Date(String(s.meta.reopenAttemptAt)).getTime() : 0;
    return !attempts || !last || now - last >= REOPEN_RETRY_MIN[Math.min(attempts, REOPEN_RETRY_MIN.length) - 1] * 60_000;
  });
  if (!stores.length) return withSummary([]);
  const rows = await setStoresOnline(stores.map((s) => s.id), true, { reason: 'Timed pause ended' });
  for (const r of rows) {
    const store = await repo.getStore(r.storeId);
    if (!store) continue;
    const { reopenAttempts, reopenAttemptAt, ...meta } = store.meta;
    if (r.result.ok) { if (reopenAttempts !== undefined || reopenAttemptAt !== undefined) await repo.updateStore(store.id, { meta }); continue; }
    const attempts = Number(reopenAttempts ?? 0) + 1;
    await repo.updateStore(store.id, { meta: { ...meta, reopenAttempts: attempts, reopenAttemptAt: new Date(now).toISOString() } });
    if (attempts === 1) {
      await logActivity({ actor: SYSTEM_ACTOR.name, source: SYSTEM_ACTOR.source, kind: 'store_status', action: 'reopen_failed', status: 'failed', channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
        summary: `Automatic re-open failed — ${store.brandName} · ${store.locationCode} on ${CHANNEL_LABELS[store.channel]} stays paused (${r.result.message}). Food Hub retries in 5, 15 then every 60 min; resume it from Stores if needed.` });
    }
  }
  return rows;
}

/**
 * Timed 86s that ended: switch the items back on everywhere (DoorDash has no native timer).
 * Menus in use fan out to every brand sharing them; a brand that started sharing another menu still finishes the
 * timers left on its own menu, on its own stores only (its platforms keep that 86 until it is re-enabled).
 */
export async function reenableExpiredItems(now = Date.now()): Promise<number> {
  let count = 0;
  const sharing = await getMenuSharing();
  const active = new Set((await activeMenus(sharing)).map((m) => m.brandName));
  for (const menu of await getRepo().listMenus()) {
    const expired = Object.entries(menu.unavailableUntil ?? {}).filter(([, t]) => t <= now);
    const byLoc = new Map<string, string[]>();
    for (const [key] of expired) { const [loc, ref] = key.split('|'); byLoc.set(loc, [...(byLoc.get(loc) ?? []), ref]); }
    const own = !active.has(menu.brandName);
    // The menu this brand uses now: an item it still has 86'd stays off — the old timer is only cleared, never sent.
    const current = own ? await getRepo().getMenu(sourceOf(sharing, menu.brandName)) : null;
    for (const [loc, refs] of byLoc) {
      const stillOff = current ? offRefsAt(current, loc, now) : new Set<string>();
      const send = refs.filter((r) => !stillOff.has(r));
      const keep = refs.filter((r) => stillOff.has(r));
      if (keep.length) {
        // Re-read: an earlier location's re-enable in this loop already saved this menu.
        const fresh = (await getRepo().getMenu(menu.brandName)) ?? menu;
        const until = { ...(fresh.unavailableUntil ?? {}) };
        for (const r of keep) delete until[`${loc}|${r}`];
        await getRepo().saveMenu({ ...fresh, unavailableByLocation: { ...(fresh.unavailableByLocation ?? {}), [loc]: (fresh.unavailableByLocation?.[loc] ?? []).filter((r) => !keep.includes(r)) }, unavailableUntil: until });
      }
      if (send.length) await setItemAvailability(menu.brandName, send, true, { locationCode: loc, actor: SYSTEM_ACTOR, ownMenu: own });
      count += send.length;
    }
  }
  return count;
}

export const HOLIDAY_REASON = 'Holiday closure';

/**
 * Closed holidays: Uber (holiday-hours) and DoorDash (special_hours) close by themselves once the menu
 * is published. Skip has no holiday API, so Food Hub takes Skip stores offline until the next day.
 */
export async function applyHolidayClosures(now = Date.now()): Promise<number> {
  const hours = await getHours();
  const today = localDate(now);
  const stores = (await getRepo().listStores()).filter((s) => s.channel === 'skip' && !isRelayStore(s) && s.online && (s.meta as Record<string, unknown>)?.holidayPause !== today);
  const closing = stores.filter((s) => holidaysFor(hours, s.locationCode, today, 0).some((h) => h.date === today && h.closed));
  if (!closing.length) return 0;
  const nextMidnight = startOfLocalDayMs(startOfLocalDayMs(now) + 36 * 3600_000);
  await setStoresOnline(closing.map((s) => s.id), false, { untilMs: nextMidnight, reason: HOLIDAY_REASON, actor: SYSTEM_ACTOR });
  return closing.length;
}

/**
 * Menu-status callbacks (JET Connect, DoorDash): only an explicit indicator closes a queued menu push.
 * 'success' / 'failed' / null — null means nothing explicit, so the job stays queued and the payload is kept.
 */
export function menuCallbackOutcome(body: any): 'success' | 'failed' | null {
  if (!body || typeof body !== 'object') return null;
  const flags = [body.success, body.ok, body.succeeded, body.published];
  if (flags.some((f) => f === false)) return 'failed';
  if (flags.some((f) => f === true)) return 'success';
  if (Array.isArray(body.errors) && body.errors.length) return 'failed';
  const raw = body.status ?? body.result ?? body.state ?? body.menu?.status ?? body.event?.status;
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (/fail|error|reject|invalid|denied|inactive|unpublish/i.test(text)) return 'failed';
  if (/success|succeeded|\bok\b|publish|complete|accept|active|valid/i.test(text)) return 'success';
  return null;
}

/**
 * Skip (JET Connect) menu status callback: close the queued Skip menu push(es) for the restaurant(s) it names.
 * No restaurant or no explicit result → nothing is closed (never claim "published" on a guess); `keep` says why the payload must be kept.
 */
export async function handleSkipMenuStatus(body: any): Promise<{ updated: number; message: string; keep?: string }> {
  const repo = getRepo();
  const jobs = (await repo.listJobs(2000)).filter((j) => j.channel === 'skip' && j.kind === 'menu_push' && j.status === 'queued');
  const restaurants: string[] = (Array.isArray(body?.restaurants) ? body.restaurants : [body?.restaurant ?? body?.restaurantId ?? body?.restaurant_id ?? body?.posLocationId]).filter(Boolean).map(String);
  const outcome = menuCallbackOutcome(body);
  const targets = restaurants.length ? jobs.filter((j) => restaurants.includes(String(j.request.channelStoreId))) : [];
  if (!restaurants.length || !outcome) {
    for (const job of targets) await repo.updateJob(job.id, { result: { ...(job.result ?? {}), callback: body } });
    return { updated: 0, message: '0 Skip menu job(s) updated (callback kept)', keep: !restaurants.length ? 'Skip menu-status callback does not identify the restaurant' : 'Skip menu-status callback without an explicit success/failure indicator — menu push left queued' };
  }
  for (const job of targets) await repo.updateJob(job.id, { status: outcome === 'success' ? 'done' : 'error', result: { ...(job.result ?? {}), callback: body } });
  return { updated: targets.length, message: `${targets.length} Skip menu job(s) updated` };
}

export function noStoresResult(channel: ChannelKey) {
  return result(channel, 'skipped', 'No mapped stores matched.');
}
