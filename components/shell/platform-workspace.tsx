'use client';

import Link from 'next/link';
import { LayoutDashboard, MonitorPlay } from 'lucide-react';
import { usePulse, useScopeHref } from '@/components/live/pulse';
import { useViewer } from './viewer';
import { countStores, type Scope, type StorePoint } from '@/lib/foodhub/scope';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { cn } from '@/lib/ui/cn';

export const WORKSPACES = [
  { channel: undefined, label: 'Food Hub' },
  { channel: 'uber_eats', label: 'Uber Eats' },
  { channel: 'doordash', label: 'DoorDash' },
  { channel: 'skip', label: 'Skip' },
] as const;

/** Presentation separated from context so the accessible controls can be exercised directly. */
export function WorkspaceControls({ site, stores, onPick, screensHref, t }: {
  site: Scope; stores: StorePoint[]; onPick: (channel: string | undefined) => void; screensHref: string; t: T;
}) {
  const selected = WORKSPACES.find((w) => w.channel === site.channel);
  const n = countStores({ stores }, site);
  return (
    <div className="border-t border-line bg-surface px-3 py-2 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-sunken p-1 sm:w-auto sm:grid-cols-4" role="group" aria-label={t('Espace de travail', 'Workspace')}>
          {WORKSPACES.map((w) => (
            <button key={w.channel ?? 'all'} type="button" aria-pressed={site.channel === w.channel} onClick={() => onPick(w.channel)}
              className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-small font-bold transition-colors', site.channel === w.channel ? 'bg-rail text-white shadow-sm' : 'text-ink-2 hover:bg-surface hover:text-ink')}>
              {!w.channel && <LayoutDashboard className="size-4" aria-hidden />}{w.label}
            </button>
          ))}
        </div>
        <Link href={screensHref} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-small font-bold text-brand hover:bg-brand-soft">
          <MonitorPlay className="size-4" aria-hidden />{t('Tablettes virtuelles', 'Virtual tablets')}
        </Link>
        <span className="text-small text-ink-3" role="status">
          {selected?.label ?? 'Food Hub'} · {t(`${n} magasin${n === 1 ? '' : 's'} dans cette vue`, `${n} store${n === 1 ? '' : 's'} in this view`)}
        </span>
      </div>
    </div>
  );
}

/** A platform changes the existing shared scope; no separate workspace state or login is introduced. */
export function PlatformWorkspace() {
  const { viewer, stores } = useViewer();
  const { site, setSite } = usePulse();
  const href = useScopeHref();
  const { t } = useI18n();
  // An enrolled kitchen screen must continue to show and ring for every platform in its kitchen.
  if (viewer.device) return null;
  return <WorkspaceControls site={site} stores={stores} onPick={(channel) => setSite({ channel })} screensHref={href('/stores/screens')} t={t} />;
}
