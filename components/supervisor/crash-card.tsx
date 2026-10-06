'use client';

import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TakTak } from '@/components/help/taktak';
import { flush } from '@/lib/ui/supervisor';
import { useI18n } from '@/lib/i18n/client';

export function CrashCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
      <div className="flex justify-center"><TakTak size={72} mood="think" spinKey={message} /></div>
      <h2 className="mt-3 text-xl font-extrabold text-ink">{t('Cet écran a eu un problème', 'This screen had a problem')}</h2>
      <p className="mt-2 text-[15px] text-ink-2">{t('Vos changements non enregistrés sont gardés sur cet appareil. Les commandes continuent d’arriver : le reste de la console fonctionne.', 'Your unsaved changes are kept on this device. Orders keep coming in: the rest of the console works.')}</p>
      <p className="mt-2 truncate text-xs text-ink-4" title={message}>{message}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="lg" icon={<RefreshCw className="size-4" />} onClick={onRetry}>{t('Recharger l’écran', 'Reload the screen')}</Button>
        <Button variant="outline" size="lg" icon={<Send className="size-4" />} loading={sent === 'sending'} disabled={sent === 'sent'}
          onClick={async () => { setSent('sending'); setSent((await flush(`Crash: ${message}`)) ? 'sent' : 'failed'); }}>
          {sent === 'sent' ? t('Signalé — merci', 'Reported — thank you') : sent === 'failed' ? t('Réessayer l’envoi', 'Retry sending') : t('Signaler le problème', 'Report the problem')}
        </Button>
      </div>
    </div>
  );
}
