'use client';

// "Aujourd'hui": the one dashboard. Five numbers for the scope picked in the header (every restaurant, a kitchen or one
// brand), what is cooking now, what needs someone, then the kitchens or the brands of the scope (one tap opens one).
// Everything else (sales by hour, connections, the full store grid) waits behind "Voir les détails".
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, BellRing, ChefHat, ChevronDown, ChevronRight, CircleCheck, Flame, Receipt, Store, Timer, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Badge, PlatformMark, StatusDot, type Tone } from '@/components/ui/badge';
import { Banner, Card, CardHeader, Skeleton } from '@/components/ui/card';
import { CompareLine, HBars, LineLegend, VIZ } from '@/components/charts/charts';
import { usePulse, useRefreshOn, useScopeHref } from '@/components/live/pulse';
import { BrandList, cellText, PLATFORM_ORDER, PlatformLegend, PlatformStateDot } from '@/components/live/brand-list';
import { ExpansionTiles } from '@/components/expansion/overview-tiles';
import { BrandMark } from '@/components/ui/brand-mark';
import { useScopeLabel } from '@/components/shell/scope-switcher';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import type { CommandCenter } from '@/lib/foodhub/command';
import { brandRows, type CellState } from '@/lib/foodhub/scope';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

const CELL: Record<string, string> = { online: 'bg-go', closed: 'bg-ink-4', paused: 'bg-wait', deactivated: 'bg-stop', unknown: 'bg-line-2', not_synced: 'bg-info/60', missing: 'border-2 border-dashed border-line-2 bg-transparent' };
const QUEUE_TONE: Record<string, Tone> = { new: 'brand', accepted: 'wait', ready: 'go', dispatched: 'info' };

