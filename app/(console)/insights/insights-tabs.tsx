'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

/** Sales & trends, Reports, and (full view) the activity log. The log still opens by its address and through search. */
export function InsightsTabs() {
  const { t } = useI18n();
  const { full } = useViewer();
  return <LinkTabs tabs={[
    { href: '/insights', label: t('Ventes et tendances', 'Sales & trends'), exact: true },
    { href: '/insights/reports', label: t('Rapports', 'Reports') },
    ...(full ? [{ href: '/insights/activity', label: t('Journal d’activité', 'Activity log') }] : []),
  ]} />;
}
