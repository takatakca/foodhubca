'use client';

// "All the brands of a kitchen in one list, one tap opens one brand": the console's brand list (home and Restaurants).
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge, PlatformMark, type Tone } from '@/components/ui/badge';
import { BrandMark } from '@/components/ui/brand-mark';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import type { BrandOpenState, BrandRow, CellState } from '@/lib/foodhub/scope';
import { money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { countEn, countFr } from '@/lib/ui/count-label';
import type { T } from '@/lib/i18n';
import { cn } from '@/lib/ui/cn';

export const PLATFORM_ORDER = ['uber_eats', 'doordash', 'skip', 'tgtg'] as const;

const STATE_TONE: Record<BrandOpenState, Tone> = { open: 'go', paused: 'wait', closed: 'neutral', deactivated: 'stop', not_connected: 'neutral' };
export function openStateText(t: T, s: BrandOpenState) {
  return { open: t('Ouvert', 'Open'), paused: t('En pause', 'Paused'), closed: t('Fermé', 'Closed'), deactivated: t('Désactivé', 'Deactivated'), not_connected: t('Pas branché', 'Not connected') }[s];
}
export function cellText(t: T, s: CellState) {
  return ({ online: t('en ligne', 'online'), closed: t('fermé (heures)', 'closed (hours)'), paused: t('en pause', 'paused'), deactivated: t('désactivé', 'deactivated'), missing: t('pas branché', 'not connected'), not_synced: t('pas encore lu', 'not read yet'), unknown: t('inconnu', 'unknown') } as Record<string, string>)[s] ?? s;
}
const DOT: Partial<Record<CellState, string>> = { online: 'bg-go', paused: 'bg-wait', deactivated: 'bg-stop', closed: 'bg-ink-4', not_synced: 'bg-line-2', unknown: 'bg-line-2' };

/** One platform: its 20 px chip (11 px letters) and a 6 px state dot beside it, never on top (faded, no dot = not connected). */
export function PlatformStateDot({ channel, state }: { channel: string; state: CellState }) {
  const { t } = useI18n();
  const missing = state === 'missing';
  return (
    <span className="inline-flex items-center gap-1" title={`${channel === 'uber_eats' ? 'Uber Eats' : channel === 'doordash' ? 'DoorDash' : channel === 'skip' ? 'SkipTheDishes' : 'Too Good To Go'} · ${cellText(t, state)}`}>
      <PlatformMark channel={channel} size="xs" className={cn(missing && 'opacity-25 grayscale')} />
      <span className={cn('size-1.5 rounded-full', missing ? 'bg-transparent' : DOT[state] ?? 'bg-line-2')} aria-hidden />
    </span>
  );
}

export function BrandListRow({ row, onOpen, showKitchen }: { row: BrandRow; onOpen: () => void; showKitchen?: boolean }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const quiet = (row.state === 'not_connected' || row.state === 'deactivated' || row.state === 'closed') && !row.sales && !row.orders;
  return (
    <button type="button" onClick={onOpen}
      className="group flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised sm:gap-4 sm:px-5">
      <BrandMark name={row.brandName} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-bold text-ink">{row.brandName}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-3">
          <Badge tone={STATE_TONE[row.state]}>{openStateText(t, row.state)}</Badge>
          {showKitchen && <span className="truncate">{shortLoc(locName(row.locationCode))}</span>}
          {row.open > 0 && <span className="font-semibold text-brand">{t(`${row.open} en cours`, `${row.open} in progress`)}</span>}
        </span>
      </span>
      <span className="hidden items-center gap-2.5 sm:flex" aria-label={t('Plateformes', 'Platforms')}>
        {/* With a platform picked, a row carries that platform only. */}
        {PLATFORM_ORDER.filter((ch) => ch in row.cells || Object.keys(row.cells).length > 1).map((ch) => <PlatformStateDot key={ch} channel={ch} state={row.cells[ch] ?? 'missing'} />)}
      </span>
      {/* A brand that is off or not connected and sold nothing shows no "0,00 $ · 0": the column stays for alignment. */}
      <span className="w-24 text-right">
        {quiet ? <span className="sr-only">{t('Aucune vente aujourd’hui', 'No sales today')}</span> : <>
          <span className="num text-body block font-extrabold text-ink">{money(row.sales, loc)}</span>
          <span className="text-small block text-ink-3">{t(countFr(row.orders, 'commande'), countEn(row.orders, 'order'))}</span>
        </>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" />
    </button>
  );
}

export function BrandList({ rows, onOpen, showKitchen, empty }: { rows: BrandRow[]; onOpen: (r: BrandRow) => void; showKitchen?: boolean; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? null}</>;
  return <div className="divide-y divide-line">{rows.map((r) => <BrandListRow key={`${r.brandName}|${r.locationCode}`} row={r} showKitchen={showKitchen} onOpen={() => onOpen(r)} />)}</div>;
}

/** The legend under a brand list: what the dots mean. */
export function PlatformLegend() {
  const { t } = useI18n();
  const items: Array<[string, string]> = [['bg-go', t('en ligne', 'online')], ['bg-wait', t('en pause', 'paused')], ['bg-ink-4', t('fermé', 'closed')], ['bg-stop', t('désactivé', 'deactivated')]];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-3">
      {items.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', c)} />{l}</span>)}
      <span className="flex items-center gap-1.5"><PlatformMark channel="uber_eats" size="xs" className="opacity-25 grayscale" />{t('pâle = pas branché', 'faded = not connected')}</span>
    </div>
  );
}
