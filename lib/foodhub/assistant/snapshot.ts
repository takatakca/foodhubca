// Page awareness: a small structured snapshot of the screen the person is on — the route plus key numbers that Food Hub
// already computes server side (buildPulse for today, the menus, the stores, sales mix, reviews, disputes, Autopilot).
// The panel sends only the route (and optional page extras): numbers are always computed here, for the person's own
// kitchens, so the browser cannot feed the assistant made-up figures. Every part is best-effort: a failing source
// leaves its numbers out, it never breaks the panel.
import type { AuthUser } from '../auth';
import { CHANNEL_LABELS } from '../config';
import { buildPulse } from '../pulse';
import { getRepo } from '../repo';
import { can } from '../session';
import { startOfLocalDayMs } from '../time';
import type { ChannelKey, ChannelStore } from '../types';
import type { PageKey, PageSignal, PageSnapshot } from './types';

/** The page from the route ("/menu/86" → menu86). Query strings and fragments are ignored. */
export function pageOf(route: string): PageKey {
  const p = cleanRoute(route);
  if (p === '/') return 'home';
  if (p === '/orders') return 'orders';
  if (p.startsWith('/orders/')) return 'order';
  if (p === '/menu/86') return 'menu86';
  if (p === '/menu' || p.startsWith('/menu/')) return 'menu';
  if (p === '/stores' || p.startsWith('/stores/')) return 'stores';
  if (p.startsWith('/insights/reviews')) return 'reviews';
  if (p === '/insights' || p.startsWith('/insights/')) return 'insights';
  if (p === '/money' || p.startsWith('/money/')) return 'money';
  if (p === '/alerts' || p.startsWith('/alerts/')) return 'alerts';
  if (p.startsWith('/settings/autopilot')) return 'autopilot';
  if (p === '/settings' || p.startsWith('/settings/')) return 'settings';
  if (p === '/kitchen' || p.startsWith('/kitchen/')) return 'kitchen';
  if (p === '/direct' || p.startsWith('/direct/')) return 'direct';
  return 'other';
}

