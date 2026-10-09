'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

export function StoresTabs() {
  const { t } = useI18n();
  const { can } = useViewer();
  return <LinkTabs tabs={[
    { href: '/stores', label: t('Statut et pauses', 'Status & pauses'), exact: true },
    ...(can('menu:edit') ? [{ href: '/stores/hours', label: t('Heures d’ouverture', 'Opening hours') }] : []),
    ...(can('stores:map') ? [{ href: '/stores/mapping', label: t('Branchement des magasins', 'Store connections') }] : []),
    ...(can('stores:map') ? [{ href: '/stores/uber', label: 'Uber Eats' }] : []),
  ]} />;
}
