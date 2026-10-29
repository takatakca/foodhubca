'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

/** Status & pauses, All stores, Opening hours, Platform screens; the full view adds the store connections and Uber Eats tools. */
export function StoresTabs() {
  const { t } = useI18n();
  const { can, full } = useViewer();
  return <LinkTabs tabs={[
    { href: '/stores', label: t('Statut et pauses', 'Status & pauses'), exact: true },
    { href: '/stores/list', label: t('Tous les magasins', 'All stores') },
    ...(can('menu:edit') ? [{ href: '/stores/hours', label: t('Heures d’ouverture', 'Opening hours') }] : []),
    { href: '/stores/screens', label: t('Écrans des plateformes', 'Platform screens') },
    ...(full && can('stores:map') ? [{ href: '/stores/mapping', label: t('Branchement des magasins', 'Store connections') }] : []),
    ...(full && can('stores:map') ? [{ href: '/stores/uber', label: 'Uber Eats' }] : []),
  ]} />;
}
