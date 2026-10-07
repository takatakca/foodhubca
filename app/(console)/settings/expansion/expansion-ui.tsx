'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { LinkTabs } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';
import { SettingsHead } from '../settings-ui';

export function ExpansionHead({ title, intro, right }: { title: string; intro?: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <SettingsHead title={title} intro={intro} right={right} />
      <LinkTabs className="mb-5" tabs={[
        { href: '/settings/expansion', label: t('Interrupteurs', 'Switches'), exact: true },
        { href: '/settings/expansion/delivery', label: t('Livraison', 'Delivery') },
        { href: '/settings/expansion/alcohol', label: t('Alcool', 'Alcohol') },
        { href: '/settings/expansion/phone', label: t('Téléphone IA', 'AI phone') },
      ]} />
    </>
  );
}

/** A value the owner copies into a platform portal (URL, header name…). Secrets are never sent to the browser. */
export function CopyValue({ label, value, mono = true }: { label: ReactNode; value: string; mono?: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2">
      <div className="min-w-0 flex-1"><div className="text-[11px] text-ink-3">{label}</div><div className={mono ? 'truncate font-mono text-xs' : 'truncate text-sm'}>{value}</div></div>
      <button type="button" className="rounded p-1.5 text-ink-3 hover:bg-surface hover:text-ink" aria-label={t('Copier', 'Copy')}
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>
        {done ? <Check className="size-4 text-go" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
