'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';

export function InsightsTabs() {
  const { t } = useI18n();
  return <LinkTabs tabs={[{ href: '/insights', label: t('Analyses', 'Analytics'), exact: true }, { href: '/insights/reports', label: t('Rapports', 'Reports') }, { href: '/insights/activity', label: t('Journal d’activité', 'Activity log') }]} />;
}
