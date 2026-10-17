'use client';

// Home → "Pour bien démarrer": the three set-up steps (stores, menu, kitchen tablet), computed on the server from what
// Food Hub can really see working (lib/foodhub/onboarding.ts). One button per step. Hidden when every step is done, or
// once the person taps "Masquer" (remembered on this device); while steps remain, one small link brings it back.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { useScopeHref } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { ConnectRequestButton } from './connect-request';
import type { OnboardingStep } from '@/lib/foodhub/onboarding';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

const HIDE_KEY = 'takatak.home.start.hidden';

export function GettingStarted({ steps }: { steps: OnboardingStep[] | null | undefined }) {
  const { t } = useI18n();
  const { full } = useViewer();
  const href = useScopeHref();
  // Read after mount: the server never knows what this device chose. null = not read yet (nothing shown).
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => { try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { setHidden(false); } }, []);
  if (!steps?.length || hidden === null) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const remember = (v: boolean) => { setHidden(v); try { if (v) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* private mode */ } };
  const left = steps.length - done;
  if (hidden) {
    return (
      <button type="button" onClick={() => remember(false)} className="flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-brand hover:underline">
        <ListChecks className="size-4" />{t(`Afficher « Pour bien démarrer » · ${left} étape${left > 1 ? 's' : ''} à faire`, `Show “Get started” · ${left} step${left > 1 ? 's' : ''} left`)}
      </button>
    );
  }
  const action: Record<string, [string, string]> = { platforms: ['Brancher mes magasins', 'Connect my stores'], menu: ['Importer mon menu', 'Import my menu'], kitchen: ['Installer la tablette', 'Set up the tablet'] };
  const title: Record<string, [string, string]> = { platforms: ['Vos magasins', 'Your stores'], menu: ['Votre menu', 'Your menu'], kitchen: ['La tablette de cuisine', 'The kitchen tablet'] };
  return (
    <section data-help="home.start" className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink">{t('Pour bien démarrer', 'Get started')}</h2>
          <p className="text-sm text-ink-3">{t(`${done} étape${done > 1 ? 's' : ''} sur ${steps.length}`, `${done} of ${steps.length} steps`)}</p>
        </div>
        <button type="button" onClick={() => remember(true)} className="h-11 rounded-md px-3 text-sm font-semibold text-ink-3 hover:bg-sunken hover:text-ink">{t('Masquer', 'Hide')}</button>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold', s.done ? 'bg-go-soft text-go-2' : 'bg-sunken text-ink-2')} aria-hidden>{s.done ? <Check className="size-5" /> : i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{t(...(title[s.key] ?? [s.key, s.key]))}{s.done && <span className="sr-only"> — {t('fait', 'done')}</span>}</span>
              <span className="block text-sm text-ink-3">{t(s.detail.fr, s.detail.en)}</span>
            </span>
            {/* In the simple view a client cannot link a platform store alone: the stores step asks the team to do it. */}
            {!s.done && (s.key === 'platforms' && !full
              ? <ConnectRequestButton className="shrink-0" />
              : <Link href={href(s.href)} className={buttonClass('primary', 'lg', 'shrink-0')}>{t(...(action[s.key] ?? ['Ouvrir', 'Open']))}</Link>)}
          </li>
        ))}
      </ol>
    </section>
  );
}
