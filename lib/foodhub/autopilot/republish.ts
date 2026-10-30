// Autopilot · "Re-publish 10 min after a change" (OFF by default). After "Use Clover price" or after the opening hours are
// saved, the brand's menu is published 10 minutes later through the scheduled publishes (menu/schedule.ts): one entry
// per brand, moved back on every new change (never more than 30 minutes after the first one), so several saves give
// one publish. Only the brand's stores an automation may touch are listed: a brand whose stores are all protected
// (Po Poulet NDG, a locked menu, "Do not touch") is never scheduled. A person can cancel it until it starts.
import { AUTOPILOT_ACTOR, logActivity, type Actor } from '../activity';
import { cancelScheduled, listScheduled, postponeScheduled, schedulePublish } from '../menu/schedule';
import { menuChangesRefused } from '../menu/lock';
import { getBrandMenu, menuGroupFor, unpublishableMenuReason } from '../menu/shared';
import { storesFor } from '../ops';
import { getRepo } from '../repo';
import { isLockedStore } from '../store-availability/common';
import { foodhubTimeZone } from '../time';
import type { ChannelStore, HoursConfig } from '../types';
import { noteRun } from './runs';
import { isSwitchOn } from './switches';

export const REPUBLISH_KEY = 'autopilot_republish_v1';
export const REPUBLISH_DELAY_MS = 10 * 60_000;
/** Saves keep coming? The publish still goes at most this long after the first change. */
export const REPUBLISH_MAX_WAIT_MS = 30 * 60_000;

export type RepublishReason = 'clover_price' | 'hours';
interface Pending { scheduledId: string; firstAt: string; reasons: RepublishReason[] }
type PendingMap = Record<string, Pending>;

export interface RepublishOutcome {
  brand: string;
  outcome: 'scheduled' | 'moved' | 'protected' | 'no_stores' | 'no_menu' | 'error';
  at?: string;
  scheduledId?: string;
}

const REASON: Record<RepublishReason, { fr: string; en: string }> = {
  clover_price: { fr: '« Prendre le prix Clover »', en: '“Use Clover price”' },
  hours: { fr: 'heures enregistrées', en: 'hours saved' },
};

function hhmm(ms: number): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: foodhubTimeZone(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** A store an automation may publish to: not protected (built-in lock, locked menu, "Do not touch", forbidden DoorDash). */
export function publishableByAutomation(store: ChannelStore): boolean {
  return !isLockedStore(store) && !menuChangesRefused(store);
}

async function readPending(): Promise<PendingMap> {
  return (await getRepo().getKv<PendingMap>(REPUBLISH_KEY).catch(() => null)) ?? {};
}

/** Brands that publish the menu a "Use Clover price" changed: the menu's owner and every brand sharing it. */
export async function brandsForMenuChange(brand: string): Promise<string[]> {
  return menuGroupFor(brand);
}

/**
 * Brands whose published hours changed between two saved hours configs: a brand with its own hours that changed, every
 * brand with a store at a location whose hours changed, and the brands at the locations of an added, removed or
 * changed holiday (a holiday with no location applies everywhere).
 */
export function brandsAffectedByHours(before: HoursConfig, after: HoursConfig, stores: Array<Pick<ChannelStore, 'brandName' | 'locationCode'>>): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const keys = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  const locs = new Set(keys(before.locations, after.locations).filter((k) => !same(before.locations?.[k], after.locations?.[k])));
  const brands = new Set(keys(before.brands, after.brands).filter((k) => !same(before.brands?.[k], after.brands?.[k])));
  const sig = (h: HoursConfig['holidays'][number]) => JSON.stringify(h);
  const was = new Set((before.holidays ?? []).map(sig));
  const now = new Set((after.holidays ?? []).map(sig));
  let everywhere = false;
  for (const h of [...(before.holidays ?? []).filter((x) => !now.has(sig(x))), ...(after.holidays ?? []).filter((x) => !was.has(sig(x)))]) {
    if (!h.locationCodes?.length) everywhere = true;
    else for (const l of h.locationCodes) locs.add(l);
  }
  for (const s of stores) if (everywhere || locs.has(s.locationCode)) brands.add(s.brandName);
  return [...brands].sort();
}

