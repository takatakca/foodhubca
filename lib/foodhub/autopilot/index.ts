// Settings → Autopilot (MASTER_PLAN Phase 4.1 + 4.2): every automation of Food Hub in one list — its switch, its rule in
// plain words, the last time it ran, what it did last, and an undo where one exists.
//
//  - The automations that existed before keep their own switch where it already lives (tablet-off guard per kitchen,
//    Watchtower rule, server setting) or are always on; the page reads that state, it never keeps a second copy.
//  - The three new ones (re-publish after a change, retry refused sends, weekly Uber report) are OFF until a manager or
//    the owner turns them on here; with all three off, Food Hub does exactly what it did before.
//  - Every action of a new automation is written to the activity log with the actor "Autopilot" (source automation).
//  - Locked rules: no AI here — Autopilot never approves, posts, deletes or settles money; Po Poulet NDG and every
//    protected store (store-availability/common.ts isLockedStore, menu/lock.ts) are never paused, published or 86'd.
import { cloverRetryDelaysS } from '../order-retry';
import { cloverInventorySyncEnabled } from '../clover-sync';
import { getCatalog } from '../catalog';
import { listScheduled } from '../menu/schedule';
import { getRepo } from '../repo';
import { GUARD_ACTOR } from '../store-availability/common';
import { getGuardConfigs, getGuardState } from '../store-availability/downtime-guard';
import { AVAILABILITY_TICK_KEY } from '../store-availability/tick';
import { foodhubTimeZone } from '../time';
import type { ActivityEntry } from '../types';
import { getWatchSettings, listIncidents } from '../watch/engine';
import { pendingRepublishes } from './republish';
import { openChains, tickRetries, type RetryTick } from './retry';
import { getRuns, noteRuns, syncNotes, type RunNote, type SyncResults } from './runs';
import { getSwitches, type NewAutomationId } from './switches';
import { getUberWeekly, tickUberWeekly, uberWeekWindow, type UberWeeklyState } from './uber-weekly';

export { NEW_AUTOMATIONS, isNewAutomation, setSwitch, getSwitches, type NewAutomationId } from './switches';
export { afterCloverPriceUsed, afterHoursSaved, cancelRepublish } from './republish';
export { stopRetry, retryIncidentDetections } from './retry';
export type { SyncResults } from './runs';

export const AUTOPILOT_TICK_KEY = 'autopilot_tick_last';

export interface AutopilotTick { ran: boolean; retries?: RetryTick; uber?: UberWeeklyState | null }

/**
 * Autopilot's heartbeat, from the sync engine (every sync run). Remembers what the existing housekeeping did (for the
 * page), then runs the new automations that are switched on. With every new switch off it only reads one key. Never throws.
 */
