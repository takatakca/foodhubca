'use client';

// Pieces of the Alerts page (premium pass A1). The escalation steps sit under the incident title on a phone (they used to
// overlap it), and the alert channels are one quiet status line with a link to their settings, not a row of chips that
// look like filters.
import Link from 'next/link';
import { Check, Mail, MessageSquare, Phone, Settings2, Smartphone, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export type AlertChannels = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };

/** Screen → SMS → call → owner: the steps already taken are filled. */
export function EscalationLevels({ level, resolved, className }: { level: number; resolved?: boolean; className?: string }) {
  const { t } = useI18n();
  const levels = [t('Écran', 'Screen'), t('Texto', 'Text'), t('Appel', 'Call'), t('Propriétaire', 'Owner')];
  const reached = resolved ? -1 : level;
  return (
    <ol className={cn('flex flex-wrap items-center gap-1', className)} aria-label={t(`Escalade : étape ${Math.min(level, 3) + 1} sur 4`, `Escalation: step ${Math.min(level, 3) + 1} of 4`)}>
      {levels.map((l, k) => (
        <li key={l} className={cn('text-micro inline-flex h-5 items-center rounded-full px-2 font-bold', k <= reached ? (k === 0 ? 'bg-ink text-canvas' : 'bg-stop text-white') : 'bg-sunken text-ink-3')}>
          {l}
        </li>
      ))}
    </ol>
  );
}

/** "Canaux : Textos ✓ · Appels ✓ · Courriel · à brancher" + one link to the channel settings. */
export function ChannelLine({ channels, settingsHref = '/settings/channels' }: { channels: AlertChannels; settingsHref?: string }) {
  const { t } = useI18n();
  const items = [
    ['sms', t('Textos', 'Texts'), Smartphone], ['call', t('Appels', 'Calls'), Phone], ['chat', t('Clavardage équipe', 'Team chat'), MessageSquare],
    ['email', t('Courriel', 'Email'), Mail], ['ai', t('Assistant IA', 'AI assistant'), Sparkles],
  ] as const;
  const missing = items.filter(([k]) => !channels[k]).length;
  return (
    <div className="text-small mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-ink-3" data-channel-line>
      <span className="font-semibold text-ink-2">{t('Canaux d’alerte', 'Alert channels')}</span>
      {items.map(([k, label, Icon]) => (
        <span key={k} className={cn('inline-flex items-center gap-1.5', channels[k] ? 'text-ink-2' : 'text-ink-3')}>
          <Icon className="size-4" aria-hidden />{label}
          {channels[k] ? <Check className="size-4 text-go-2" aria-label={t('branché', 'connected')} /> : <span>· {t('à brancher', 'not set')}</span>}
        </span>
      ))}
      <Link href={settingsHref} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand hover:underline sm:min-h-0">
        <Settings2 className="size-4" aria-hidden />{missing ? t('Brancher les canaux', 'Connect the channels') : t('Réglages des canaux', 'Channel settings')}
      </Link>
    </div>
  );
}