/**
 * A change that should reach the platforms: schedule (or move back) one publish per brand, 10 minutes from now. Does
 * nothing at all while the switch is off. `by` is the person whose change triggered it (named in the log).
 */
export async function queueRepublish(brands: string[], reason: RepublishReason, by: Actor, now = Date.now()): Promise<RepublishOutcome[]> {
  if (!brands.length || !(await isSwitchOn('republish_after_change'))) return [];
  const pending = await readPending();
  const out: RepublishOutcome[] = [];
  const why = REASON[reason];
  for (const brand of [...new Set(brands)]) {
    try {
      const stores = await storesFor({ brandName: brand });
      const allowed = stores.filter(publishableByAutomation);
      if (!allowed.length) {
        const outcome = stores.length ? 'protected' : 'no_stores';
        out.push({ brand, outcome });
        if (outcome === 'protected') {
          await logActivity({ actor: AUTOPILOT_ACTOR.name, source: AUTOPILOT_ACTOR.source, kind: 'menu_publish', action: 'autopilot_republish_skipped', status: 'info', brandName: brand,
            summary: `Autopilot: no publish scheduled for ${brand} after ${why.en} — every one of its stores is protected (never published by an automation)` });
        }
        continue;
      }
      const menu = await getBrandMenu(brand);
      const empty = menu ? unpublishableMenuReason(menu) : 'no master menu';
      if (!menu || empty) {
        out.push({ brand, outcome: 'no_menu' });
        await logActivity({ actor: AUTOPILOT_ACTOR.name, source: AUTOPILOT_ACTOR.source, kind: 'menu_publish', action: 'autopilot_republish_skipped', status: 'info', brandName: brand,
          summary: `Autopilot: no publish scheduled for ${brand} after ${why.en} — ${empty}` });
        continue;
      }
      const cur = pending[brand];
      const waiting = cur ? (await listScheduled(brand)).find((s) => s.id === cur.scheduledId && s.status === 'scheduled') : undefined;
      if (cur && waiting) {
        const at = Math.max(Date.parse(waiting.at), Math.min(now + REPUBLISH_DELAY_MS, Date.parse(cur.firstAt) + REPUBLISH_MAX_WAIT_MS));
        const moved = await postponeScheduled(waiting.id, new Date(at).toISOString());
        if (moved) {
          pending[brand] = { ...cur, reasons: [...new Set([...cur.reasons, reason])] };
          out.push({ brand, outcome: 'moved', at: moved.at, scheduledId: moved.id });
          await logActivity({ actor: AUTOPILOT_ACTOR.name, source: AUTOPILOT_ACTOR.source, kind: 'menu_publish', action: 'autopilot_republish_moved', status: 'queued', brandName: brand,
            summary: `Autopilot: ${brand} menu publish moved to ${hhmm(at)} (new change: ${why.en} by ${by.name}) — one publish for every change` });
          continue;
        }
      }
      const entry = await schedulePublish({ brand, storeIds: allowed.map((s) => s.id), at: new Date(now + REPUBLISH_DELAY_MS).toISOString(), by: 'autopilot' }, AUTOPILOT_ACTOR);
      pending[brand] = { scheduledId: entry.id, firstAt: new Date(now).toISOString(), reasons: [reason] };
      out.push({ brand, outcome: 'scheduled', at: entry.at, scheduledId: entry.id });
      const skipped = stores.length - allowed.length;
      await logActivity({ actor: AUTOPILOT_ACTOR.name, source: AUTOPILOT_ACTOR.source, kind: 'menu_publish', action: 'autopilot_republish_planned', status: 'queued', brandName: brand,
        summary: `Autopilot: ${brand} menu will be published at ${hhmm(Date.parse(entry.at))} on ${allowed.length} store(s) after ${why.en} by ${by.name}${skipped ? ` (${skipped} protected store(s) left out)` : ''} — cancel it in Settings → Autopilot`,
        detail: { scheduledId: entry.id, reason, storeIds: allowed.map((s) => s.id) } });
    } catch (e) {
      out.push({ brand, outcome: 'error' });
      console.error(`[foodhub] autopilot re-publish ${brand} failed`, e instanceof Error ? e.message : e);
    }
  }
  try { await getRepo().setKv(REPUBLISH_KEY, pending); } catch (e) { console.error('[foodhub] autopilot re-publish state not saved', e instanceof Error ? e.message : e); }
  const planned = out.filter((o) => o.outcome === 'scheduled' || o.outcome === 'moved');
  if (planned.length) {
    const at = Math.max(...planned.map((o) => Date.parse(o.at!)));
    await noteRun('republish_after_change', { status: 'info',
      fr: `Publication prévue à ${hhmm(at)} (${why.fr}) : ${planned.map((o) => o.brand).join(', ')}`,
      en: `Publish planned at ${hhmm(at)} (${why.en}): ${planned.map((o) => o.brand).join(', ')}` });
  } else if (out.some((o) => o.outcome === 'protected')) {
    await noteRun('republish_after_change', { status: 'info', fr: 'Rien de prévu : tous les magasins de la marque sont protégés', en: 'Nothing planned: every store of the brand is protected' });
  }
  return out;
}

