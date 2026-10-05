'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BellRing, ChefHat, CircleCheck, Flame, MonitorSmartphone, Receipt, ShoppingBag, Store, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Badge, PlatformMark, StatusDot } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, Skeleton } from '@/components/ui/card';
import { CompareLine, HBars, LineLegend, VIZ } from '@/components/charts/charts';
import { usePulse, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import type { CommandCenter } from '@/lib/foodhub/command';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

const CELL: Record<string, string> = { online: 'bg-go', closed: 'bg-ink-4', paused: 'bg-wait', deactivated: 'bg-stop', unknown: 'bg-line-2', not_synced: 'bg-info/60', missing: 'border-2 border-dashed border-line-2 bg-transparent' };

export function Overview() {
  const { t, loc, lang } = useI18n();
  const { viewer } = useViewer();
  const { pulse, scope } = usePulse();
  const [cc, setCc] = useState<CommandCenter | null>(null);
  const load = useCallback(() => api<CommandCenter>(`/api/foodhub/command${scope.length ? `?locations=${scope.join(',')}` : ''}`).then(setCc).catch(() => undefined), [scope]);
  useEffect(() => { load(); const i = setInterval(load, 20_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  const sig = pulse ? `${pulse.orders.today}|${pulse.orders.cancelled}|${pulse.stores.online}` : '';
  useEffect(() => { if (sig) load(); }, [sig, load]);

  const hour = new Date().getHours();
  const hello = hour < 12 ? t('Bonjour', 'Good morning') : hour < 18 ? t('Bon après-midi', 'Good afternoon') : t('Bonsoir', 'Good evening');
  const k = cc?.kpis;
  const vs = k && k.yesterdaySameTime ? Math.round(((k.deliverySales - k.yesterdaySameTime) / k.yesterdaySameTime) * 1000) / 10 : null;
  const nowH = new Date().getHours();
  const hours = (cc?.byHour ?? []).filter((h) => h.hour >= 6 || h.sales || h.yesterday).map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, cur: h.hour <= nowH ? h.sales : 0, prev: h.yesterday }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-ink-3 capitalize">{cc?.businessDay ?? ''}</div>
          <h1 className="text-[28px] font-extrabold tracking-tight sm:text-[32px]">{hello}, {viewer.name.split(' ')[0]} 👋</h1>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink-3"><StatusDot tone={pulse?.live ? 'go' : 'wait'} pulse={pulse?.live} />{pulse?.live ? t('Connecté en direct aux plateformes', 'Live with the platforms') : t('Mode sécurité — rien n’est envoyé aux plateformes', 'Safe mode — nothing sent to platforms')}</div>
      </div>

      {/* hero numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="col-span-2 rounded-xl bg-ink p-5 text-canvas shadow-pop lg:row-span-1">
          <div className="text-[13px] font-medium text-canvas/60">{t('Ventes aujourd’hui', 'Sales today')}</div>
          <div className="num mt-1 text-[42px] leading-none font-extrabold tracking-tight">{k ? money(k.combinedSales, loc) : '—'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-canvas/70">
            {vs !== null && <span className={cn('flex items-center gap-1 font-bold', vs >= 0 ? 'text-[#5fe3a1]' : 'text-[#ff8a8c]')}>{vs >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{vs > 0 ? '+' : ''}{vs}% {t('vs hier même heure', 'vs yesterday same time')}</span>}
            {k && <span>{t('Livraison', 'Delivery')} {money(k.deliverySales, loc)} · {t('Magasin', 'In store')} {money(k.inStore, loc)}</span>}
          </div>
        </div>
        <Kpi icon={<Receipt className="size-4" />} label={t('Commandes', 'Orders')} value={k ? String(k.deliveryOrders) : '—'} note={k ? `${t('panier', 'avg')} ${money(k.avgTicket, loc)}` : ''} />
        <Kpi icon={<ChefHat className="size-4" />} label={t('En cours', 'In progress')} value={pulse ? String(pulse.orders.open) : '—'} note={pulse?.orders.late ? <span className="font-bold text-stop">{pulse.orders.late} {t('en retard', 'late')}</span> : t('rien en retard', 'nothing late')} href="/orders" />
        <Kpi icon={<Store className="size-4" />} label={t('Magasins en ligne', 'Stores online')} value={pulse ? `${pulse.stores.online}/${pulse.stores.total}` : '—'} note={pulse && (pulse.stores.paused || pulse.stores.deactivated) ? <span className="font-bold text-wait-2">{pulse.stores.paused} {t('pause', 'paused')} · {pulse.stores.deactivated} {t('désactivé', 'deactivated')}</span> : t('tout est ouvert', 'all open')} href="/stores" />
        <Kpi icon={<BellRing className="size-4" />} label={t('Alertes', 'Alerts')} value={pulse ? String(pulse.incidents.open) : '—'} note={pulse?.incidents.critical ? <span className="font-bold text-stop">{pulse.incidents.critical} {t('critique(s)', 'critical')}</span> : t('aucune critique', 'none critical')} href="/alerts" tone={pulse?.incidents.critical ? 'stop' : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        {/* attention */}
        <Card>
          <CardHeader title={t('À faire maintenant', 'Needs you now')} subtitle={t('Le Watchtower surveille tout en continu.', 'The Watchtower watches everything, all the time.')} icon={<BellRing className="size-5" />} right={<ButtonLink href="/alerts" variant="ghost" size="sm">{t('Toutes les alertes', 'All alerts')}<ArrowRight className="size-4" /></ButtonLink>} />
          <div className="divide-y divide-line border-t border-line">
            {(pulse?.incidents.top ?? []).map((i) => (
              <Link key={i.id} href={i.orderId ? `/orders?open=${i.orderId}` : `/alerts?i=${i.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-raised">
                <StatusDot tone={i.severity === 'critical' ? 'stop' : i.severity === 'warning' ? 'wait' : 'info'} pulse={i.severity === 'critical'} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{lang === 'fr' ? i.title : i.titleEn}</span>
                {i.status === 'acknowledged' && <Badge tone="neutral">{t('pris en charge', 'on it')}</Badge>}
                <ArrowRight className="size-4 text-ink-4" />
              </Link>
            ))}
            {pulse && pulse.incidents.top.length === 0 && (
              <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-3"><CircleCheck className="size-5 text-go" />{t('Tout roule. Aucune alerte ouverte.', 'All good. No open alerts.')}</div>
            )}
            {!pulse && <div className="p-5"><Skeleton className="h-16" /></div>}
          </div>
        </Card>

        {/* platforms */}
        <Card>
          <CardHeader title={t('Plateformes aujourd’hui', 'Platforms today')} icon={<ShoppingBag className="size-5" />} />
          <div className="divide-y divide-line border-t border-line">
            {(cc?.channels ?? []).map((c) => (
              <div key={c.channel} className="flex items-center gap-3 px-5 py-3">
                <PlatformMark channel={c.channel} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{c.label}</div>
                  <div className="text-xs text-ink-3">{c.storesMapped ? `${c.storesOnline}/${c.storesMapped} ${t('magasins en ligne', 'stores online')}` : t('aucun magasin relié', 'no store mapped')}{!c.configured ? ` · ${t('à brancher', 'to connect')}` : !c.canSend && c.channel !== 'tgtg' ? ` · ${t('pas en direct', 'not live')}` : ''}</div>
                </div>
                <div className="text-right"><div className="num text-sm font-extrabold">{money(c.sales, loc)}</div><div className="text-xs text-ink-3">{c.orders} {t('cmd', 'orders')}</div></div>
              </div>
            ))}
            {cc && <div className="flex items-center gap-3 px-5 py-3"><PlatformMark channel="clover" size="md" /><div className="flex-1"><div className="text-sm font-bold">Clover · {t('en magasin', 'in store')}</div><div className="text-xs text-ink-3">{cc.clover.configured ? `${cc.kpis.inStorePayments} ${t('paiements', 'payments')}` : t('à brancher', 'to connect')}</div></div><div className="num text-sm font-extrabold">{money(cc.kpis.inStore, loc)}</div></div>}
            {!cc && <div className="p-5"><Skeleton className="h-40" /></div>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-bold">{t('Ventes par heure', 'Sales by hour')}</h2><LineLegend items={[{ label: t('Aujourd’hui', 'Today'), color: VIZ.series }, { label: t('Hier', 'Yesterday'), color: VIZ.compare, dash: true }]} /></div>
          {cc && hours.every((h) => !h.cur && !h.prev) ? <div className="flex h-52 items-center justify-center text-sm text-ink-3">{t('Pas encore de ventes aujourd’hui ni hier.', 'No sales yet today or yesterday.')}</div> : hours.length > 1 ? <CompareLine points={hours} curLabel={t('Aujourd’hui', 'Today')} prevLabel={t('Hier', 'Yesterday')} format={(n) => money(n, loc)} axisFormat={(n) => `${Math.round(n)} $`} height={220} /> : <Skeleton className="h-52" />}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-bold">{t('Meilleures marques', 'Top brands')}</h2>
          {cc ? <HBars rows={cc.byBrand.slice(0, 8).map((b) => ({ label: b.brandName, value: b.sales, detail: `${b.orders} ${t('commandes', 'orders')}` }))} format={(n) => money(n, loc)} empty={t('Pas encore de ventes aujourd’hui.', 'No sales yet today.')} /> : <Skeleton className="h-52" />}
        </Card>
      </div>

      {/* locations */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(cc?.byLocation ?? []).map((l) => {
          const kitchen = cc?.kitchen.find((x) => x.locationCode === l.locationCode);
          const tabs = (pulse?.devices.list ?? []).filter((d) => d.locationCode === l.locationCode);
          return (
            <Card key={l.locationCode} className="p-4">
              <div className="flex items-start justify-between gap-2"><div className="text-sm font-extrabold">{shortLoc(l.name)}</div>{kitchen?.isBusy ? <Badge tone="stop" icon={<Flame className="size-3" />}>{t('occupé', 'busy')}</Badge> : null}</div>
              <div className="text-xs text-ink-3">{l.address}</div>
              <div className="num mt-3 text-2xl font-extrabold">{money(l.sales + l.inStore, loc)}</div>
              <div className="text-xs text-ink-3">{l.orders} {t('cmd livraison', 'delivery orders')}{l.inStore ? ` · ${money(l.inStore, loc)} ${t('magasin', 'in store')}` : ''}</div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
                <span className="flex items-center gap-1"><ChefHat className="size-3.5" />{kitchen?.minutes ?? 15} min</span>
                {tabs.length ? tabs.map((d) => <span key={d.id} className="flex items-center gap-1"><MonitorSmartphone className="size-3.5" /><StatusDot tone={d.status === 'online' ? 'go' : 'stop'} />{d.name}</span>) : <Link href="/settings/devices" className="flex items-center gap-1 text-ink-3 hover:text-ink"><MonitorSmartphone className="size-3.5" />{t('aucune tablette', 'no tablet')}</Link>}
              </div>
            </Card>
          );
        })}
      </div>

      {/* store health: brands × locations, one square per platform */}
      <StoreHealth cc={cc} />
      {viewer.role === 'owner' && cc && !cc.dashboardProtected && <p className="text-xs text-ink-4"><Wallet className="mr-1 inline size-3.5" />{t('Astuce : définissez DASHBOARD_PASSWORD (connexion de secours) avant la mise en ligne.', 'Tip: set DASHBOARD_PASSWORD (recovery sign-in) before going live.')}</p>}
    </div>
  );
}

function Kpi({ icon, label, value, note, href, tone }: { icon: React.ReactNode; label: string; value: string; note?: React.ReactNode; href?: string; tone?: 'stop' }) {
  const body = (
    <div className={cn('h-full rounded-xl border bg-surface p-4 shadow-card transition-colors', tone === 'stop' ? 'border-stop/40' : 'border-line', href && 'hover:border-ink-4')}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3">{icon}{label}</div>
      <div className={cn('num mt-1 text-[28px] leading-tight font-extrabold', tone === 'stop' && 'text-stop')}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-3">{note}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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
