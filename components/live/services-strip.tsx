'use client';

// Overview → "Connexions et synchro", second row: e-mail, SMS, the AI, plus the screens relay and the Too Good To Go
// mailbox once they are set up (lib/foodhub/connections.ts, sent by /api/health). One live dot each, refreshed with the
// rest of the strip. The names of missing settings come from the server for the owner only; no value ever does.
import { Bot, Inbox, Mail, MessageSquare, MonitorSmartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusDot, type Tone } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n/client';

export type ServiceRow = { key: string; status: 'ok' | 'warn' | 'off'; detail: string; detailFr: string; missing?: string[] };

const NAMES: Record<string, [string, string]> = {
  email: ['Courriel', 'E-mail'], sms: ['SMS et appels', 'SMS & calls'], ai: ['IA (Claude)', 'AI (Claude)'],
  screens: ['Relais des écrans', 'Screens relay'], tgtg_email: ['Courriels Too Good To Go', 'Too Good To Go e-mails'],
};
const ICONS: Record<string, ReactNode> = {
  email: <Mail className="size-4" />, sms: <MessageSquare className="size-4" />, ai: <Bot className="size-4" />,
  screens: <MonitorSmartphone className="size-4" />, tgtg_email: <Inbox className="size-4" />,
};

export function ServicesStrip({ services }: { services: ServiceRow[] }) {
  const { t, lang } = useI18n();
  const state: Record<ServiceRow['status'], [string, Tone]> = {
    ok: [t('prêt', 'ready'), 'go'], warn: [t('à vérifier', 'needs a look'), 'wait'], off: [t('pas branché', 'not set up'), 'neutral'],
  };
  if (!services.length) return null;
  return (
    <div className="border-t border-line p-4">
      <h3 className="text-small mb-3 font-bold text-ink-2">{t('Messages et outils', 'Messages & tools')}</h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
        {services.map((s) => {
          const [word, tone] = state[s.status] ?? state.off;
          const detail = lang === 'fr' ? s.detailFr : s.detail;
          return (
            <li key={s.key} className="min-w-0 rounded-md border border-line px-3 py-2.5">
              <div className="flex items-center gap-2"><span className="text-ink-3" aria-hidden>{ICONS[s.key]}</span><span className="text-body truncate font-bold">{t(...(NAMES[s.key] ?? [s.key, s.key]))}</span></div>
              <div className="text-small mt-1.5 flex items-center gap-1.5 font-semibold"><StatusDot tone={tone} />{word}</div>
              <p className="text-small mt-0.5 text-ink-3">{detail}</p>
              {s.missing?.length ? <p className="text-micro mt-1 font-mono break-words text-ink-3">{t('À ajouter dans l’hébergeur :', 'To add in the hosting settings:')} {s.missing.join(', ')}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
