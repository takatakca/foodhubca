'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/card';
import { useViewer } from '@/components/shell/viewer';
import { SETTINGS_PAGES, roleLabel } from './settings-ui';
import { useI18n } from '@/lib/i18n/client';

export default function SettingsHub() {
  const { t } = useI18n();
  const { can, viewer } = useViewer();
  const pages = SETTINGS_PAGES.filter((p) => can(p.perm));
  return (
    <div>
      <PageHeader eyebrow={t('Réglages', 'Settings')} title={t('Réglages', 'Settings')} subtitle={<span className="flex flex-wrap items-center gap-2">{viewer.name}<Badge tone="dark">{roleLabel(t, viewer.role)}</Badge>{viewer.device && <Badge tone="info">{t('Tablette', 'Tablet')} · {viewer.device.name}</Badge>}</span>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((p) => {
          const Icon = p.icon;
          return (
            <Link key={p.href} href={p.href} className="group flex items-start gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-ink-4 hover:shadow-pop">
              <div className="grid size-11 shrink-0 place-items-center rounded-md bg-ink text-canvas"><Icon className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 font-extrabold text-ink">{t(p.fr, p.en)}<ChevronRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" /></div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{t(p.dfr, p.den)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
