'use client';

import { useI18n } from '@/lib/i18n/client';
import { Button } from '@/components/ui/button';

/** Retry renders this failed segment again; never silently replays orders. */
export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="mx-auto my-10 max-w-lg rounded-md border border-line bg-surface p-6 text-ink shadow-card sm:p-8">
      <h2 className="text-title">{t('Impossible de charger cette page', 'Could not load this page')}</h2>
      <p className="text-body mt-3 text-ink-2">{t('Vérifiez les commandes en cours avant toute action. Vous pouvez réessayer le chargement de cette page.', 'Check current orders before taking action. You can retry loading this page.')}</p>
      <Button type="button" variant="brand" size="lg" className="mt-5" onClick={reset}>{t('Réessayer', 'Try again')}</Button>
    </div>
  );
}