/** The re-publishes still waiting (the page shows them with « Annuler »). */
export async function pendingRepublishes(): Promise<Array<{ brand: string; scheduledId: string; at: string; reasons: RepublishReason[] }>> {
  const pending = await readPending();
  const list = await listScheduled();
  return Object.entries(pending).flatMap(([brand, p]) => {
    const s = list.find((x) => x.id === p.scheduledId && x.status === 'scheduled' && x.by === 'autopilot');
    return s ? [{ brand, scheduledId: s.id, at: s.at, reasons: p.reasons }] : [];
  }).sort((a, b) => a.at.localeCompare(b.at));
}

/** Undo: cancels an Autopilot re-publish that has not started. False when it is not Autopilot's or already ran. */
export async function cancelRepublish(scheduledId: string, actor: Actor): Promise<boolean> {
  const entry = (await listScheduled()).find((x) => x.id === scheduledId && x.status === 'scheduled' && x.by === 'autopilot');
  if (!entry) return false;
  const ok = await cancelScheduled(scheduledId, actor);
  if (!ok) return false;
  const pending = await readPending();
  for (const [brand, p] of Object.entries(pending)) if (p.scheduledId === scheduledId) delete pending[brand];
  await getRepo().setKv(REPUBLISH_KEY, pending);
  await noteRun('republish_after_change', { status: 'info', fr: `Publication de ${entry.brand} annulée par ${actor.name}`, en: `${entry.brand} publish cancelled by ${actor.name}` });
  return true;
}

/** "Use Clover price" was accepted for `brand`: re-publish every brand that publishes that menu (when the switch is on). */
export async function afterCloverPriceUsed(brand: string, by: Actor): Promise<RepublishOutcome[]> {
  try {
    if (!(await isSwitchOn('republish_after_change'))) return [];
    return await queueRepublish(await brandsForMenuChange(brand), 'clover_price', by);
  } catch (e) {
    console.error('[foodhub] autopilot after Clover price failed', e instanceof Error ? e.message : e);
    return [];
  }
}

/** The opening hours were saved: re-publish the brands whose hours changed (when the switch is on). Never throws. */
export async function afterHoursSaved(before: HoursConfig, after: HoursConfig, by: Actor): Promise<RepublishOutcome[]> {
  try {
    if (!(await isSwitchOn('republish_after_change'))) return [];
    const brands = brandsAffectedByHours(before, after, await storesFor({}));
    return await queueRepublish(brands, 'hours', by);
  } catch (e) {
    console.error('[foodhub] autopilot after hours saved failed', e instanceof Error ? e.message : e);
    return [];
  }
}
