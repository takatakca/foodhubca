'use client';

// Restaurants → Tous les magasins: every platform store (one brand, on one platform, at one location) in one flat
// table, like a merchant portal's store list. Status only; pause, reopen and prep time stay on "Statut et pauses"
// ("Gérer" opens it on that brand). Follows the console's scope (location, brand, platform).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, Plug, Search, Store } from 'lucide-react';
import { PlatformTag, StatusDot, type Tone } from '@/components/ui/badge';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { usePulse, useRefreshOn, useScopeHref } from '@/components/live/pulse';
import { ScopeChips, FilterChip } from '@/components/shell/scope-chips';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { inScope, scopeHref } from '@/lib/foodhub/scope';
import type { ChannelStore } from '@/lib/foodhub/types';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { stateOf, stateText } from '../stores-view';
import { StoresTabs } from '../stores-tabs';

const PAGE = 25;
const STATUSES = ['online', 'paused', 'closed', 'deactivated', 'unknown'] as const;
/** Deactivated first, then paused, then the rest. */
const RANK: Record<string, number> = { deactivated: 0, paused: 1 };
const DOT: Record<string, Tone> = { online: 'go', paused: 'wait', deactivated: 'stop', closed: 'neutral', unknown: 'neutral' };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function StoresList() {
  const { t } = useI18n();
  const { full, can, locations, locName } = useViewer();
  const { site, setSite } = usePulse();
  const href = useScopeHref();
  const router = useRouter();
  const [stores, setStores] = useState<ChannelStore[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    const d = await api<{ stores: ChannelStore[] }>('/api/foodhub/stores').catch(() => null);
    setFailed(!d);
    if (d) setStores(d.stores);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  useEffect(() => { setPage(0); }, [site, status, q]);

  const statusLabel = (s: string) => ({ online: t('Ouverts', 'Open'), paused: t('En pause', 'Paused'), closed: t('Fermés (heures)', 'Closed (hours)'), deactivated: t('Désactivés', 'Deactivated'), unknown: t('Pas encore lus', 'Not read yet') } as Record<string, string>)[s] ?? s;
  const inScopeRows = useMemo(() => (stores ?? []).filter((s) => inScope(s, site)), [stores, site]);
  const rows = useMemo(() => {
    const term = fold(q.trim());
    return inScopeRows
      .map((s) => ({ s, st: stateOf(s) }))
      .filter(({ s, st }) => (!status || (status === 'unknown' ? !STATUSES.slice(0, 4).includes(st.state as never) : st.state === status)) && (!term || fold(s.brandName).includes(term)))
      .sort((a, b) => (RANK[a.st.state] ?? 2) - (RANK[b.st.state] ?? 2) || a.s.brandName.localeCompare(b.s.brandName, 'fr', { sensitivity: 'base' }) || a.s.locationCode.localeCompare(b.s.locationCode) || a.s.channel.localeCompare(b.s.channel));
  }, [inScopeRows, status, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of inScopeRows) { const k = stateOf(s).state; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [inScopeRows]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const manage = (s: ChannelStore) => router.push(scopeHref('/stores', { kitchen: s.locationCode, brand: s.brandName, ...(site.channel ? { channel: site.channel } : {}) }));
  const showAll = () => { setStatus(null); setQ(''); setSite({ kitchen: null, brand: null, channel: undefined }); };
  const help = () => window.dispatchEvent(new Event('takatak:help'));
  const address = (code: string) => locations.find((l) => l.code === code)?.address;
  const n = inScopeRows.length;
  const summary = [
    t(`${n} magasin${n > 1 ? 's' : ''}`, `${n} store${n > 1 ? 's' : ''}`),
    counts.online ? t(`${counts.online} ouvert${counts.online > 1 ? 's' : ''}`, `${counts.online} open`) : null,
    counts.paused ? t(`${counts.paused} en pause`, `${counts.paused} paused`) : null,
    counts.closed ? t(`${counts.closed} fermé${counts.closed > 1 ? 's' : ''} (heures)`, `${counts.closed} closed (hours)`) : null,
    counts.deactivated ? t(`${counts.deactivated} désactivé${counts.deactivated > 1 ? 's' : ''}`, `${counts.deactivated} deactivated`) : null,
  ].filter(Boolean).join(' · ');
  const connect = full && can('stores:map');

  return (
    <div data-help="stores.list">
      <PageHeader title={t('Tous les magasins', 'All stores')} subtitle={t('Chaque marque, sur chaque plateforme, dans chaque succursale.', 'Every brand, on every platform, at every location.')}
        right={connect ? <ButtonLink href={href('/stores/mapping')} variant="outline" size="lg" icon={<Plug className="size-4" />}>{t('Brancher un magasin', 'Connect a store')}</ButtonLink> : undefined} />
      <StoresTabs />
      {failed && !stores && <Banner tone="stop" className="mb-4">{t('La liste des magasins ne répond pas. On réessaie toutes les 30 secondes.', 'The store list is not answering. It retries every 30 seconds.')}</Banner>}
      <ScopeChips extraActive={Boolean(status || q.trim())} onClearExtra={() => { setStatus(null); setQ(''); }} extra={<>
        <FilterChip label={t('Statut', 'Status')} allLabel={t('Tous', 'All')} value={status} onClear={() => setStatus(null)} onPick={setStatus}
          options={STATUSES.map((s) => ({ key: s, label: statusLabel(s), note: String(s === 'unknown' ? n - STATUSES.slice(0, 4).reduce((a, k) => a + (counts[k] ?? 0), 0) : counts[s] ?? 0) }))} />
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input inputSize="sm" className="h-11 w-full pl-8 sm:h-9 sm:w-56" placeholder={t('Chercher une marque', 'Search a brand')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Chercher une marque', 'Search a brand')} />
        </div>
      </>} />
      {stores && n > 0 && <p className="mb-3 text-sm font-semibold text-ink-2">{summary}</p>}
      <Card>
        {!stores ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : (stores.length === 0 ? (
            <EmptyState icon={<Store className="size-6" />} title={t('Aucun magasin branché pour l’instant.', 'No store connected yet.')}
              action={connect ? <ButtonLink href={href('/stores/mapping')} variant="primary" size="lg">{t('Brancher un magasin', 'Connect a store')}</ButtonLink> : <Button variant="primary" size="lg" icon={<CircleHelp className="size-4" />} onClick={help}>{t('Demander de l’aide', 'Ask for help')}</Button>} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Search className="size-6" />} title={t('Aucun magasin pour ce choix.', 'No store for this choice.')} action={<Button variant="outline" size="lg" onClick={showAll}>{t('Tout afficher', 'Show everything')}</Button>} />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>{t('Statut', 'Status')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Succursale', 'Location')}</Th>{full && <Th>{t('No de magasin', 'Store #')}</Th>}<Th align="right"><span className="sr-only">{t('Gérer', 'Manage')}</span></Th></tr></thead>
                  <tbody>
                    {shown.map(({ s, st }) => (
                      <Tr key={s.id}>
                        <Td><span className="flex items-center gap-2 font-semibold whitespace-nowrap"><StatusDot tone={DOT[st.state] ?? 'neutral'} />{stateText(t, st.state)}</span></Td>
                        <Td><span className="flex items-center gap-2.5 font-semibold"><BrandMark name={s.brandName} size="xs" />{s.brandName}</span></Td>
                        <Td><PlatformTag channel={s.channel} /></Td>
                        <Td><span className="block font-semibold">{shortLoc(locName(s.locationCode))}</span>{address(s.locationCode) && <span className="block text-xs text-ink-3">{address(s.locationCode)}</span>}</Td>
                        {full && <Td className="font-mono text-xs text-ink-3">{s.channelStoreId}</Td>}
                        <Td align="right"><Button variant="soft" size="md" onClick={() => manage(s)}>{t('Gérer', 'Manage')}<ChevronRight className="size-4" /></Button></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {shown.map(({ s, st }) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => manage(s)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                      <BrandMark name={s.brandName} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-ink">{s.brandName}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3"><PlatformTag channel={s.channel} className="text-xs font-medium" /><span>{shortLoc(locName(s.locationCode))}</span></span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-2"><StatusDot tone={DOT[st.state] ?? 'neutral'} />{stateText(t, st.state)}</span>
                      <ChevronRight className="size-4 shrink-0 text-ink-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {rows.length > PAGE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
                  <span className="text-ink-3">{t(`Affichage ${page * PAGE + 1}–${Math.min(rows.length, page * PAGE + PAGE)} de ${rows.length}`, `Showing ${page * PAGE + 1}–${Math.min(rows.length, page * PAGE + PAGE)} of ${rows.length}`)}</span>
                  <span className="flex gap-2">
                    <Button variant="outline" size="lg" disabled={page === 0} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />}>{t('Précédent', 'Previous')}</Button>
                    <Button variant="outline" size="lg" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('Suivant', 'Next')}<ChevronRight className="size-4" /></Button>
                  </span>
                </div>
              )}
            </>
          ))}
      </Card>
      {stores && stores.length > 0 && (
        <p className={cn('mt-4 text-sm text-ink-3')}>
          {connect
            ? <Link href={href('/stores/mapping')} className="font-semibold text-brand hover:underline">{t('Brancher un magasin', 'Connect a store')} →</Link>
            : <>{t('Il manque un magasin ?', 'A store is missing?')} <button type="button" onClick={help} className="min-h-11 font-semibold text-brand hover:underline">{t('Ouvrez l’aide, on le branche pour vous.', 'Open the help, we connect it for you.')}</button></>}
        </p>
      )}
    </div>
  );
}
