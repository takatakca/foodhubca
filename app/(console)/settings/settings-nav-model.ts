// Pure data for the Settings side-nav (settings-nav.tsx), kept apart so tests can read it without React.
import { SETTINGS_GROUPS, SETTINGS_PAGES, settingsPageOf, type SettingsGroup } from '@/components/shell/settings-pages';

/** The add-on pages that live under « Services en plus » (the side-nav lists them under it; phones keep their tabs). */
export const EXPANSION_LINKS = [
  { href: '/settings/expansion', fr: 'Interrupteurs', en: 'Switches', exact: true },
  { href: '/settings/expansion/delivery', fr: 'Livraison', en: 'Delivery', exact: false },
  { href: '/settings/expansion/alcohol', fr: 'Alcool', en: 'Alcohol', exact: false },
  { href: '/settings/expansion/phone', fr: 'Téléphone IA', en: 'AI phone', exact: true },
  { href: '/settings/expansion/phone/ivr', fr: 'Menu téléphonique', en: 'Phone menu', exact: false },
] as const;

/**
 * Which groups and pages the Settings side-nav shows. The technician tools appear in the full view, or when the page
 * open right now is one of them (an address typed in the simple view); a page the viewer cannot open is never listed.
 */
export function settingsNavGroups(path: string, can: (perm: string) => boolean, full: boolean) {
  const current = settingsPageOf(path);
  return SETTINGS_GROUPS
    .filter((g) => g.key !== 'advanced' || full || current?.group === 'advanced')
    .map((g) => ({ ...g, pages: SETTINGS_PAGES.filter((p) => p.group === (g.key as SettingsGroup) && can(p.perm)) }))
    .filter((g) => g.pages.length > 0);
}

export function isNavOn(path: string, href: string, exact?: boolean) {
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}