/** A console path only: "/orders?x=1#y" → "/orders"; anything else → "/". */
export function cleanRoute(route: unknown): string {
  const raw = typeof route === 'string' ? route.trim().slice(0, 200) : '';
  const path = raw.split(/[?#]/)[0];
  return /^\/[A-Za-z0-9/_\-[\].%]*$/.test(path) ? (path.length > 1 ? path.replace(/\/+$/, '') : path) : '/';
}

export const PAGE_TITLES: Record<PageKey, { fr: string; en: string }> = {
  home: { fr: 'Accueil', en: 'Home' },
  orders: { fr: 'Commandes', en: 'Orders' },
  order: { fr: 'Détail d’une commande', en: 'Order detail' },
  menu: { fr: 'Menus', en: 'Menus' },
  menu86: { fr: 'Ruptures (86)', en: 'Sold out (86)' },
  stores: { fr: 'Magasins', en: 'Stores' },
  insights: { fr: 'Statistiques', en: 'Insights' },
  reviews: { fr: 'Avis clients', en: 'Reviews' },
  money: { fr: 'Argent', en: 'Money' },
  alerts: { fr: 'Alertes', en: 'Alerts' },
  autopilot: { fr: 'Autopilote', en: 'Autopilot' },
  settings: { fr: 'Réglages', en: 'Settings' },
  kitchen: { fr: 'Cuisine', en: 'Kitchen' },
  direct: { fr: 'Commandes directes', en: 'Direct orders' },
  other: { fr: 'Food Hub', en: 'Food Hub' },
};

/** Store state as the screens show it (platform status first, then Food Hub's own online flag). */
export function storeStateOf(s: Pick<ChannelStore, 'online' | 'meta'>): string {
  return (s.meta?.platformStatus as { state?: string } | undefined)?.state ?? (s.online ? 'online' : 'paused');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Every review of the person's kitchens (no brand / platform / star / date filter). */
export const NO_REVIEW_FILTER = { brands: [], platforms: [], kitchens: [], stars: [], unanswered: false, themes: [], from: null, to: null };
type Scalar = string | number | boolean | null;

/** Page extras from the browser: only short scalar values, at most 12 keys (the panel's page-context store). */
export function cleanExtra(extra: unknown): Record<string, Scalar> | undefined {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(extra as Record<string, unknown>).slice(0, 12)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || v === null) out[k] = v as Scalar;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function buildPageSnapshot(routeIn: string, actor: Pick<AuthUser, 'role' | 'locations'>, opts: { extra?: unknown; now?: number } = {}): Promise<PageSnapshot> {
  const now = opts.now ?? Date.now();
  const route = cleanRoute(routeIn);
  const page = pageOf(route);
  const scope = actor.locations ?? [];
  const inScope = (code?: string | null) => !scope.length || (!!code && scope.includes(code));
  const numbers: PageSnapshot['numbers'] = {};
  const lists: PageSnapshot['lists'] = {};
  const signals: PageSignal[] = [];
  const snap: PageSnapshot = { route, page, titleFr: PAGE_TITLES[page].fr, titleEn: PAGE_TITLES[page].en, at: new Date(now).toISOString(), scope, numbers, lists, signals, extra: cleanExtra(opts.extra) };
  // The kitchen screen stays the kitchen's: no summary, no nudges over it.
  if (page === 'kitchen') return snap;

  // ---- Today, every page (buildPulse: orders, stores, alerts, tablets — no platform call) ----
  try {
    const pulse = await buildPulse({ locationCodes: scope.length ? scope : undefined, now });
    Object.assign(numbers, {
      salesToday: pulse.orders.sales, ordersToday: pulse.orders.today, newOrders: pulse.orders.new, preparing: pulse.orders.preparing,
      lateOrders: pulse.orders.late, cancelledToday: pulse.orders.cancelled, storesTotal: pulse.stores.total, storesOnline: pulse.stores.online,
      storesPaused: pulse.stores.paused, storesDeactivated: pulse.stores.deactivated, openAlerts: pulse.incidents.open, criticalAlerts: pulse.incidents.critical,
      tabletsTotal: pulse.devices.total, tabletsOffline: pulse.devices.offline, liveConnectors: pulse.live,
    });
    if (pulse.incidents.top.length) lists.alerts = pulse.incidents.top.map((i) => ({ severity: i.severity, title: i.title, titleEn: i.titleEn, kind: i.kind }));
    if (pulse.cancelAlerts.length) lists.recentCancels = pulse.cancelAlerts.slice(0, 5).map((c) => ({ platform: CHANNEL_LABELS[c.channel as ChannelKey] ?? c.channel, brand: c.brandName, location: c.locationCode, by: c.cancelledBy, reason: c.reason, total: c.total }));
    const cancelRate = pulse.orders.today + pulse.orders.cancelled ? pulse.orders.cancelled / (pulse.orders.today + pulse.orders.cancelled) : 0;
    if (pulse.orders.cancelled >= 3 && cancelRate >= 0.1) {
      signals.push({ id: 'cancel_spike', severity: 'warning', fr: `${pulse.orders.cancelled} commandes annulées aujourd’hui (${Math.round(cancelRate * 100)} %).`, en: `${pulse.orders.cancelled} orders cancelled today (${Math.round(cancelRate * 100)}%).`,
        questionFr: 'Pourquoi autant de commandes annulées aujourd’hui, et que faire ?', questionEn: 'Why so many cancelled orders today, and what should I do?' });
    }
    if (pulse.orders.late > 0) signals.push({ id: 'late_orders', severity: 'warning', fr: `${pulse.orders.late} commande(s) en retard.`, en: `${pulse.orders.late} late order(s).`, questionFr: 'Quelles commandes sont en retard et pourquoi ?', questionEn: 'Which orders are late and why?' });
    if (pulse.orders.new > 0) signals.push({ id: 'orders_waiting', severity: 'critical', fr: `${pulse.orders.new} commande(s) attendent une réponse.`, en: `${pulse.orders.new} order(s) waiting for an answer.`, questionFr: 'Quelles commandes attendent une réponse ?', questionEn: 'Which orders are waiting for an answer?' });
    if (pulse.stores.deactivated > 0) signals.push({ id: 'store_deactivated', severity: 'critical', fr: `${pulse.stores.deactivated} magasin(s) désactivé(s) par une plateforme.`, en: `${pulse.stores.deactivated} store(s) deactivated by a platform.`, questionFr: 'Quels magasins sont désactivés et pourquoi ?', questionEn: 'Which stores are deactivated and why?' });
    else if (pulse.stores.paused > 0) signals.push({ id: 'store_paused', severity: 'warning', fr: `${pulse.stores.paused} magasin(s) en pause.`, en: `${pulse.stores.paused} store(s) paused.`, questionFr: 'Quels magasins sont en pause, depuis quand, et faut-il les rouvrir ?', questionEn: 'Which stores are paused, since when, and should I resume them?' });
    if (pulse.devices.offline > 0) signals.push({ id: 'tablet_off', severity: 'critical', fr: `${pulse.devices.offline} tablette(s) de cuisine hors ligne.`, en: `${pulse.devices.offline} kitchen tablet(s) offline.`, questionFr: 'Quelle tablette est hors ligne et que faire ?', questionEn: 'Which tablet is offline and what should I do?' });
    if (pulse.incidents.critical > 0) signals.push({ id: 'critical_alerts', severity: 'critical', fr: `${pulse.incidents.critical} alerte(s) critique(s).`, en: `${pulse.incidents.critical} critical alert(s).`, questionFr: 'Explique-moi les alertes critiques et quoi faire en premier.', questionEn: 'Explain the critical alerts and what to do first.' });
  } catch { /* today's numbers left out */ }

  const repo = getRepo();
  // ---- Page extras ----
  try {
    if (page === 'stores' || page === 'home') {
      const stores = (await repo.listStores()).filter((s) => inScope(s.locationCode));
      const down = stores.filter((s) => storeStateOf(s) !== 'online');
      if (down.length) lists.storesNotOnline = down.slice(0, 12).map((s) => ({ storeId: s.id, platform: CHANNEL_LABELS[s.channel], brand: s.brandName, location: s.locationCode, state: storeStateOf(s), until: s.pausedUntil ?? null }));
    }
    if (page === 'menu' || page === 'menu86') {
      const menus = await repo.listMenus();
      let off = 0; const offList: Array<Record<string, Scalar>> = [];
      for (const m of menus) {
        for (const it of m.items) {
          const locs = Object.entries(m.unavailableByLocation ?? {}).filter(([code, refs]) => inScope(code) && refs.includes(it.ref)).map(([code]) => code);
          if (!it.available || locs.length) { off++; if (offList.length < 10) offList.push({ brand: m.brandName, item: it.name, ref: it.ref, where: it.available ? locs.join(', ') : 'all' }); }
        }
      }
      Object.assign(numbers, { menus: menus.length, itemsSoldOut: off });
      if (offList.length) lists.soldOut = offList;
      if (off >= 5) signals.push({ id: 'many_86', severity: 'warning', fr: `${off} articles en rupture.`, en: `${off} items sold out.`, questionFr: 'Quels articles sont en rupture et lesquels remettre en vente ?', questionEn: 'Which items are sold out and which should come back?' });
      const jobs = (await repo.listJobs(200)).filter((j) => j.status === 'error' && Date.parse(j.updatedAt) > now - 24 * 3600_000 && (j.kind === 'menu_push' || j.kind === 'item_toggle'));
      if (jobs.length) {
        numbers.menuErrors24h = jobs.length;
        signals.push({ id: 'item_errors', severity: 'warning', fr: `${jobs.length} envoi(s) de menu ou de 86 refusé(s) par une plateforme (24 h).`, en: `${jobs.length} menu or 86 update(s) refused by a platform (24 h).`, questionFr: 'Quels envois de menu ont échoué et pourquoi ?', questionEn: 'Which menu updates failed and why?' });
      }
    }
    if (page === 'insights' && can(actor.role, 'analytics:view')) {
      const { buildSalesMix } = await import('../sales-mix');
      const from = new Date(startOfLocalDayMs(now - 6 * 86400_000)).toISOString();
      const mix = await buildSalesMix({ from, to: new Date(now).toISOString(), locationCodes: scope.length ? scope : undefined }, now, 20_000);
      Object.assign(numbers, { sales7d: r2(mix.totals.sales), orders7d: mix.totals.orders, aov7d: r2(mix.totals.aov), sales7dChangePct: mix.totals.prevSales ? mix.totals.salesChange : null });
      lists.bySource7d = mix.bySource.slice(0, 8).map((s) => ({ source: s.labelEn, sales: s.sales, orders: s.orders, changePct: s.change }));
      lists.topItems7d = mix.items.slice(0, 5).map((i) => ({ item: i.name, brand: i.brand, qty: i.qty, sales: i.sales }));
    }
    if (page === 'reviews' && can(actor.role, 'analytics:view')) {
      const { findReviews } = await import('../reviews/query');
      const { summarizeReviews } = await import('../reviews/summary');
      const { scoped } = await findReviews({ locations: scope }, NO_REVIEW_FILTER);
      const sum = summarizeReviews(scoped, now).overall;
      const unanswered = scoped.filter((r) => !r.reply && (r.stars ?? 5) <= 3 && Date.parse(r.at) > now - 30 * 86400_000).length;
      Object.assign(numbers, { reviews: sum.count, avgStars: sum.avg, lowStarsUnanswered30d: unanswered });
      if (unanswered > 0) signals.push({ id: 'reviews_unanswered', severity: 'info', fr: `${unanswered} avis à 3 étoiles ou moins sans réponse (30 jours).`, en: `${unanswered} reviews of 3 stars or less without a reply (30 days).`, questionFr: 'Quels avis négatifs n’ont pas de réponse ? Propose des réponses.', questionEn: 'Which negative reviews have no reply? Suggest replies.' });
    }
    if (page === 'money' && can(actor.role, 'analytics:view') && !scope.length) {
      const { listCases, RECOVERABLE } = await import('../recon/engine');
      const cases = (await listCases({ status: ['open', 'disputed'] })).filter((c) => RECOVERABLE.includes(c.type));
      Object.assign(numbers, { disputeCases: cases.length, moneyToRecover: r2(cases.reduce((a, c) => a + c.amount, 0)) });
      if (cases.length) signals.push({ id: 'money_owed', severity: 'info', fr: `${r2(cases.reduce((a, c) => a + c.amount, 0)).toFixed(2)} $ à récupérer (${cases.length} cas).`, en: `$${r2(cases.reduce((a, c) => a + c.amount, 0)).toFixed(2)} to recover (${cases.length} cases).`, questionFr: 'Quel argent les plateformes me doivent, et par où commencer ?', questionEn: 'What money do the platforms owe me, and where do I start?' });
    }
    if (page === 'autopilot') {
      const { getSwitches, NEW_AUTOMATIONS } = await import('../autopilot');
      const sw = await getSwitches();
      numbers.autopilotOn = NEW_AUTOMATIONS.filter((id) => sw[id]?.on).length;
      numbers.autopilotTotal = NEW_AUTOMATIONS.length;
    }
  } catch { /* page extras left out */ }
  return snap;
}
