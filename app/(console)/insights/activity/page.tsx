'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, SkeletonList } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/form';
import { Chips } from '@/components/ui/form';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { activitySummary, isTechnical } from './activity-text';
import { api, downloadCsv, timeOf } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { ActivityEntry } from '@/lib/foodhub/types';

export default function ActivityPage() {
  const { t, loc, lang } = useI18n();
  const { locations, locName } = useViewer();
  const { scope } = usePulse();
  const { filters, set, query } = useFilters('today', scope);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  useEffect(() => {
    setRows(null);
    const p = new URLSearchParams(query);
    p.delete('channels'); p.delete('brands');
    if (kind && kind !== 'tech') p.set('kinds', kind);
    p.set('limit', '2000');
    api<{ entries: ActivityEntry[] }>(`/api/foodhub/activity?${p}`).then((d) => setRows(d.entries)).catch(() => setRows([]));
  }, [query, kind]);
  // « Technique » holds the screen diagnostics; every other filter (and « Tout ») leaves them out.
  const tech = kind === 'tech';
  const shown = useMemo(() => (rows ?? [])
    .filter((e) => (tech ? isTechnical(e) : !isTechnical(e)))
    .map((e) => ({ ...e, summary: activitySummary(e.summary, lang) }))
    .filter((e) => !q || `${e.summary} ${e.actor}`.toLowerCase().includes(q.toLowerCase())), [rows, q, tech, lang]);
  const KINDS = [['', t('Tout', 'All')], ['order', t('Commandes', 'Orders')], ['store_status', t('Magasins', 'Stores')], ['item_availability', t('Épuisés', 'Sold out')], ['menu_publish', t('Menus', 'Menus')], ['approval', t('Approbations NIP', 'PIN approvals')], ['incident', t('Alertes', 'Alerts')], ['login', t('Connexions', 'Sign-ins')], ['users', t('Équipe', 'Team')], ['security', t('Sécurité', 'Security')], ['device', t('Tablettes', 'Tablets')], ['message', t('Messages', 'Messages')], ['customer', t('Clients', 'Customers')], ['tech', t('Technique', 'Technical')]] as const;
  return (
    <div>
      <PageHeader title={t('Journal d’activité', 'Activity log')} subtitle={t('Qui a fait quoi, quand, où — et si ça a marché. Les actions des plateformes et de l’automatisation aussi.', 'Who did what, when, where — and whether it worked. Platform and automation actions too.')} />
      <InsightsTabs />
      <FilterBar filters={filters} set={set} locations={locations} showBrands={false}
        extra={<><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" /><Input inputSize="sm" className="h-9 w-56 pl-8" placeholder={t('Chercher', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button variant="outline" size="sm" className="h-9" disabled={!shown.length} onClick={() => downloadCsv('takatak-activite', [['Date', 'Qui', 'Source', 'Type', 'Action', 'Statut', 'Succursale', 'Résumé'], ...shown.map((e) => [e.at, e.actor, e.source, e.kind, e.action, e.status, e.locationCode ?? '', e.summary])])} icon={<Download className="size-4" />}>CSV</Button></>} />
      <Chips size="sm" className="mb-4" value={kind} onChange={setKind} options={KINDS.map(([k, l]) => ({ value: k, label: l }))} />
      <Card>
        {rows === null ? <SkeletonList count={4} className="p-4" /> : shown.length === 0 ? <EmptyState title={t('Rien pour cette période', 'Nothing in this period')} body={t('Choisissez une autre période ou un autre type.', 'Pick another period or type.')} /> : (
          <div className="divide-y divide-line">
            {shown.slice(0, 500).map((e, i) => (
              <div key={e.id ?? i} className="flex flex-wrap items-start gap-3 px-5 py-2.5 text-sm">
                <span className="num text-small w-20 shrink-0 text-ink-3">{timeOf(e.at, loc, filters.from !== filters.to)}</span>
                <Badge tone={e.status === 'success' ? 'go' : e.status === 'failed' ? 'stop' : e.status === 'queued' ? 'wait' : 'neutral'}>{e.status === 'success' ? '✓' : e.status === 'failed' ? '✕' : e.status === 'queued' ? '…' : 'i'}</Badge>
                <div className="min-w-0 flex-1"><div className="text-body break-words text-ink">{e.summary}</div><div className="text-small text-ink-3">{e.actor} · {e.source}{e.locationCode ? ` · ${shortLoc(locName(e.locationCode))}` : ''}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
