'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

export function MenuTabs() {
  const { t } = useI18n();
  const { can, features } = useViewer();
  return <LinkTabs tabs={[
    { href: '/menu/86', label: t('Ruptures (86)', '86 board') },
    ...(can('menu:edit') ? [{ href: '/menu', label: t('Éditeur de menu', 'Menu editor'), exact: true }] : []),
    ...(features.includes('retail') ? [{ href: '/menu/retail', label: t('Épicerie', 'Grocery') }] : []),
  ]} />;
}