export function Overview() {
  const { t, loc, lang } = useI18n();
  const { viewer, locations } = useViewer();
  const { pulse, site, setSite, scope, brands } = usePulse();
  const href = useScopeHref();
  const label = useScopeLabel();
  const [cc, setCc] = useState<CommandCenter | null>(null);
  const [failed, setFailed] = useState(false);
  const [details, setDetails] = useState(false);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (scope.length) q.set('locations', scope.join(','));
    if (brands.length) q.set('brands', brands.join(','));
    return q.toString();
  }, [scope, brands]);
  const load = useCallback(() => api<CommandCenter>(`/api/foodhub/command${query ? `?${query}` : ''}`).then((d) => { setCc(d); setFailed(false); }).catch(() => setFailed(true)), [query]);
  // A new scope: show the loading state rather than the previous scope's numbers.
  useEffect(() => { setCc(null); }, [query]);
  useEffect(() => { load(); const i = setInterval(load, 20_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  const sig = pulse ? `${pulse.orders.today}|${pulse.orders.cancelled}|${pulse.stores.online}|${pulse.orders.open}` : '';
  useEffect(() => { if (sig) load(); }, [sig, load]);

  // The local hour is only known in the browser: rendered after mount so the server HTML and the first client render match.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { const tick = () => setHour(new Date().getHours()); tick(); const i = setInterval(tick, 60_000); return () => clearInterval(i); }, []);
  const hello = hour === null ? t('Bonjour', 'Hello') : hour < 12 ? t('Bonjour', 'Good morning') : hour < 18 ? t('Bon après-midi', 'Good afternoon') : t('Bonsoir', 'Good evening');
  const k = cc?.kpis;
  const sales = k ? (cc?.brandScoped ? k.deliverySales : k.combinedSales) : null;
  const vs = k && k.yesterdaySameTime ? Math.round(((k.deliverySales - k.yesterdaySameTime) / k.yesterdaySameTime) * 1000) / 10 : null;
  const target = site.kitchen ? cc?.kitchen.find((x) => x.locationCode === site.kitchen) : null;
  const rows = useMemo(() => (cc ? brandRows(cc.matrix, cc.byBrandLocation, site, locations.map((l) => l.code)) : []), [cc, site, locations]);
  const nowH = hour ?? 23;
  const hours = (cc?.byHour ?? []).filter((h) => h.hour >= 6 || h.sales || h.yesterday).map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, cur: h.hour <= nowH ? h.sales : 0, prev: h.yesterday }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink-3 first-letter:uppercase">{cc?.businessDay ?? ' '}</div>
          <h1 className="mt-0.5 text-[28px] leading-tight font-extrabold tracking-tight sm:text-[32px]">{t('Aujourd’hui', 'Today')}</h1>
          <p className="mt-1 text-sm text-ink-3">{hello}, {viewer.name.split(' ')[0]}. <span className="font-semibold text-ink-2">{label.title}</span>{label.sub ? ` · ${label.sub}` : ''}</p>
        </div>
        <span className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold', pulse?.live ? 'border-go/25 bg-go-soft text-go-2' : 'border-wait/30 bg-wait-soft text-wait-2')}>
          <StatusDot tone={pulse?.live ? 'go' : 'wait'} pulse={pulse?.live} />{pulse?.live ? t('En direct avec les plateformes', 'Live with the platforms') : t('Mode sécurité : rien n’est envoyé', 'Safe mode: nothing is sent')}
        </span>
      </div>

      {failed && !cc && <Banner tone="stop">{t('Le tableau de bord ne répond pas. Vérifiez la connexion Internet : on réessaie tout seul toutes les 20 secondes. Les commandes continuent d’arriver sur les tablettes et dans Clover.', 'The dashboard is not answering. Check the Internet connection: it retries by itself every 20 seconds. Orders keep arriving on the tablets and in Clover.')}</Banner>}

      {/* The five numbers of the scope */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={<Receipt className="size-4" />} label={t('Commandes', 'Orders')} value={k ? String(k.deliveryOrders) : null} href={href('/orders')}
          note={k ? (k.deliveryOrders ? t(`panier moyen ${money(k.avgTicket, loc)}`, `average ${money(k.avgTicket, loc)}`) : t('aucune pour l’instant', 'none yet')) : null} />
        <Kpi icon={<Wallet className="size-4" />} label={cc?.brandScoped ? t('Ventes (livraison)', 'Sales (delivery)') : t('Ventes', 'Sales')} value={sales === null ? null : money(sales, loc)}
          note={vs !== null ? <span className={cn('inline-flex items-center gap-1 font-semibold', vs >= 0 ? 'text-go-2' : 'text-stop-2')}>{vs >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}{vs > 0 ? '+' : ''}{vs}% {t('vs hier', 'vs yesterday')}</span> : k ? t('rien hier à la même heure', 'nothing yesterday at this time') : null} />
        <Kpi icon={<Timer className="size-4" />} label={t('Préparation moyenne', 'Average prep')} value={k ? (k.avgPrepMin === null ? '—' : `${k.avgPrepMin} min`) : null}
          note={k ? (target ? t(`objectif ${target.minutes} min${target.isBusy ? ' (occupé)' : ''}`, `target ${target.minutes} min${target.isBusy ? ' (busy)' : ''}`) : t('acceptée → prête', 'accepted → ready')) : null}
          tone={k && target && k.avgPrepMin !== null && k.avgPrepMin > target.minutes ? 'wait' : undefined} />
        <Kpi icon={<BellRing className="size-4" />} label={t('À traiter', 'To handle')} value={pulse ? String(pulse.incidents.open) : null} href={href('/alerts')}
          note={pulse ? (pulse.incidents.critical ? <span className="font-semibold text-stop-2">{t(`${pulse.incidents.critical} urgente(s)`, `${pulse.incidents.critical} urgent`)}</span> : pulse.incidents.open ? t('rien d’urgent', 'nothing urgent') : t('tout roule', 'all good')) : null}
          tone={pulse?.incidents.critical ? 'stop' : undefined} />
        <Kpi icon={<Store className="size-4" />} label={t('Plateformes en ligne', 'Platforms online')} value={k ? `${k.storesOnline}/${k.storesMapped}` : null} href={href('/stores')} className="col-span-2 sm:col-span-1"
          note={k ? (k.storesPaused || k.storesDeactivated ? <span className="font-semibold text-wait-2">{[k.storesPaused ? t(`${k.storesPaused} en pause`, `${k.storesPaused} paused`) : '', k.storesDeactivated ? t(`${k.storesDeactivated} désactivé(s)`, `${k.storesDeactivated} deactivated`) : ''].filter(Boolean).join(' · ')}</span> : k.storesMapped ? t('tout est ouvert', 'all open') : t('aucun magasin branché', 'no store connected')) : null} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
        <LiveOrders cc={cc} />
        <Card>
          <CardHeader title={t('À traiter', 'To handle')} icon={<BellRing className="size-5" />} right={<Link href={href('/alerts')} className="flex h-9 items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-brand hover:bg-brand-soft">{t('Tout voir', 'See all')}<ArrowRight className="size-4" /></Link>} />
          <div className="divide-y divide-line border-t border-line">
            {(pulse?.incidents.top ?? []).map((i) => (
              <Link key={i.id} href={href(i.orderId ? `/orders?open=${i.orderId}` : `/alerts?i=${i.id}`)} className="flex min-h-12 items-center gap-3 px-5 py-2.5 hover:bg-raised">
                <StatusDot tone={i.severity === 'critical' ? 'stop' : i.severity === 'warning' ? 'wait' : 'info'} pulse={i.severity === 'critical'} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{lang === 'fr' ? i.title : i.titleEn}</span>
                {i.status === 'acknowledged' && <Badge tone="neutral">{t('pris en charge', 'on it')}</Badge>}
                <ChevronRight className="size-4 text-ink-4" />
              </Link>
            ))}
            {pulse && pulse.incidents.top.length === 0 && <div className="flex items-center gap-3 px-5 py-8 text-sm text-ink-3"><CircleCheck className="size-5 text-go" />{t('Tout roule. Rien à traiter.', 'All good. Nothing to handle.')}</div>}
            {!pulse && <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
          </div>
        </Card>
      </div>

      {/* The scope's restaurants: kitchens (every restaurant), the brands of a kitchen, or one brand's platforms */}
      {site.brand ? <BrandPlatforms cc={cc} brand={site.brand} />
        : site.kitchen ? (
          <Card>
            <CardHeader title={t(`Les marques de ${label.title}`, `${label.title} brands`)} subtitle={t('Touchez une marque pour la voir seule.', 'Tap a brand to see it on its own.')} icon={<Store className="size-5" />} right={<PlatformLegend />} />
            <div className="border-t border-line">
              {cc ? <BrandList rows={rows} onOpen={(r) => setSite({ kitchen: r.locationCode, brand: r.brandName })} empty={<div className="px-5 py-8 text-sm text-ink-3">{t('Aucune marque branchée dans cette cuisine. Ajoutez ses magasins dans Restaurants → Liens plateformes.', 'No brand connected in this kitchen yet. Add its stores under Restaurants → Platform links.')}</div>} />
                : <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
            </div>
          </Card>
        ) : <Kitchens cc={cc} onOpen={(code) => setSite({ kitchen: code, brand: null })} />}

      {/* Expansion: own delivery, AI phone, grocery, alcohol — only the features that are on. */}
      <ExpansionTiles />

      <div>
        <button type="button" onClick={() => setDetails(!details)} aria-expanded={details}
          className="flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-2 hover:border-line-2 hover:text-ink">
          <ChevronDown className={cn('size-4 transition-transform', details && 'rotate-180')} />{details ? t('Cacher les détails', 'Hide details') : t('Voir les détails : ventes par heure, connexions, grille des magasins', 'See details: sales by hour, connections, store grid')}
        </button>
        {details && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Card className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-bold">{t('Ventes par heure', 'Sales by hour')}</h2><LineLegend items={[{ label: t('Aujourd’hui', 'Today'), color: VIZ.series }, { label: t('Hier', 'Yesterday'), color: VIZ.compare, dash: true }]} /></div>
                {cc && hours.every((h) => !h.cur && !h.prev) ? <div className="flex h-52 items-center justify-center text-sm text-ink-3">{t('Pas encore de ventes aujourd’hui ni hier.', 'No sales yet today or yesterday.')}</div> : hours.length > 1 ? <CompareLine points={hours} curLabel={t('Aujourd’hui', 'Today')} prevLabel={t('Hier', 'Yesterday')} format={(n) => money(n, loc)} axisFormat={(n) => `${Math.round(n)} $`} height={220} /> : <Skeleton className="h-52" />}
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-[15px] font-bold">{site.brand ? t('Par plateforme', 'By platform') : t('Meilleures marques', 'Top brands')}</h2>
                {!cc ? <Skeleton className="h-52" /> : site.brand
                  ? <HBars rows={cc.channels.filter((c) => c.orders).map((c) => ({ label: c.label, value: c.sales, detail: `${c.orders} ${t('commandes', 'orders')}` }))} format={(n) => money(n, loc)} empty={t('Pas encore de ventes aujourd’hui.', 'No sales yet today.')} />
                  : <HBars rows={cc.byBrand.slice(0, 8).map((b) => ({ label: b.brandName, value: b.sales, detail: `${b.orders} ${t('commandes', 'orders')}` }))} format={(n) => money(n, loc)} empty={t('Pas encore de ventes aujourd’hui.', 'No sales yet today.')} />}
              </Card>
            </div>
            <Connections />
            {!site.brand && <StoreHealth cc={cc} />}
            {viewer.role === 'owner' && cc && !cc.dashboardProtected && <p className="text-xs text-ink-3"><Wallet className="mr-1 inline size-3.5" />{t('Astuce : définissez DASHBOARD_PASSWORD (connexion de secours) avant la mise en ligne.', 'Tip: set DASHBOARD_PASSWORD (recovery sign-in) before going live.')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, note, href, tone, className }: { icon: ReactNode; label: string; value: string | null; note?: ReactNode; href?: string; tone?: 'stop' | 'wait'; className?: string }) {
  const body = (
    <div className={cn('h-full rounded-xl border bg-surface p-4 shadow-card transition-colors sm:p-5', tone === 'stop' ? 'border-stop/40' : tone === 'wait' ? 'border-wait/40' : 'border-line', href && 'hover:border-brand/40', className)}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3">{icon}{label}</div>
      {value === null ? <Skeleton className="mt-2 h-8 w-20" /> : <div className={cn('num mt-1 text-[28px] leading-tight font-extrabold tracking-tight', tone === 'stop' ? 'text-stop' : tone === 'wait' ? 'text-wait-2' : 'text-ink')}>{value}</div>}
      <div className="mt-1 min-h-4 text-xs text-ink-3">{note ?? (value === null ? <Skeleton className="h-3 w-24" /> : null)}</div>
    </div>
  );
  return href ? <Link href={href} className={cn('block', className)}>{body}</Link> : body;
}

function minutesAgo(iso: string, now: number) {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/** What is cooking right now in the scope (6 at most); the full board is one tap away. */
function LiveOrders({ cc }: { cc: CommandCenter | null }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const { site } = usePulse();
  const href = useScopeHref();
  const queue = (cc?.queue ?? []).filter((o) => !o.waitingScheduled);
  const scheduled = (cc?.queue ?? []).length - queue.length;
  const now = cc ? Date.parse(cc.generatedAt) : 0;
  const status = (s: string) => ({ new: t('Nouvelle', 'New'), accepted: t('En préparation', 'Preparing'), ready: t('Prête', 'Ready'), dispatched: t('Partie', 'Picked up') } as Record<string, string>)[s] ?? s;
  return (
    <Card>
      <CardHeader title={t('En cours', 'In progress')} icon={<ChefHat className="size-5" />}
        subtitle={cc ? (queue.length ? t(`${queue.length} commande(s)${scheduled ? ` · ${scheduled} planifiée(s)` : ''}`, `${queue.length} order(s)${scheduled ? ` · ${scheduled} scheduled` : ''}`) : t('Rien sur le feu.', 'Nothing cooking.')) : ' '}
        right={<Link href={href('/orders')} className="flex h-9 items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-brand hover:bg-brand-soft">{t('Toutes les commandes', 'All orders')}<ArrowRight className="size-4" /></Link>} />
      <div className="divide-y divide-line border-t border-line">
        {queue.slice(0, 6).map((o) => (
          <Link key={o.id} href={href(`/orders?open=${o.id}`)} className="flex min-h-14 items-center gap-3 px-5 py-2.5 hover:bg-raised">
            <PlatformMark channel={o.channel} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><span className="text-sm font-extrabold">#{o.displayId}</span><Badge tone={QUEUE_TONE[o.status] ?? 'neutral'}>{status(o.status)}</Badge></span>
              <span className="block truncate text-xs text-ink-3">{[site.brand ? null : o.brandName, site.kitchen ? null : o.locationCode ? shortLoc(locName(o.locationCode)) : null, `${o.items} ${t('art.', 'items')}`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="text-right">
              <span className="num block text-sm font-bold">{money(o.total, loc)}</span>
              <span className="block text-xs text-ink-3">{t(`il y a ${minutesAgo(o.createdAt, now)} min`, `${minutesAgo(o.createdAt, now)} min ago`)}</span>
            </span>
          </Link>
        ))}
        {cc && queue.length === 0 && <div className="flex items-center gap-3 px-5 py-8 text-sm text-ink-3"><CircleCheck className="size-5 text-go" />{t('Aucune commande en cours. Les nouvelles s’ouvrent toutes seules à l’écran.', 'No order in progress. New ones pop up on screen by themselves.')}</div>}
        {!cc && <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {queue.length > 6 && <Link href={href('/orders')} className="flex h-11 items-center justify-center text-[13px] font-semibold text-brand hover:bg-raised">{t(`Voir les ${queue.length - 6} autres`, `See the other ${queue.length - 6}`)}</Link>}
      </div>
    </Card>
  );
}

/** Every restaurant: one line per kitchen (brands open, orders, sales). One tap shows that kitchen's brands. */
function Kitchens({ cc, onOpen }: { cc: CommandCenter | null; onOpen: (code: string) => void }) {
  const { t, loc } = useI18n();
  const { locations } = useViewer();
  const { pulse } = usePulse();
  return (
    <Card>
      <CardHeader title={t('Vos cuisines', 'Your kitchens')} subtitle={t('Touchez une cuisine pour voir toutes ses marques.', 'Tap a kitchen to see all its brands.')} icon={<Store className="size-5" />} />
      <div className="divide-y divide-line border-t border-line">
        {!cc && <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
        {cc && locations.map((l) => {
          const rows = cc.matrix.filter((r) => r.locationCode === l.code);
          const open = rows.filter((r) => PLATFORM_ORDER.some((ch) => r.cells[ch]?.state === 'online')).length;
          const stats = cc.byLocation.find((x) => x.locationCode === l.code);
          const busy = cc.kitchen.find((x) => x.locationCode === l.code)?.isBusy;
          const tabs = (pulse?.devices.list ?? []).filter((d) => d.locationCode === l.code);
          return (
            <button key={l.code} type="button" onClick={() => onOpen(l.code)} className="group flex min-h-16 w-full items-center gap-4 px-5 py-3 text-left hover:bg-raised">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rail text-electric"><Store className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate text-[15px] font-bold">{shortLoc(l.name)}</span>{busy && <Badge tone="stop" icon={<Flame className="size-3" />}>{t('occupé', 'busy')}</Badge>}</span>
                <span className="block truncate text-xs text-ink-3">{l.address} · {rows.length ? t(`${open}/${rows.length} marques ouvertes`, `${open}/${rows.length} brands open`) : t('aucune marque branchée', 'no brand connected')}{tabs.length ? ` · ${tabs.filter((d) => d.status === 'online').length}/${tabs.length} ${t('tablette(s)', 'tablet(s)')}` : ''}</span>
              </span>
              <span className="w-28 text-right">
                <span className="num block text-[15px] font-extrabold">{money((stats?.sales ?? 0) + (stats?.inStore ?? 0), loc)}</span>
                <span className="block text-xs text-ink-3">{stats?.orders ?? 0} {t('cmd', 'orders')}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-4 group-hover:text-ink-2" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** One brand: its platforms in each kitchen of the scope, with their state. Pause / resume live in Restaurants. */
function BrandPlatforms({ cc, brand }: { cc: CommandCenter | null; brand: string }) {
  const { t } = useI18n();
  const { locName } = useViewer();
  const href = useScopeHref();
  const rows = (cc?.matrix ?? []).filter((r) => r.brandName === brand);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2.5"><BrandMark name={brand} size="sm" />{t(`${brand} sur les plateformes`, `${brand} on the platforms`)}</span>}
        right={<Link href={href('/stores')} className="flex h-9 items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-brand hover:bg-brand-soft">{t('Pause, réouverture, heures', 'Pause, resume, hours')}<ArrowRight className="size-4" /></Link>} />
      <div className="border-t border-line">
        {!cc && <div className="space-y-2 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
        {cc && rows.length === 0 && <div className="px-5 py-8 text-sm text-ink-3">{t('Cette marque n’a aucun magasin branché ici.', 'This brand has no store connected here.')}</div>}
        {rows.map((r) => (
          <div key={r.locationCode} className="border-b border-line last:border-b-0">
            {rows.length > 1 && <div className="bg-raised px-5 py-2 text-xs font-bold tracking-[0.08em] text-ink-3 uppercase">{shortLoc(locName(r.locationCode))}</div>}
            <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
              {PLATFORM_ORDER.map((ch) => {
                const c = r.cells[ch];
                return (
                  <div key={ch} className="flex items-center gap-3 px-5 py-3.5">
                    <PlatformStateDot channel={ch} state={(c?.state ?? 'missing') as CellState} />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{{ uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', tgtg: 'Too Good To Go' }[ch]}</span>
                      <span className="block truncate text-xs text-ink-3" title={c?.detail}>{cellText(t, (c?.state ?? 'missing') as CellState)}{c?.source === 'screenshot' ? ` · ${t('pas encore vérifié', 'not verified yet')}` : ''}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type CheckStatus = 'ok' | 'warn' | 'down';
type Health = {
  status: 'ok' | 'degraded' | 'down'; at: string;
  checks: Record<string, { status: CheckStatus; detail: string; detailFr: string; at?: string | null }>;
  platforms: Array<{ channel: string; label: string; mode: 'direct' | 'via_clover' | 'inbound' | 'not_connected'; live: boolean; stores: number; lastOrderAt: string | null }>;
};
const TONE: Record<CheckStatus, 'go' | 'wait' | 'stop'> = { ok: 'go', warn: 'wait', down: 'stop' };

/** "Is everything connected right now?" — the same answer an outside monitor gets from /api/health, with details. */
function Connections() {
  const { t, lang, loc } = useI18n();
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((d: Health) => { if (d?.checks) setH(d); }).catch(() => undefined);
    void load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, []);
  // Ages are measured against the report's own time (refreshed every 30 s), so rendering stays pure.
  const ago = (iso: string | null | undefined) => {
    if (!iso) return t('jamais', 'never');
    const m = Math.round((Date.parse(h?.at ?? iso) - Date.parse(iso)) / 60_000);
    return m < 1 ? t('à l’instant', 'just now') : m < 60 ? t(`il y a ${m} min`, `${m} min ago`) : m < 48 * 60 ? t(`il y a ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`) : new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  };
  const NAMES: Record<string, [string, string]> = { database: ['Base de données', 'Database'], sync: ['Synchro', 'Sync'], watchtower: ['Watchtower', 'Watchtower'], recovery: ['Reprise des commandes', 'Order recovery'], inbox: ['Webhooks', 'Webhooks'], clover: ['Clover', 'Clover'], console: ['Écrans et connexion', 'Screens & sign-in'] };
  const mode = (p: Health['platforms'][number]): [string, 'go' | 'wait' | 'stop' | 'info'] => p.mode === 'via_clover' ? [t('par Clover', 'via Clover'), 'info']
    : p.mode === 'not_connected' ? [t('à brancher', 'to connect'), 'stop'] : p.mode === 'inbound' ? [t('réception', 'inbound'), 'info'] : p.live ? [t('en direct', 'live'), 'go'] : [t('prêt, pas en direct', 'ready, not live'), 'wait'];
  const overall: [string, 'go' | 'wait' | 'stop'] = !h ? [t('Vérification…', 'Checking…'), 'wait'] : h.status === 'ok' ? [t('Tout est branché', 'Everything connected'), 'go'] : h.status === 'degraded' ? [t('À surveiller', 'Needs a look'), 'wait'] : [t('Problème — des commandes peuvent être manquées', 'Problem — orders could be missed'), 'stop'];
  return (
    <Card>
      <CardHeader title={t('Connexions et synchro', 'Connections & sync')} icon={<Activity className="size-5" />}
        subtitle={t('Plateformes, Clover, réception des commandes et surveillance — mis à jour toutes les 30 s.', 'Platforms, Clover, order intake and supervision — refreshed every 30 s.')}
        right={<span className="flex items-center gap-2 text-sm font-semibold"><StatusDot tone={overall[1]} pulse={overall[1] === 'stop'} />{overall[0]}</span>} />
      {/* min-w-0: the long check texts truncate instead of widening their column and squeezing the platform tiles. */}
      <div className="grid grid-cols-1 gap-0 border-t border-line lg:grid-cols-[1.25fr_1fr]">
        <div className="grid min-w-0 auto-rows-fr grid-cols-2 gap-px bg-line sm:grid-cols-4 lg:border-r lg:border-line">
          {(h?.platforms ?? []).map((p) => {
            const [m, tone] = mode(p);
            return (
              <div key={p.channel} className="bg-surface px-4 py-3">
                <div className="flex items-center gap-2"><PlatformMark channel={p.channel} size="sm" /><span className="truncate text-sm font-bold">{p.label}</span></div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold"><StatusDot tone={tone === 'info' ? 'info' : tone} />{m}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">{p.stores} {t('magasin(s)', 'store(s)')} · {t('dernière cmd', 'last order')} {ago(p.lastOrderAt)}</div>
              </div>
            );
          })}
          {!h && <div className="col-span-full bg-surface p-4"><Skeleton className="h-14" /></div>}
        </div>
        <ul className="min-w-0 divide-y divide-line border-t border-line lg:border-t-0">
          {Object.entries(h?.checks ?? {}).map(([k, c]) => (
            <li key={k} className="flex items-start gap-2.5 px-4 py-2" title={lang === 'fr' ? c.detailFr : c.detail}>
              <StatusDot tone={TONE[c.status]} pulse={c.status === 'down'} className="mt-1" />
              <span className="w-36 shrink-0 text-[13px] font-semibold">{t(...(NAMES[k] ?? [k, k]))}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{lang === 'fr' ? c.detailFr : c.detail}</span>
            </li>
          ))}
          {!h && <li className="p-4"><Skeleton className="h-24" /></li>}
        </ul>
      </div>
    </Card>
  );
}

const CH = ['uber_eats', 'doordash', 'skip', 'tgtg'] as const;

function StoreHealth({ cc }: { cc: CommandCenter | null }) {
  const { t } = useI18n();
  const { locName } = useViewer();
  const [onlyIssues, setOnlyIssues] = useState(false);
  const matrix = cc?.matrix ?? [];
  const locs = [...new Set((cc?.byLocation ?? []).map((l) => l.locationCode))];
  const brands = [...new Set(matrix.map((r) => r.brandName))].filter((b) => !onlyIssues || matrix.some((r) => r.brandName === b && r.issues > 0));
  const issues = matrix.filter((r) => r.issues > 0).length;
  const stateLabel = (s: string) => ({ online: t('en ligne', 'online'), closed: t('fermé (heures)', 'closed (hours)'), paused: t('en pause', 'paused'), deactivated: t('désactivé', 'deactivated'), missing: t('pas branché', 'not connected'), not_synced: t('pas encore lu', 'not read yet'), unknown: t('inconnu', 'unknown') } as Record<string, string>)[s] ?? s;
  return (
    <Card>
      <CardHeader title={t('Santé des magasins', 'Store health')} icon={<Store className="size-5" />}
        subtitle={t('Chaque marque, chaque succursale : Uber Eats · DoorDash · Skip (obligatoires) · TGTG.', 'Every brand, every location: Uber Eats · DoorDash · Skip (required) · TGTG.')}
        right={<>
          <div className="hidden flex-wrap gap-3 text-xs text-ink-3 md:flex">{[['online', t('en ligne', 'online')], ['closed', t('fermé', 'closed')], ['paused', t('pause', 'paused')], ['deactivated', t('désactivé', 'deactivated')], ['missing', t('manquant', 'missing')]].map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={cn('size-3 rounded-[4px]', CELL[k])} />{l}</span>)}</div>
          <button type="button" onClick={() => setOnlyIssues(!onlyIssues)} className={cn('h-8 rounded-full border px-3 text-xs font-semibold', onlyIssues ? 'border-ink bg-ink text-canvas' : 'border-line-2 text-ink-2')}>{t(`À corriger (${issues})`, `To fix (${issues})`)}</button>
        </>} />
      <div className="scrollbar-thin overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <thead><tr><th className="bg-raised px-5 py-2.5 text-left text-xs font-semibold text-ink-3">{t('Marque', 'Brand')}</th>{locs.map((l) => <th key={l} className="bg-raised px-3 py-2.5 text-left text-xs font-semibold text-ink-3">{shortLoc(locName(l))}</th>)}</tr></thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b} className="border-t border-line hover:bg-raised/60">
                <td className="px-5 py-2.5 font-semibold whitespace-nowrap">{b}</td>
                {locs.map((l) => {
                  const r = matrix.find((x) => x.brandName === b && x.locationCode === l);
                  return (
                    <td key={l} className="px-3 py-2.5">
                      {r ? <div className="flex items-center gap-1">{CH.map((c) => <span key={c} title={`${c} · ${stateLabel(r.cells[c].state)}${r.cells[c].detail ? ` · ${r.cells[c].detail}` : ''}${r.cells[c].source === 'screenshot' ? ` · ${t('selon vos captures', 'from your screenshots')}` : ''}`} className={cn('size-4 rounded-[5px]', CELL[r.cells[c].state] ?? CELL.unknown, r.cells[c].source === 'screenshot' && 'opacity-55')} />)}{r.issues > 0 && <span className="ml-1 text-[11px] font-bold text-stop">{r.issues}</span>}</div> : <span className="text-ink-4">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!cc && <div className="p-5"><Skeleton className="h-40" /></div>}
        {cc && <div className="border-t border-line px-5 py-2.5 text-xs text-ink-3">{t('Ordre des carrés : Uber Eats · DoorDash · Skip · TGTG. Pâle = selon vos captures d’écran, pas encore vérifié en direct.', 'Square order: Uber Eats · DoorDash · Skip · TGTG. Faded = from your screenshots, not verified live yet.')} <Link href="/stores" className="font-semibold text-ink underline-offset-4 hover:underline">{t('Gérer les magasins', 'Manage stores')} →</Link></div>}
      </div>
    </Card>
  );
}
