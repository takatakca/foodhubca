'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

export function DirectTabs() {
  const { t } = useI18n();
  const { features, can } = useViewer();
  return <LinkTabs tabs={[
    ...(features.includes('delivery') ? [{ href: '/direct', label: t('Commandes et livreurs', 'Orders & couriers'), exact: true }] : []),
    ...(features.includes('phone') && can('orders:act') ? [{ href: '/direct/calls', label: t('Appels (IA)', 'Calls (AI)') }] : []),
  ]} />;
}
