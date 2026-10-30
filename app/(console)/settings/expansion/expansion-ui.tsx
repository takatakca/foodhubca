'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkTabs } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';
import { SettingsHead } from '../settings-ui';
import { EXPANSION_LINKS } from '../settings-nav-model';
import { TechDetails } from '../tech-details';

export function ExpansionHead({ title, intro, right }: { title: string; intro?: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <SettingsHead title={title} intro={intro} right={right} />
      {/* From 1280 px the Settings side-nav lists these pages under « Services en plus »: one level of navigation. */}
      <LinkTabs className="xl:hidden" label={t('Services en plus', 'Add-ons')} tabs={EXPANSION_LINKS.map((x) => ({ href: x.href, label: t(x.fr, x.en), exact: x.exact }))} />
    </>
  );
}

/** One requirement: its name and a word (« Prêt » / « Manquant »), never a coloured dot alone; setting names fold away. */
export function ReadyItem({ ok, label, tech }: { ok: boolean; label: ReactNode; tech?: string }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 rounded-md bg-sunken px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-small min-w-0 font-semibold break-words text-ink">{label}</span><Badge tone={ok ? 'go' : 'wait'}>{ok ? t('Prêt', 'Ready') : t('Manquant', 'Missing')}</Badge></div>
      {tech && <TechDetails className="mt-1">{tech}</TechDetails>}
    </div>
  );
}

/** A value the owner copies into a platform portal (URL, header name…). Secrets are never sent to the browser. */
export function CopyValue({ label, value, mono = true }: { label: ReactNode; value: string; mono?: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-sunken py-1 pr-1 pl-3">
      <div className="min-w-0 flex-1 py-1"><div className="text-micro text-ink-3">{label}</div><div className={mono ? 'text-small font-mono break-all' : 'text-body break-words'}>{value}</div></div>
      <button type="button" className="grid size-11 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface hover:text-ink" aria-label={t('Copier', 'Copy')}
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>
        {done ? <Check className="size-4 text-go" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
