'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BellRing, ChevronsLeft, ChevronsRight, CircleHelp, Globe, Lock, LogOut, Menu as MenuIcon, Search, SlidersHorizontal, Sparkles, UserRound, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { ConfirmProvider } from '@/components/ui/confirm';
import { CoachMark, Hint } from '@/components/help/hint';
import { HelpDrawer } from '@/components/help/help-drawer';
import { HelpProvider, useHelp } from '@/components/help/help-provider';
import { TakTakButton } from '@/components/help/taktak-button';
import { Tour } from '@/components/help/tour';
import { Welcome } from '@/components/help/welcome';
import { ErrorBoundary } from '@/components/supervisor/error-boundary';
import { clearAllDrafts } from '@/lib/ui/autosave-core';
import { nextTextSize, useDisplay, type TextSize } from '@/lib/ui/display';
import { health, installSupervisor, setScreen, subscribe as subscribeHealth } from '@/lib/ui/supervisor';
import { Kbd } from '@/components/ui/badge';
import { ToastProvider } from '@/components/ui/toast';
import { useDialogFocus, useEscape } from '@/components/ui/overlay';
import { ApprovalProvider } from '@/components/live/approval';
import { IncomingOrders } from '@/components/live/incoming';
import { CancelAlarm } from '@/components/live/cancel-alarm';
import { PulseProvider, usePulse, useScopeHref } from '@/components/live/pulse';
import { DeviceHeartbeat } from '@/components/live/device-heartbeat';
import { roleLabel } from '@/app/(console)/settings/settings-ui';
import { CommandPalette } from './command-palette';
import { ALERTS, childActive, mobileNav, navActive, navFor, navVisible, type NavItem } from './nav';
import { CopilotDrawer } from './copilot';
import { ScopeSwitcher } from './scope-switcher';
import { useViewer } from './viewer';
import { audioReady, playSound, unlockAudio } from '@/lib/ui/sound';
import { api } from '@/lib/ui/api';
import { useI18n, useProduct } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  return (
    <ToastProvider>
      <ConfirmProvider>
        <HelpProvider user={viewer.username}>
          <ApprovalProvider>
            <PulseProvider fixedScope={viewer.device ? [viewer.device.locationCode] : undefined}>
              <Frame>{children}</Frame>
              <IncomingOrders />
              <CancelAlarm />
              <CommandPalette />
              {viewer.device && <DeviceHeartbeat />}
              <HelpDrawer />
              <CoachMark />
              <Tour />
              <Welcome name={viewer.name} />
            </PulseProvider>
          </ApprovalProvider>
        </HelpProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

const openHelp = () => window.dispatchEvent(new Event('takatak:help'));
const SHEET_TILE = 'text-small flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-md bg-sunken p-3 text-center font-semibold text-ink';

/**
 * The product's mark on navy. The default product keeps the GROUPE TAKATAK lockup (BRAND.md): a white T in a glowing
 * electric-blue circle, "TAKATAK / FOOD HUB". Any other product name: its first letter as the mark, and its name.
 */
function Logo({ compact }: { compact?: boolean }) {
  const product = useProduct();
  const letter = product.isDefault ? 'T' : (product.name.trim()[0] ?? 'F').toUpperCase();
  return (
    <span className="flex items-center gap-2.5">
      <span className="text-body flex size-9 shrink-0 items-center justify-center rounded-full bg-electric font-black text-white shadow-[0_0_18px_rgb(31_139_255/0.55)]">{letter}</span>
      {!compact && (product.isDefault ? (
        <span className="leading-none">
          <span className="text-body block font-extrabold tracking-[0.16em] text-[#f5f8fc]">TAKATAK</span>
          <span className="text-micro mt-1 block font-bold tracking-[0.28em] text-cyan">FOOD HUB</span>
        </span>
      ) : <span className="text-body truncate font-extrabold tracking-[0.04em] text-[#f5f8fc]">{product.name}</span>)}
    </span>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { viewer, can, allLocations, features, full } = useViewer();
  const { t } = useI18n();
  const product = useProduct();
  const pathname = usePathname();
  const href = useScopeHref();
  const [collapsed, setCollapsed] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [more, setMore] = useState(false);
  // The phone's "Plus" sheet: Esc closes it, the focus moves in when it opens and back to "Plus" when it closes.
  const moreRef = useRef<HTMLDivElement>(null);
  useEscape(() => setMore(false), more);
  useDialogFocus(moreRef, more);
  useEffect(() => { try { setCollapsed(localStorage.getItem('takatak.rail') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => { const o = () => setCopilot(true); window.addEventListener('takatak:copilot', o); return () => window.removeEventListener('takatak:copilot', o); }, []);
  useEffect(() => { setMore(false); setScreen(pathname); }, [pathname]);
  useEffect(() => { installSupervisor(); }, []);
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const first = () => unlockAudio();
    window.addEventListener('pointerdown', first, { once: true });
    return () => window.removeEventListener('pointerdown', first);
  }, []);
  const visible = (n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>) => navVisible(n, can, allLocations, features);
  const who = { device: viewer.device, role: viewer.role };
  const items = navFor(full, who).filter(visible);
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem('takatak.rail', c ? '0' : '1'); } catch { /* ignore */ } return !c; }); };
  const kitchen = pathname.startsWith('/kitchen');
  const mobile = mobileNav(full, who, visible);
  const inBar = new Set(mobile.map((n) => n.href));
  // "Plus" lights up when the current page is reachable from the sheet only.
  const moreActive = !more && pathname !== '/' && !mobile.some((n) => (n.href === '/menu/86' ? pathname === '/menu/86' : navActive(n, pathname)));

  return (
    <div className={cn('min-h-dvh', kitchen && 'theme-kitchen bg-canvas text-ink')}>
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col bg-rail text-white transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <Link href={href('/')} className={cn('flex h-16 items-center px-5', collapsed && 'justify-center px-0')} aria-label={product.fullName}><Logo compact={collapsed} /></Link>
        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label={t('Menu principal', 'Main menu')}>
          {items.map((n) => <NavGroup key={n.href} item={n} collapsed={collapsed} visible={visible} />)}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          {full && (
            <button type="button" onClick={() => setCopilot(true)} title={collapsed ? t('Copilote', 'Co-pilot') : undefined} className={cn('text-body flex h-11 w-full items-center gap-3 rounded-lg px-3 font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white', collapsed && 'justify-center px-0')}>
              <Sparkles className="size-5 text-electric" aria-hidden />{!collapsed && t('Copilote', 'Co-pilot')}
            </button>
          )}
          <Hint id="shell.help">
            <button type="button" onClick={openHelp} title={collapsed ? t('Aide', 'Help') : undefined} className={cn('text-body flex h-11 w-full items-center gap-3 rounded-lg px-3 font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white', collapsed && 'justify-center px-0')}>
              <CircleHelp className="size-5 text-white/60" aria-hidden />{!collapsed && t('Aide', 'Help')}
            </button>
          </Hint>
          <button type="button" onClick={toggle} className={cn('text-small flex h-10 w-full items-center gap-3 rounded-lg px-3 text-white/50 hover:bg-white/[0.08] hover:text-white', collapsed && 'justify-center px-0')} aria-label={collapsed ? t('Agrandir le menu', 'Expand menu') : t('Réduire le menu', 'Collapse menu')}>
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <><ChevronsLeft className="size-4" aria-hidden />{t('Réduire', 'Collapse')}</>}
          </button>
        </div>
      </aside>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <Topbar />
        <StatusBanners />
        <main className={cn('mx-auto w-full flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-10', kitchen ? 'max-w-none' : 'max-w-[1320px]')}>
          <ErrorBoundary resetKey={pathname} name={pathname}>{children}</ErrorBoundary>
        </main>
      </div>

      {/* Phone bottom bar: 4 destinations, then "Plus" (premium rule 10). 64 px tall, 11 px labels, 44 px targets. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label={t('Menu', 'Menu')}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${mobile.length + 1},1fr)` }}>
          {mobile.map((n) => <MobileLink key={n.href} item={n} />)}
          <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-haspopup="dialog"
            className={cn('text-micro relative flex h-16 flex-col items-center justify-center gap-1 font-semibold', moreActive ? 'text-ink' : 'text-ink-3')}>
            {moreActive && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-brand" aria-hidden />}
            <MenuIcon className={cn('size-5', moreActive && 'text-brand')} aria-hidden />{t('Plus', 'More')}
          </button>
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-rail/50 motion-safe:animate-fade lg:hidden" onClick={() => setMore(false)}>
          {/* The sheet lists only what the bar does not: the other destinations, each group's sections, help, display and sign-out. */}
          <div ref={moreRef} tabIndex={-1} className="safe-bottom absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 outline-none motion-safe:animate-rise" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('Plus', 'More')}>
            <div className="mb-3 flex items-center justify-between"><span className="eyebrow text-ink">{product.shortName}</span><button type="button" onClick={() => setMore(false)} className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t('Fermer', 'Close')}><X className="size-5" aria-hidden /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {items.filter((n) => !inBar.has(n.href)).map((n) => <Link key={n.href} href={href(n.href)} aria-current={navActive(n, pathname) ? 'page' : undefined} className={cn(SHEET_TILE, navActive(n, pathname) && 'bg-brand-soft text-brand-2')}><n.icon className="size-5" aria-hidden />{n.label(t)}</Link>)}
              {visible(ALERTS) && !inBar.has(ALERTS.href) && <Link href={href(ALERTS.href)} aria-current={pathname.startsWith('/alerts') ? 'page' : undefined} className={cn(SHEET_TILE, pathname.startsWith('/alerts') && 'bg-brand-soft text-brand-2')}><BellRing className="size-5" aria-hidden />{ALERTS.label(t)}</Link>}
              <button type="button" onClick={() => { setMore(false); openHelp(); }} className={SHEET_TILE}><CircleHelp className="size-5" aria-hidden />{t('Aide', 'Help')}</button>
              {full && <button type="button" onClick={() => { setMore(false); setCopilot(true); }} className={SHEET_TILE}><Sparkles className="size-5 text-brand" aria-hidden />{t('Copilote', 'Co-pilot')}</button>}
            </div>
            {items.some((n) => (n.children ?? []).filter(visible).length > 1) && (
              <div className="mt-5 space-y-4">
                {items.filter((n) => (n.children ?? []).filter(visible).length > 1).map((n) => (
                  <div key={n.href}>
                    <div className="eyebrow mb-2 text-ink-3">{n.label(t)}</div>
                    <div className="flex flex-wrap gap-2">{(n.children ?? []).filter(visible).map((c) => <Link key={c.href} href={href(c.href)} aria-current={childActive(c, pathname) ? 'page' : undefined} className={cn('text-body flex h-11 items-center rounded-md border border-line px-3 font-semibold', childActive(c, pathname) ? 'border-ink bg-ink text-canvas' : 'bg-surface text-ink')}>{c.label(t)}</Link>)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 space-y-2 border-t border-line pt-4"><DisplayControls /><div className="-mx-3"><FullViewSwitch /></div></div>
            <div className="mt-2 border-t border-line pt-2"><SignOutButton className="-mx-3 w-[calc(100%+1.5rem)]" /></div>
          </div>
        </div>
      )}
      {copilot && <CopilotDrawer onClose={() => setCopilot(false)} />}
    </div>
  );
}

function useBadge(kind?: NavItem['badge']): { n: number; tone: 'brand' | 'stop' | 'wait' } | null {
  const { pulse } = usePulse();
  if (!pulse || !kind) return null;
  if (kind === 'orders') return pulse.orders.new ? { n: pulse.orders.new, tone: 'brand' } : null;
  if (kind === 'alerts') return pulse.incidents.open ? { n: pulse.incidents.open, tone: pulse.incidents.critical ? 'stop' : 'wait' } : null;
  if (kind === 'stores') { const n = pulse.stores.paused + pulse.stores.deactivated; return n ? { n, tone: pulse.stores.deactivated ? 'stop' : 'wait' } : null; }
  return null;
}

const BADGE_BG = { stop: 'bg-stop', wait: 'bg-wait', brand: 'bg-electric' } as const;
/** Small badges (bell, bottom bar) stop at "9+": a growing red number is noise (A4 #6); the rail keeps the full count. */
const capCount = (n: number) => (n > 9 ? '9+' : String(n));

/** One group of the rail: its page, and its sub-pages underneath while it is open. */
function NavGroup({ item, collapsed, visible }: { item: NavItem; collapsed: boolean; visible: (n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>) => boolean }) {
  const { t } = useI18n();
  const path = usePathname();
  const href = useScopeHref();
  const on = navActive(item, path);
  const b = useBadge(item.badge);
  const kids = (item.children ?? []).filter(visible);
  return (
    <div>
      <Link href={href(item.href)} title={collapsed ? item.label(t) : undefined} aria-current={on && path === item.href ? 'page' : undefined}
        className={cn('text-body relative flex h-11 items-center gap-3 rounded-lg px-3 font-semibold transition-colors duration-(--duration-fast)', on ? 'bg-white/[0.09] text-white' : 'text-white/65 hover:bg-white/[0.06] hover:text-white', collapsed && 'justify-center px-0')}>
        {on && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-electric" aria-hidden />}
        <item.icon className={cn('size-5 shrink-0', on ? 'text-electric' : 'text-white/55')} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{item.label(t)}</span>}
        {b && (collapsed
          ? <span className={cn('absolute top-2 right-3 size-2.5 rounded-full', BADGE_BG[b.tone])} />
          : <span className={cn('num text-micro min-w-6 rounded-full px-1.5 text-center leading-5 font-bold text-white', BADGE_BG[b.tone])}>{b.n}</span>)}
      </Link>
      {on && !collapsed && kids.length > 1 && (
        <div className="mt-0.5 mb-1.5 ml-[22px] space-y-0.5 border-l border-white/10 pl-3">
          {kids.map((c) => {
            const here = childActive(c, path);
            return <Link key={c.href} href={href(c.href)} aria-current={here ? 'page' : undefined} className={cn('text-small flex h-9 items-center rounded-md px-2.5 font-medium', here ? 'text-white' : 'text-white/55 hover:text-white')}>{c.label(t)}</Link>;
          })}
        </div>
      )}
    </div>
  );
}

function MobileLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const path = usePathname();
  const href = useScopeHref();
  // The sold-out board lights up on its own page only (Menus is a different entry).
  const on = item.href === '/menu/86' ? path === '/menu/86' : navActive(item, path) && !(item.href === '/menu' && path === '/menu/86');
  const b = useBadge(item.badge);
  const label = item.href === '/kitchen' ? t('Cuisine', 'Kitchen') : item.label(t);
  return (
    <Link href={href(item.href)} aria-current={on ? 'page' : undefined} className={cn('text-micro relative flex h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 font-semibold', on ? 'text-ink' : 'text-ink-3')}>
      {on && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-brand" aria-hidden />}
      <item.icon className={cn('size-5', on && 'text-brand')} aria-hidden /><span className="max-w-full truncate">{label}</span>
      {b && <span className={cn('num text-micro absolute top-1.5 right-[calc(50%-22px)] flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-bold text-white', b.tone === 'stop' ? 'bg-stop' : b.tone === 'wait' ? 'bg-wait' : 'bg-brand')} aria-label={String(b.n)}>{capCount(b.n)}</span>}
    </Link>
  );
}

/** Alerts: a bell with the number of open alerts (red when one is critical). */
function AlertsBell() {
  const { t } = useI18n();
  const href = useScopeHref();
  const path = usePathname();
  const b = useBadge('alerts');
  return (
    <Link href={href('/alerts')} aria-label={b ? t(b.n > 1 ? `Alertes : ${b.n} ouvertes` : 'Alertes : 1 ouverte', b.n > 1 ? `Alerts: ${b.n} open` : 'Alerts: 1 open') : t('Alertes', 'Alerts')}
      title={t('Alertes', 'Alerts')} className={cn('relative flex size-11 items-center justify-center rounded-lg hover:bg-sunken', path.startsWith('/alerts') ? 'text-brand' : 'text-ink-2')}>
      <BellRing className="size-5" aria-hidden />
      {b && <span className={cn('num text-micro absolute top-1.5 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-bold text-white', b.tone === 'stop' ? 'bg-stop' : 'bg-wait')} aria-hidden>{capCount(b.n)}</span>}
    </Link>
  );
}

function Topbar() {
  const { t, lang, setLang } = useI18n();
  const { viewer, full } = useViewer();
  const product = useProduct();
  const href = useScopeHref();
  const help = useHelp();
  const [sound, setSound] = useState(false);
  useEffect(() => { const i = setInterval(() => setSound(audioReady()), 1000); return () => clearInterval(i); }, []);
  // The full view and kitchen tablets keep today's bar (text size button on it); the simple view moves it to the avatar menu.
  const textSizeInBar = full || Boolean(viewer.device);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-3 sm:px-6 lg:px-8">
        <Link href={href('/')} className="mr-0.5 hidden sm:block lg:hidden" aria-label={product.fullName}><span className="text-body flex size-9 items-center justify-center rounded-full bg-rail font-black text-white"><span className="flex size-7 items-center justify-center rounded-full bg-electric">{product.isDefault ? 'T' : (product.name.trim()[0] ?? 'F').toUpperCase()}</span></span></Link>
        <Hint id="shell.scope"><ScopeSwitcher /></Hint>
        <Hint id="shell.search">
          <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))}
            className="text-small ml-2 hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ink-3 hover:border-line-2 md:flex md:max-w-xs">
            <Search className="size-4" aria-hidden /><span className="truncate">{t('Chercher une commande, une page…', 'Search an order, a page…')}</span><span className="ml-auto flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
        </Hint>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))} className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken md:hidden" aria-label={t('Chercher', 'Search')}><Search className="size-5" aria-hidden /></button>
          <AlertsBell />
          <Hint id="shell.sound">
          <button type="button" onClick={() => { unlockAudio(); playSound('soft'); setSound(true); }} className={cn('hidden size-11 items-center justify-center rounded-lg hover:bg-sunken sm:flex', sound ? 'text-ink-2' : 'text-wait-2')} aria-label={t('Son', 'Sound')} title={sound ? t('Son actif', 'Sound on') : t('Touchez pour activer le son', 'Tap to turn sound on')}>
            {sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
          </button>
          </Hint>
          {textSizeInBar && <TextSizeButton />}
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="text-small hidden h-11 items-center gap-1 rounded-lg px-2 font-bold text-ink-2 hover:bg-sunken hover:text-ink sm:flex" aria-label="Langue / Language" title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}><Globe className="size-4" aria-hidden />{lang === 'fr' ? 'EN' : 'FR'}</button>
          {!help.tour && <TakTakButton />}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/** Language and text size, as one row of buttons (avatar menu and the phone's "Plus" sheet). */
