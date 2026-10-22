'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

/**
 * Restaurants sections. One vocabulary (A2): a *marque* is a restaurant brand, a *cuisine* is a location, a *magasin* is
 * that brand on one platform at one cuisine. The full view adds the connections and the Uber Eats tools.
 */
export function StoresTabs({ className }: { className?: string }) {
  const { t } = useI18n();
  const { can, full } = useViewer();
  return <LinkTabs className={className} label={t('Sections des restaurants', 'Restaurant sections')} tabs={[
    { href: '/stores', label: t('Statut et pauses', 'Status & pauses'), exact: true },
    { href: '/stores/availability', label: t('Disponibilité', 'Availability') },
    { href: '/stores/list', label: t('Magasins des plateformes', 'Platform stores') },
    ...(can('menu:edit') ? [{ href: '/stores/hours', label: t('Heures d’ouverture', 'Opening hours') }] : []),
    ...(full && can('stores:map') ? [{ href: '/stores/mapping', label: t('Branchements', 'Connections') }] : []),
    ...(full && can('stores:map') ? [{ href: '/stores/uber', label: 'Uber Eats' }] : []),
  ]} />;
}
