'use client';

// Home → "Pour bien démarrer": the three set-up steps (stores, menu, kitchen tablet), computed on the server from what
// Food Hub can really see working (lib/foodhub/onboarding.ts). One button per step. Hidden when every step is done, or
// once the person taps "Masquer" (remembered on this device).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { useScopeHref } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import type { OnboardingStep } from '@/lib/foodhub/onboarding';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

const HIDE_KEY = 'takatak.home.start.hidden';

export function GettingStarted({ steps }: { steps: OnboardingStep[] | null | undefined }) {
  const { t } = useI18n();
  const { full } = useViewer();
  const href = useScopeHref();
  // Read after mount: the server never knows what this device chose.
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { setHidden(false); } }, []);
  if (!steps?.length || hidden) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* private mode */ } };
  const action: Record<string, [string, string]> = { platforms: ['Brancher mes magasins', 'Connect my stores'], menu: ['Importer mon menu', 'Import my menu'], kitchen: ['Installer la tablette', 'Set up the tablet'] };
  const title: Record<string, [string, string]> = { platforms: ['Vos magasins', 'Your stores'], menu: ['Votre menu', 'Your menu'], kitchen: ['La tablette de cuisine', 'The kitchen tablet'] };
  // In the simple view the stores step opens the store list (the platform setup page is a technician tool).
  const link = (s: OnboardingStep) => (s.key === 'platforms' && !full ? '/stores/list' : s.href);
  return (
    <section data-help="home.start" className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink">{t('Pour bien démarrer', 'Get started')}</h2>
          <p className="text-sm text-ink-3">{t(`${done} étape${done > 1 ? 's' : ''} sur ${steps.length}`, `${done} of ${steps.length} steps`)}</p>
        </div>
        <button type="button" onClick={hide} className="h-11 rounded-md px-3 text-sm font-semibold text-ink-3 hover:bg-sunken hover:text-ink">{t('Masquer', 'Hide')}</button>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold', s.done ? 'bg-go-soft text-go-2' : 'bg-sunken text-ink-2')} aria-hidden>{s.done ? <Check className="size-5" /> : i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{t(...(title[s.key] ?? [s.key, s.key]))}{s.done && <span className="sr-only"> — {t('fait', 'done')}</span>}</span>
              <span className="block text-sm text-ink-3">{t(s.detail.fr, s.detail.en)}</span>
            </span>
            {!s.done && <Link href={href(link(s))} className={buttonClass('primary', 'lg', 'shrink-0')}>{t(...(action[s.key] ?? ['Ouvrir', 'Open']))}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