function DisplayControls() {
  const { t, lang, setLang } = useI18n();
  const [display, setDisplay] = useDisplay();
  const sizes: Array<[TextSize, string]> = [['md', 'A'], ['lg', 'A+'], ['xl', 'A++']];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-small flex w-28 shrink-0 items-center gap-1.5 font-semibold text-ink-3"><Globe className="size-4" aria-hidden />{t('Langue', 'Language')}</span>
        <div className="inline-flex rounded-md bg-sunken p-0.5" role="group" aria-label={t('Langue', 'Language')}>
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn('text-small h-9 min-w-11 rounded-[9px] px-2.5 font-bold', lang === l ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>{l === 'fr' ? 'FR' : 'EN'}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-small flex w-28 shrink-0 items-center gap-1.5 font-semibold text-ink-3"><SlidersHorizontal className="size-4" aria-hidden />{t('Taille du texte', 'Text size')}</span>
        <div className="inline-flex rounded-md bg-sunken p-0.5" role="group" aria-label={t('Taille du texte', 'Text size')}>
          {sizes.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={display.text === k} onClick={() => setDisplay({ text: k })} className={cn('text-small h-9 min-w-11 rounded-[9px] px-2.5 font-extrabold', display.text === k ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Vue complète (outils avancés)": owners and managers only, never a kitchen tablet. */
function FullViewSwitch() {
  const { t } = useI18n();
  const { full, canFull, setFull } = useViewer();
  if (!canFull) return null;
  return (
    <Hint id="shell.view">
      <button type="button" role="switch" aria-checked={full} onClick={() => setFull(!full)} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body hover:bg-sunken">
        <span className="min-w-0 flex-1"><span className="text-body block font-semibold text-ink">{t('Vue complète', 'Full view')}</span><span className="text-small block text-ink-3">{t('Outils avancés', 'Advanced tools')}</span></span>
        {/* Off: outlined track and a grey knob (both well above 3:1 on the white menu); on: blue track, white knob. */}
        <span className={cn('relative h-6 w-10 shrink-0 rounded-full border-2 transition-colors', full ? 'border-brand bg-brand' : 'border-ink-3 bg-surface')} aria-hidden>
          <span className={cn('absolute top-[2px] size-4 rounded-full shadow transition-[left]', full ? 'left-[18px] bg-white' : 'left-[2px] bg-ink-3')} />
        </span>
      </button>
    </Hint>
  );
}

function useSignOut() {
  const { viewer } = useViewer();
  return useCallback(async () => {
    // Drafts belong to the person: never left behind on a shared tablet.
    try { clearAllDrafts(window.localStorage, viewer.username); } catch { /* ignore */ }
    const r = await api<{ next: string }>('/api/foodhub/auth/logout', { method: 'POST' }).catch(() => ({ next: '/login' }));
    window.location.href = r.next;
  }, [viewer.username]);
}

/** "Se déconnecter", or "Verrouiller la tablette" on a kitchen tablet (avatar menu and the phone's "Plus" sheet). */
function SignOutButton({ className }: { className?: string }) {
  const { viewer } = useViewer();
  const { t } = useI18n();
  const signOut = useSignOut();
  return viewer.device
    ? <button type="button" onClick={signOut} className={cn('text-body flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 font-semibold text-ink hover:bg-sunken', className)}><Lock className="size-4" aria-hidden />{t('Verrouiller la tablette', 'Lock the tablet')}</button>
    : <button type="button" onClick={signOut} className={cn('text-body flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-ink hover:bg-sunken', className)}><LogOut className="size-4" aria-hidden />{t('Se déconnecter', 'Sign out')}</button>;
}

function UserMenu() {
  const { viewer } = useViewer();
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open]);
  const initials = viewer.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title={viewer.name} className="text-small flex size-10 items-center justify-center rounded-full bg-ink font-extrabold text-canvas" aria-label={t(`Compte : ${viewer.name}`, `Account: ${viewer.name}`)}>{initials}</button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-surface p-1.5 shadow-pop motion-safe:animate-rise">
          <div className="px-3 py-2">
            <div className="text-body truncate font-bold text-ink">{viewer.name}</div>
            <div className="text-small text-ink-3">{roleLabel(t, viewer.role)}{viewer.device ? ` · ${viewer.device.name}` : ''}</div>
          </div>
          <div className="border-y border-line px-3 py-3"><DisplayControls /></div>
          <FullViewSwitch />
          {!viewer.builtin && <button type="button" onClick={() => { setOpen(false); router.push('/settings/profile'); }} className="text-body flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-ink hover:bg-sunken"><UserRound className="size-4" aria-hidden />{t('Mon profil', 'My profile')}</button>}
          <SignOutButton />
        </div>
      )}
    </div>
  );
}

