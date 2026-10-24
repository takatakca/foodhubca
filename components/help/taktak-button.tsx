'use client';

// TakTak lives in the top bar (A4 #1: a floating button covered the last table column on a desktop and the bottom bar
// on a phone). One tap opens help for the current screen. A dot shows when the supervisor sees a connection problem.
import { useSyncExternalStore } from 'react';
import { health, subscribe } from '@/lib/ui/supervisor';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { Hint } from './hint';
import { TakTak } from './taktak';
import { useHelp } from './help-provider';

export function TakTakButton({ className }: { className?: string }) {
  const help = useHelp();
  const { t } = useI18n();
  const h = useSyncExternalStore(subscribe, () => health(), () => 'good' as const);
  return (
    <Hint id="shell.taktak">
      <button type="button" onClick={help.openDrawer} aria-label={t('Aide — TakTak', 'Help — TakTak')} title={t('Aide (?)', 'Help (?)')}
        className={cn('group relative flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-sunken', className)}>
        <TakTak size={30} spinKey={help.spin} mood={h === 'offline' ? 'alert' : h === 'good' ? 'happy' : 'think'} />
        {h !== 'good' && <span className={cn('absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-canvas', h === 'offline' ? 'bg-stop' : 'bg-wait')} aria-hidden />}
      </button>
    </Hint>
  );
}
