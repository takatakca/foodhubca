'use client';

// TakTak, always on screen (bottom right, above the phone menu bar): one tap opens help for the current screen.
// A dot shows when the supervisor sees a connection problem.
import { useSyncExternalStore } from 'react';
import { health, subscribe } from '@/lib/ui/supervisor';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { Hint } from './hint';
import { TakTak } from './taktak';
import { useHelp } from './help-provider';

export function TakTakButton() {
  const help = useHelp();
  const { t } = useI18n();
  const h = useSyncExternalStore(subscribe, () => health(), () => 'good' as const);
  if (help.tour) return null;
  return (
    <div className="fixed right-4 bottom-20 z-[60] lg:right-5 lg:bottom-5">
      <Hint id="shell.taktak">
        <button type="button" onClick={help.openDrawer} aria-label={t('Aide — TakTak', 'Help — TakTak')} title={t('Aide (?)', 'Help (?)')}
          className="group relative flex size-14 items-center justify-center rounded-full border border-line bg-surface shadow-pop transition-transform hover:scale-105 active:scale-95">
          <TakTak size={42} spinKey={help.spin} mood={h === 'offline' ? 'alert' : h === 'good' ? 'happy' : 'think'} />
          {h !== 'good' && <span className={cn('absolute -top-0.5 -right-0.5 size-4 rounded-full border-2 border-surface', h === 'offline' ? 'bg-stop' : 'bg-wait')} />}
        </button>
      </Hint>
    </div>
  );
}