function StatusBanners() {
  const { pulse, online } = usePulse();
  const healthNow = useSyncExternalStore(subscribeHealth, () => health(), () => 'good' as const);
  const { can, full } = useViewer();
  const { t } = useI18n();
  const [netOk, setNetOk] = useState(true);
  useEffect(() => { const u = () => setNetOk(navigator.onLine); u(); window.addEventListener('online', u); window.addEventListener('offline', u); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', u); }; }, []);
  const bars: ReactNode[] = [];
  if (netOk && online && healthNow === 'stale') bars.push(<Bar key="stale" tone="wait" icon={<WifiOff className="size-4" aria-hidden />}>{t('Les données ne se rafraîchissent plus — reconnexion… Les commandes continuent sur les tablettes des plateformes et dans Clover.', 'Data is not refreshing — reconnecting… Orders keep arriving on the platform tablets and in Clover.')}</Bar>);
  if (!netOk || !online) bars.push(<Bar key="off" tone="stop" icon={<WifiOff className="size-4" aria-hidden />}>{t('Pas de connexion — les commandes continuent sur les tablettes des plateformes et dans Clover. Reconnexion automatique…', 'No connection — orders keep coming on the platform tablets and in Clover. Reconnecting…')}</Bar>);
  if (pulse?.devices.offline) bars.push(<Bar key="dev" tone="wait" href="/alerts">{t(pulse.devices.offline > 1 ? `${pulse.devices.offline} tablettes de cuisine hors ligne` : '1 tablette de cuisine hors ligne', pulse.devices.offline > 1 ? `${pulse.devices.offline} kitchen tablets offline` : '1 kitchen tablet offline')}</Bar>);
  if (pulse && !pulse.live && can('admin')) {
    bars.push(full
      ? <Bar key="live" tone="wait" href="/settings/channels">{t('Mode sécurité : rien n’est envoyé aux plateformes (LIVE_CONNECTORS_GLOBAL_ENABLED=false).', 'Safe mode: nothing is sent to the platforms (LIVE_CONNECTORS_GLOBAL_ENABLED=false).')}</Bar>
      // Mise en service explains it and can be opened by URL in either view (owner only).
      : <Bar key="live" tone="wait" href="/settings/go-live">{t('Pas encore en direct : rien n’est envoyé aux plateformes. Votre technicien l’active dans Mise en service.', 'Not live yet: nothing is sent to the platforms. Your technician turns it on in Go-live.')}</Bar>);
  }
  // The owner always sees that data is not kept (lost on a restart), in plain words in the simple view.
  if (pulse?.mode === 'memory' && can('admin')) {
    bars.push(full
      ? <Bar key="mem" tone="info" dismissKey="memory">{t('Mode démo : Supabase n’est pas branché, les données sont en mémoire.', 'Demo mode: Supabase is not connected, data lives in memory.')}</Bar>
      : <Bar key="mem" tone="info" dismissKey="memory">{t('Données temporaires : la base de données n’est pas branchée, rien n’est gardé après un redémarrage.', 'Temporary data: the database is not connected, nothing is kept after a restart.')}</Bar>);
  }
  if (!bars.length) return null;
  return <div className="space-y-px">{bars}</div>;
}

const BAR_KEY = 'takatak.bar.';
/**
 * A full-width band under the top bar. Red and amber ones stay (a connection or a safe-mode problem); a blue one
 * (demo data) can be put away for this session, so it is not a permanent band on every page (A4 #5).
 */
function Bar({ tone, children, href, icon, dismissKey }: { tone: 'stop' | 'wait' | 'info'; children: ReactNode; href?: string; icon?: ReactNode; dismissKey?: string }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (!dismissKey) return; try { setHidden(sessionStorage.getItem(BAR_KEY + dismissKey) === '1'); } catch { /* ignore */ } }, [dismissKey]);
  if (hidden) return null;
  const dismiss = () => { setHidden(true); try { sessionStorage.setItem(BAR_KEY + dismissKey, '1'); } catch { /* ignore */ } };
  const cls = cn('text-small flex min-h-9 flex-1 items-center justify-center gap-2 px-4 py-1.5 text-center font-semibold', tone === 'stop' ? 'bg-stop text-white' : tone === 'wait' ? 'bg-wait-soft text-wait-2' : 'bg-info-soft text-info-2');
  const body = href ? <Link href={href} className={cls}>{icon}{children} →</Link> : <div className={cls}>{icon}{children}</div>;
  if (!dismissKey) return body;
  return (
    <div className="flex items-stretch bg-info-soft">
      {body}
      <button type="button" onClick={dismiss} className="flex w-11 shrink-0 items-center justify-center text-info-2 hover:bg-info/10" aria-label={t('Masquer pour cette session', 'Hide for this session')}><X className="size-4" aria-hidden /></button>
    </div>
  );
}

/** A → A+ → A++ for this screen (kitchen tablets start at A+). */
function TextSizeButton() {
  const { t } = useI18n();
  const [display, setDisplay] = useDisplay();
  const label = display.text === 'md' ? 'A' : display.text === 'lg' ? 'A+' : 'A++';
  return (
    <Hint id="shell.textsize">
      <button type="button" onClick={() => setDisplay({ text: nextTextSize(display.text) })} className="text-body hidden h-11 min-w-11 items-center justify-center rounded-lg px-2 font-extrabold text-ink-3 hover:bg-sunken hover:text-ink sm:flex"
        aria-label={t(`Taille du texte : ${label}`, `Text size: ${label}`)} title={t('Taille du texte', 'Text size')}>{label}</button>
    </Hint>
  );
}