export async function runAutopilot(opts: { now?: number; sync?: SyncResults } = {}): Promise<AutopilotTick> {
  const now = opts.now ?? Date.now();
  try {
    if (opts.sync) await noteRuns(syncNotes(opts.sync));
    const sw = await getSwitches();
    const retryOn = sw.retry_failed_jobs?.on === true;
    const uberOn = sw.uber_weekly_report?.on === true;
    if (!retryOn && !uberOn) return { ran: false };
    const g = globalThis as { __foodhubAutopilotTick?: boolean };
    if (g.__foodhubAutopilotTick) return { ran: false };
    g.__foodhubAutopilotTick = true;
    try {
      await getRepo().setKv(AUTOPILOT_TICK_KEY, { at: new Date(now).toISOString() }).catch(() => undefined);
      const retries = retryOn ? await tickRetries(now, sw.retry_failed_jobs!.at) : undefined;
      const uber = uberOn ? await tickUberWeekly(now) : undefined;
      return { ran: true, retries, uber };
    } finally {
      g.__foodhubAutopilotTick = false;
    }
  } catch (e) {
    console.error('[foodhub] autopilot tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  }
}

// ---------- the list on Settings → Autopilot ----------

/** How an automation is switched: here (new), in its own page, by a server setting, or not at all (always on). */
export type AutomationControl = 'here' | 'elsewhere' | 'server' | 'always';

export interface PendingAction { id: string; kind: 'cancel_publish' | 'stop_retry'; fr: string; en: string; at: string | null }

export interface AutomationView {
  id: string;
  isNew: boolean;
  fr: string; en: string;
  ruleFr: string; ruleEn: string;
  on: boolean;
  stateFr: string; stateEn: string;
  control: AutomationControl;
  /** Where its switch lives when it is not on this page. */
  whereFr?: string; whereEn?: string; href?: string;
  /** Technical name behind it (server setting), folded under « Détails techniques ». */
  tech?: string;
  switchedAt?: string | null; switchedBy?: string | null;
  lastRunAt: string | null;
  lastDid: RunNote | null;
  /** Things waiting that a person can undo here (cancel a publish, stop a retry). */
  pending: PendingAction[];
  /** An undo that exists on another page. */
  undoFr?: string; undoEn?: string; undoHref?: string;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: foodhubTimeZone(), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const fromActivity = (e: ActivityEntry | undefined): RunNote | null =>
  e ? { at: e.at, status: e.status === 'failed' ? 'failed' : e.status === 'success' ? 'success' : 'info', fr: e.summary, en: e.summary } : null;

function autoCloseMinutes(): number {
  const n = Number(process.env.FOODHUB_AUTO_COMPLETE_MIN ?? 90);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Every automation, new ones first, with its state read from where it lives. */
export async function listAutomations(now = Date.now()): Promise<AutomationView[]> {
  const repo = getRepo();
  const since = new Date(now - 14 * 86400_000).toISOString();
  const [switches, runs, catalog, guardCfg, guardState, syncAt, syncLast, availabilityAt, reconDay, watchLast, tickLast, watch, scheduled, republishes, chains, uber, guardLog, orderLog, incidents] = await Promise.all([
    getSwitches(), getRuns(), getCatalog(), getGuardConfigs(), getGuardState(),
    repo.getKv<{ at: string }>('sync:at').catch(() => null), repo.getKv<{ at: string }>('sync:last').catch(() => null),
    repo.getKv<number>(AVAILABILITY_TICK_KEY).catch(() => null), repo.getKv<string>('recon_daily_run').catch(() => null),
    repo.getKv<{ at: string }>('watch:last').catch(() => null), repo.getKv<{ at: string }>(AUTOPILOT_TICK_KEY).catch(() => null),
    getWatchSettings(), listScheduled().catch(() => []), pendingRepublishes().catch(() => []), openChains(now).catch(() => []), getUberWeekly(),
    repo.listActivity({ since, kinds: ['store_status', 'device'], limit: 1000 }).catch(() => [] as ActivityEntry[]),
    repo.listActivity({ since, kinds: ['order'], limit: 1000 }).catch(() => [] as ActivityEntry[]),
    listIncidents({ since, limit: 500 }).catch(() => []),
  ]);
  const syncRan = syncAt?.at ?? syncLast?.at ?? null;
  const tz = foodhubTimeZone();
  const sw = (id: NewAutomationId) => switches[id];
  const kitchens = catalog.locations.filter((l) => l.active).map((l) => l.code);
  const guardOn = kitchens.filter((c) => guardCfg[c]?.enabled);
  const guardPaused = Object.values(guardState).reduce((n, s) => n + (s.storeIds?.length ?? 0), 0);
  const retryDelays = cloverRetryDelaysS();
  const autoClose = autoCloseMinutes();
  const unmappedOn = watch.enabled && watch.rules.store_unmapped?.enabled !== false;
  const unmapped = incidents.filter((i) => i.kind === 'store_unmapped').sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
  const cloverRetryLast = orderLog.find((e) => e.action === 'clover_retry_ok' || e.action === 'clover_retry_gave_up');
  const waitingPublishes = scheduled.filter((s) => s.status === 'scheduled' && s.by !== 'autopilot');
  const week = uberWeekWindow(now, tz);
  const nextUber = now < week.dueAt ? week.dueAt : week.dueAt + 7 * 86400_000;
  const nextUberLabel = new Intl.DateTimeFormat('fr-CA', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(nextUber));
  const nextUberLabelEn = new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(nextUber));
  const onOff = (on: boolean) => (on ? { stateFr: 'Active', stateEn: 'On' } : { stateFr: 'Arrêtée', stateEn: 'Off' });
  const here = (id: NewAutomationId) => ({ control: 'here' as const, on: sw(id)?.on === true, switchedAt: sw(id)?.at || null, switchedBy: sw(id)?.by || null });

  const list: AutomationView[] = [
    // ---- New, OFF by default ----
    {
      id: 'republish_after_change', isNew: true, ...here('republish_after_change'),
      fr: 'Republier 10 min après un changement', en: 'Re-publish 10 min after a change',
      ruleFr: 'Après « Prendre le prix Clover » ou après l’enregistrement des heures d’ouverture, publie le menu de la marque 10 minutes plus tard. Plusieurs changements de suite donnent une seule publication. Jamais une marque dont tous les magasins sont protégés ; les magasins protégés sont laissés de côté.',
      ruleEn: 'After “Use Clover price” or after the opening hours are saved, publishes the brand’s menu 10 minutes later. Several changes in a row give one publish. Never a brand whose stores are all protected; protected stores are left out.',
      ...onOff(sw('republish_after_change')?.on === true),
      lastRunAt: runs.republish_after_change?.at ?? null, lastDid: runs.republish_after_change ?? null,
      pending: republishes.map((p) => ({ id: p.scheduledId, kind: 'cancel_publish' as const, fr: `${p.brand} · publication à ${hhmm(p.at)}`, en: `${p.brand} · publish at ${hhmm(p.at)}`, at: p.at })),
    },
    {
      id: 'retry_failed_jobs', isNew: true, ...here('retry_failed_jobs'),
      fr: 'Réessayer les envois refusés', en: 'Retry refused sends',
      ruleFr: 'Une publication de menu, un 86 ou une pause refusé par une plateforme est renvoyé au plus 3 fois (après 2, 10 puis 30 min), puis une alerte s’ouvre. Seulement ce qui n’a pas déjà son propre nouvel essai. Jamais un magasin protégé ; un changement fait entre-temps par une personne gagne toujours.',
      ruleEn: 'A menu publish, an 86 or a pause refused by a platform is sent again at most 3 times (after 2, 10 then 30 min), then an alert opens. Only what has no retry of its own already. Never a protected store; a change a person made in the meantime always wins.',
      ...onOff(sw('retry_failed_jobs')?.on === true),
      lastRunAt: sw('retry_failed_jobs')?.on ? tickLast?.at ?? null : runs.retry_failed_jobs?.at ?? null, lastDid: runs.retry_failed_jobs ?? null,
      pending: chains.map((c) => ({
        id: c.id, kind: 'stop_retry' as const, at: c.nextAt,
        fr: `${c.brandName} · ${c.locationCode} · ${c.kind === 'menu_push' ? 'menu' : c.kind === 'item_toggle' ? '86' : 'pause'} — ${c.status === 'gave_up' ? 'abandonné après 3 essais' : `essai ${c.attempts + 1}/3 à ${hhmm(c.nextAt!)}`}`,
        en: `${c.brandName} · ${c.locationCode} · ${c.kind === 'menu_push' ? 'menu' : c.kind === 'item_toggle' ? '86' : 'pause'} — ${c.status === 'gave_up' ? 'gave up after 3 tries' : `try ${c.attempts + 1}/3 at ${hhmm(c.nextAt!)}`}`,
      })),
    },
    {
      id: 'uber_weekly_report', isNew: true, ...here('uber_weekly_report'),
      fr: 'Rapport de paiement Uber chaque semaine', en: 'Weekly Uber payment report',
      ruleFr: 'Le lundi à 6 h (heure de Montréal), demande à Uber le rapport de paiement de la semaine d’avant (lundi à dimanche). Il est importé dès qu’Uber l’envoie et les cas d’argent sont revérifiés. Lit seulement : ne paie, ne conteste et ne règle rien.',
      ruleEn: 'On Monday at 6:00 (Montréal time), asks Uber for the previous week’s payment report (Monday to Sunday). It is imported as soon as Uber sends it and the money cases are re-checked. Read only: never pays, disputes or settles anything.',
      ...(sw('uber_weekly_report')?.on ? { stateFr: `Active · prochaine demande ${nextUberLabel}`, stateEn: `On · next request ${nextUberLabelEn}` } : onOff(false)),
      lastRunAt: uber?.lastAt ?? null, lastDid: runs.uber_weekly_report ?? null, pending: [],
      undoFr: 'Les demandes et les imports sont dans Argent → Relevés.', undoEn: 'Requests and imports are in Money → Statements.', undoHref: '/money/statements',
    },
    // ---- Already running before Autopilot ----
    {
      id: 'tablet_guard', isNew: false, control: 'elsewhere', on: guardOn.length > 0,
      fr: 'Garde tablette éteinte', en: 'Tablet-off guard',
      ruleFr: 'Quand toutes les tablettes d’une cuisine ouverte sont éteintes depuis quelques minutes, met ses magasins en pause pour un temps limité, puis les rouvre dès qu’une tablette revient. Jamais un magasin protégé ; une pause ou une reprise faite par une personne gagne.',
      ruleEn: 'When every tablet of an open kitchen has been off for a few minutes, pauses its stores for a limited time, then resumes them as soon as a tablet is back. Never a protected store; a pause or resume made by a person wins.',
      stateFr: guardOn.length ? `Active dans ${guardOn.length} cuisine(s) sur ${kitchens.length}${guardPaused ? ` · ${guardPaused} magasin(s) en pause par la garde` : ''}` : 'Arrêtée dans toutes les cuisines',
      stateEn: guardOn.length ? `On in ${guardOn.length} of ${kitchens.length} kitchen(s)${guardPaused ? ` · ${guardPaused} store(s) paused by the guard` : ''}` : 'Off in every kitchen',
      whereFr: 'Se règle par cuisine dans Magasins → Disponibilité', whereEn: 'Set per kitchen in Stores → Availability', href: '/stores/availability',
      lastRunAt: typeof availabilityAt === 'number' ? new Date(availabilityAt).toISOString() : null,
      lastDid: fromActivity(guardLog.find((e) => e.actor === GUARD_ACTOR.name)), pending: [],
      undoFr: 'Reprendre un magasin : Magasins → Statut', undoEn: 'Resume a store: Stores → Status', undoHref: '/stores',
    },
    {
      id: 'clover_retry', isNew: false, control: 'server', on: retryDelays.length > 0,
      fr: 'Nouvel essai Clover', en: 'Clover auto-retry',
      ruleFr: 'Quand Clover ne prend pas une commande, Food Hub réessaie seul, puis prévient un gérant. Rien n’est accepté sur la plateforme tant que Clover n’a pas la commande ; une commande acceptée à la main n’est jamais renvoyée.',
      ruleEn: 'When Clover does not take an order, Food Hub tries again by itself, then alerts a manager. Nothing is accepted on the platform until Clover has the order; an order accepted by hand is never sent again.',
      stateFr: retryDelays.length ? `Active · après ${retryDelays.map((s) => `${s} s`).join(', ')}` : 'Arrêtée (seulement « Envoyer à Clover »)',
      stateEn: retryDelays.length ? `On · after ${retryDelays.map((s) => `${s} s`).join(', ')}` : 'Off (manual “Send to Clover” only)',
      whereFr: 'Réglage du serveur (le technicien le change)', whereEn: 'Server setting (changed by the technician)', tech: 'FOODHUB_CLOVER_RETRY_S',
      lastRunAt: cloverRetryLast?.at ?? null, lastDid: fromActivity(cloverRetryLast), pending: [],
    },
    {
      id: 'timed_reopen', isNew: false, control: 'always', on: true,
      fr: 'Réouverture après une pause minutée', en: 'Re-open after a timed pause',
      ruleFr: 'À la fin d’une pause minutée, rouvre le magasin sur sa plateforme. Si la plateforme refuse, réessaie après 5, 15 puis toutes les 60 minutes.',
      ruleEn: 'When a timed pause ends, re-opens the store on its platform. If the platform refuses, tries again after 5, 15 then every 60 minutes.',
      stateFr: 'Toujours active', stateEn: 'Always on', lastRunAt: syncRan, lastDid: runs.timed_reopen ?? null, pending: [],
    },
    {
      id: 'timed_86', isNew: false, control: 'always', on: true,
      fr: 'Retour en stock après un 86 minuté', en: 'Back in stock after a timed 86',
      ruleFr: 'À la fin d’un 86 minuté, remet l’article en vente sur les plateformes (DoorDash n’a pas sa propre minuterie). Jamais sur un menu verrouillé.',
      ruleEn: 'When a timed 86 ends, puts the item back on sale on the platforms (DoorDash has no timer of its own). Never on a locked menu.',
      stateFr: 'Toujours active', stateEn: 'Always on', lastRunAt: syncRan, lastDid: runs.timed_86 ?? null, pending: [],
    },
    {
      id: 'scheduled_publish', isNew: false, control: 'always', on: true,
      fr: 'Publications programmées', en: 'Scheduled publishes',
      ruleFr: 'Publie le menu à la date et l’heure choisies dans Menus, puis note le résultat. Annulable tant qu’elle n’a pas commencé. Jamais un magasin dont le menu est verrouillé.',
      ruleEn: 'Publishes the menu at the date and time picked in Menus, then records the result. Can be cancelled until it starts. Never a store whose menu is locked.',
      stateFr: waitingPublishes.length ? `Toujours active · ${waitingPublishes.length} publication(s) prévue(s)` : 'Toujours active', stateEn: waitingPublishes.length ? `Always on · ${waitingPublishes.length} publish(es) planned` : 'Always on',
      lastRunAt: syncRan, lastDid: runs.scheduled_publish ?? null, pending: [],
      undoFr: 'Annuler une publication prévue : Menus', undoEn: 'Cancel a planned publish: Menus', undoHref: '/menu',
    },
    {
      id: 'auto_close', isNew: false, control: 'server', on: autoClose > 0,
      fr: 'Fermeture des vieilles commandes', en: 'Auto-close of stale orders',
      ruleFr: `Ferme les commandes restées en cuisine, prêtes ou en route plus de ${autoClose || 90} minutes après l’heure prévue (seulement celles des 48 dernières heures) et les marque payées dans Clover, pour garder « À traiter » propre.`,
      ruleEn: `Closes orders left in the kitchen, ready or on the way more than ${autoClose || 90} minutes after their expected time (only those of the last 48 hours) and marks them paid in Clover, to keep “To handle” clean.`,
      ...(autoClose ? { stateFr: `Active · après ${autoClose} min`, stateEn: `On · after ${autoClose} min` } : onOff(false)),
      whereFr: 'Réglage du serveur (0 = arrêtée)', whereEn: 'Server setting (0 = off)', tech: 'FOODHUB_AUTO_COMPLETE_MIN',
      lastRunAt: syncRan, lastDid: runs.auto_close ?? null, pending: [],
    },
    {
      id: 'unmapped_hint', isNew: false, control: 'elsewhere', on: unmappedOn,
      fr: 'Magasin non relié : suggestion', en: 'Unmapped store: mapping hint',
      ruleFr: 'Une commande d’un magasin de plateforme que personne n’a relié n’est jamais acceptée seule : une alerte la signale et suggère la marque et la cuisine à relier. Une personne confirme dans Magasins → Branchements.',
      ruleEn: 'An order from a platform store nobody mapped is never accepted by itself: an alert flags it and suggests the brand and kitchen to link. A person confirms in Stores → Mapping.',
      ...onOff(unmappedOn),
      whereFr: 'Règle « Commande d’un magasin non relié » dans Réglages → Alertes (propriétaire)', whereEn: 'Rule “Order from an unmapped store” in Settings → Alerts (owner)', href: '/settings/alerts',
      lastRunAt: watchLast?.at ?? null,
      lastDid: unmapped ? { at: unmapped.openedAt, status: 'info', fr: unmapped.title, en: unmapped.titleEn } : null, pending: [],
    },
    {
      id: 'clover_inventory', isNew: false, control: 'server', on: cloverInventorySyncEnabled(),
      fr: 'Inventaire Clover vers les plateformes', en: 'Clover inventory to the platforms',
      ruleFr: 'Un article épuisé ou caché dans Clover est mis en 86 sur les plateformes des magasins qui suivent ce marchand Clover, et revient seul quand Clover l’a de nouveau. Un prix changé dans Clover est seulement signalé. Jamais un menu verrouillé.',
      ruleEn: 'An item sold out or hidden in Clover is 86’d on the platforms of the stores that follow that Clover merchant, and comes back by itself when Clover has it again. A price changed in Clover is only flagged. Never a locked menu.',
      ...onOff(cloverInventorySyncEnabled()),
      whereFr: 'Réglage du serveur (« off » = arrêtée)', whereEn: 'Server setting (“off” = off)', tech: 'FOODHUB_CLOVER_INVENTORY_SYNC',
      lastRunAt: syncRan, lastDid: runs.clover_inventory ?? null, pending: [],
    },
    {
      id: 'holiday_closures', isNew: false, control: 'always', on: true,
      fr: 'Jours fériés fermés sur Skip', en: 'Closed holidays on Skip',
      ruleFr: 'Un jour férié fermé, met les magasins Skip hors ligne jusqu’au lendemain (Skip n’a pas d’heures de fête ; Uber Eats et DoorDash ferment avec le menu publié).',
      ruleEn: 'On a closed holiday, takes the Skip stores offline until the next day (Skip has no holiday hours; Uber Eats and DoorDash close with the published menu).',
      stateFr: 'Toujours active', stateEn: 'Always on', lastRunAt: syncRan, lastDid: runs.holiday_closures ?? null, pending: [],
    },
    {
      id: 'daily_recon', isNew: false, control: 'always', on: true,
      fr: 'Rapprochement quotidien', en: 'Daily reconciliation',
      ruleFr: 'Une fois par jour, revérifie les 90 derniers jours de relevés importés et ouvre ou ferme les cas d’argent à récupérer. Ne conteste rien et ne touche à aucun paiement.',
      ruleEn: 'Once a day, re-checks the last 90 days of imported statements and opens or closes money-to-recover cases. Never disputes anything or touches a payment.',
      stateFr: 'Toujours active', stateEn: 'Always on', lastRunAt: reconDay ?? null, lastDid: runs.daily_recon ?? null, pending: [],
      undoFr: 'Les cas sont dans Argent → Rapprochement.', undoEn: 'The cases are in Money → Reconciliation.', undoHref: '/money/reconciliation',
    },
  ];
  return list;
}
