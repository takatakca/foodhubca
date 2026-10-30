'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useScopeHref } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { EXPANSION_LINKS, isNavOn, settingsNavGroups } from './settings-nav-model';

export { EXPANSION_LINKS } from './settings-nav-model';

/** Settings side-nav (wide screens): every Settings page in its group, so a page never needs a second tab strip. */
export function SettingsNav() {
  const { t } = useI18n();
  const { can, full } = useViewer();
  const path = usePathname();
  const href = useScopeHref();
  const groups = settingsNavGroups(path, can, full);
  const item = 'text-body flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand';
  return (
    <nav aria-label={t('Réglages', 'Settings')} className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
      <Link href={href('/settings')} className={cn(item, 'mb-2 text-ink-3 hover:bg-sunken hover:text-ink')}>{t('Tous les réglages', 'All settings')}</Link>
      {groups.map((g) => (
        <div key={g.key} className="mb-4">
          <div className="text-micro mb-1 px-3 font-bold tracking-[0.08em] text-ink-3 uppercase">{t(g.fr, g.en)}</div>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const on = isNavOn(path, p.href);
              const Icon = p.icon;
              return (
                <li key={p.href}>
                  <Link href={href(p.href)} aria-current={on && path === p.href ? 'page' : undefined}
                    className={cn(item, on ? 'bg-ink text-canvas' : 'text-ink-2 hover:bg-sunken hover:text-ink')}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{t(p.fr, p.en)}</span>
                  </Link>
                  {p.href === '/settings/expansion' && on && (
                    <ul className="mt-0.5 ml-5 space-y-0.5 border-l border-line pl-2">
                      {EXPANSION_LINKS.map((x) => {
                        const sub = isNavOn(path, x.href, x.exact);
                        return (
                          <li key={x.href}>
                            <Link href={href(x.href)} aria-current={sub ? 'page' : undefined}
                              className={cn('text-small flex min-h-11 items-center rounded-md px-3 font-semibold', sub ? 'bg-sunken text-ink' : 'text-ink-3 hover:bg-sunken hover:text-ink')}>
                              {t(x.fr, x.en)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Settings pages sit beside the side-nav from 1280 px; the hub itself is the navigation, so it stays full width. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === '/settings') return <>{children}</>;
  return (
    <div className="xl:grid xl:grid-cols-[232px_minmax(0,1fr)] xl:gap-8">
      <aside className="hidden xl:block"><SettingsNav /></aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
