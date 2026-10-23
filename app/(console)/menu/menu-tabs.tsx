'use client';

import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';

/** Menus sections: under the page header (PageHeader `tabs`, with `className="mb-0"`) or on their own. */
export function MenuTabs({ className }: { className?: string }) {
  const { t } = useI18n();
  const { can, features } = useViewer();
  return <LinkTabs className={className} label={t('Sections des menus', 'Menu sections')} tabs={[
    { href: '/menu/86', label: t('Épuisés', 'Sold out') },
    ...(can('menu:edit') ? [{ href: '/menu', label: t('Éditeur de menu', 'Menu editor'), exact: true }] : []),
    ...(features.includes('retail') ? [{ href: '/menu/retail', label: t('Épicerie', 'Grocery') }] : []),
  ]} />;
}
