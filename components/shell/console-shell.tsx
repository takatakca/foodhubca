'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BellRing, ChevronsLeft, ChevronsRight, Globe, Lock, LogOut, Menu as MenuIcon, Search, Sparkles, UserRound, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { ConfirmProvider } from '@/components/ui/confirm';
import { CoachMark, Hint } from '@/components/help/hint';
import { HelpDrawer } from '@/components/help/help-drawer';
import { HelpProvider } from '@/components/help/help-provider';
import { TakTakButton } from '@/components/help/taktak-button';
import { Tour } from '@/components/help/tour';
import { Welcome } from '@/components/help/welcome';
import { ErrorBoundary } from '@/components/supervisor/error-boundary';
import { clearAllDrafts } from '@/lib/ui/autosave-core';
import { nextTextSize, useDisplay } from '@/lib/ui/display';
import { health, installSupervisor, setScreen, subscribe as subscribeHealth } from '@/lib/ui/supervisor';
import { Kbd } from '@/components/ui/badge';
import { ToastProvider } from '@/components/ui/toast';
import { ApprovalProvider } from '@/components/live/approval';
import { IncomingOrders } from '@/components/live/incoming';
import { CancelAlarm } from '@/components/live/cancel-alarm';
import { PulseProvider, usePulse, useScopeHref } from '@/components/live/pulse';
import { DeviceHeartbeat } from '@/components/live/device-heartbeat';
import { CommandPalette } from './command-palette';
import { ALERTS, childActive, NAV, navActive, navVisible, type NavItem } from './nav';
import { CopilotDrawer } from './copilot';
import { ScopeSwitcher } from './scope-switcher';
import { useViewer } from './viewer';
import { audioReady, playSound, unlockAudio } from '@/lib/ui/sound';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
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
              <TakTakButton />
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

/** GROUPE TAKATAK mark (BRAND.md): a white T in a glowing electric-blue circle, on navy. */
function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-electric text-[15px] font-black text-white shadow-[0_0_18px_rgb(31_139_255/0.55)]">T</span>
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-extrabold tracking-[0.16em] text-[#f5f8fc]">TAKATAK</span>
          <span className="mt-1 block text-[10px] font-bold tracking-[0.28em] text-cyan">FOOD HUB</span>
        </span>
      )}
    </span>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { can, allLocations, features } = useViewer();
  const { t } = useI18n();
  const pathname = usePathname();
  const href = useScopeHref();
  const [collapsed, setCollapsed] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [more, setMore] = useState(false);
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
  const items = NAV.filter(visible);
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem('takatak.rail', c ? '0' : '1'); } catch { /* ignore */ } return !c; }); };
  const kitchen = pathname.startsWith('/kitchen');
  const mobile = [NAV[0], NAV[1], NAV[2], ALERTS].filter(visible);

  return (
    <div className={cn('min-h-dvh', kitchen && 'theme-kitchen bg-canvas text-ink')}>
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col bg-rail text-white transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <Link href={href('/')} className={cn('flex h-16 items-center px-5', collapsed && 'justify-center px-0')} aria-label="TAKATAK Food Hub"><Logo compact={collapsed} /></Link>
        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label={t('Menu principal', 'Main menu')}>
          {items.map((n) => <NavGroup key={n.href} item={n} collapsed={collapsed} visible={visible} />)}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <button type="button" onClick={() => setCopilot(true)} className={cn('flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white', collapsed && 'justify-center px-0')}>
            <Sparkles className="size-[18px] text-electric" />{!collapsed && t('Copilote', 'Co-pilot')}
          </button>
          <button type="button" onClick={toggle} className={cn('flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] text-white/50 hover:bg-white/[0.08] hover:text-white', collapsed && 'justify-center px-0')} aria-label={collapsed ? t('Agrandir le menu', 'Expand menu') : t('Réduire le menu', 'Collapse menu')}>
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />{t('Réduire', 'Collapse')}</>}
          </button>
        </div>
      </aside>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <Topbar />
        <StatusBanners />
        <main className={cn('mx-auto w-full flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-24', kitchen ? 'max-w-none' : 'max-w-[1320px]')}>
          <ErrorBoundary resetKey={pathname} name={pathname}>{children}</ErrorBoundary>
        </main>
      </div>

      {/* mobile bottom bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label={t('Menu', 'Menu')}>
        <div className="grid grid-cols-5">
          {mobile.map((n) => <MobileLink key={n.href} item={n} />)}
          <button type="button" onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-ink-3"><MenuIcon className="size-5" />{t('Plus', 'More')}</button>
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-rail/50 lg:hidden" onClick={() => setMore(false)}>
          <div className="safe-bottom absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 animate-rise" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><span className="font-extrabold tracking-[0.14em]">TAKATAK</span><button type="button" onClick={() => setMore(false)} className="flex size-11 items-center justify-center" aria-label={t('Fermer', 'Close')}><X className="size-5" /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((n) => <Link key={n.href} href={href(n.href)} className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-sunken p-3 text-center text-xs font-semibold"><n.icon className="size-5" />{n.label(t)}</Link>)}
              <button type="button" onClick={() => { setMore(false); setCopilot(true); }} className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-brand-soft p-3 text-xs font-semibold text-brand-2"><Sparkles className="size-5" />{t('Copilote', 'Co-pilot')}</button>
            </div>
            {items.some((n) => (n.children ?? []).filter(visible).length > 1) && (
              <div className="mt-4 space-y-3">
                {items.filter((n) => (n.children ?? []).filter(visible).length > 1).map((n) => (
                  <div key={n.href}>
                    <div className="mb-1.5 text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{n.label(t)}</div>
                    <div className="flex flex-wrap gap-2">{(n.children ?? []).filter(visible).map((c) => <Link key={c.href} href={href(c.href)} className="flex h-11 items-center rounded-lg border border-line px-3 text-sm font-semibold">{c.label(t)}</Link>)}</div>
                  </div>
                ))}
              </div>
            )}
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
        className={cn('relative flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-semibold transition-colors', on ? 'bg-white/[0.09] text-white' : 'text-white/65 hover:bg-white/[0.06] hover:text-white', collapsed && 'justify-center px-0')}>
        {on && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-electric" aria-hidden />}
        <item.icon className={cn('size-[19px] shrink-0', on ? 'text-electric' : 'text-white/55')} />
        {!collapsed && <span className="flex-1 truncate">{item.label(t)}</span>}
        {b && (collapsed
          ? <span className={cn('absolute top-2 right-3 size-2.5 rounded-full', BADGE_BG[b.tone])} />
          : <span className={cn('num min-w-6 rounded-full px-1.5 text-center text-[11px] leading-5 font-bold text-white', BADGE_BG[b.tone])}>{b.n}</span>)}
      </Link>
      {on && !collapsed && kids.length > 1 && (
        <div className="mt-0.5 mb-1.5 ml-[22px] space-y-0.5 border-l border-white/10 pl-3">
          {kids.map((c) => {
            const here = childActive(c, path);
            return <Link key={c.href} href={href(c.href)} aria-current={here ? 'page' : undefined} className={cn('flex h-9 items-center rounded-md px-2.5 text-[13px] font-medium', here ? 'text-white' : 'text-white/55 hover:text-white')}>{c.label(t)}</Link>;
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
  const on = navActive(item, path);
  const b = useBadge(item.badge);
  const label = item.href === '/kitchen' ? t('Cuisine', 'Kitchen') : item.label(t);
  return (
    <Link href={href(item.href)} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', on ? 'text-ink' : 'text-ink-3')}>
      <item.icon className={cn('size-5', on && 'text-brand')} />{label}
      {b && <span className={cn('num absolute top-2 right-[calc(50%-20px)] min-w-4 rounded-full px-1 text-[10px] leading-4 font-bold text-white', b.tone === 'stop' ? 'bg-stop' : b.tone === 'wait' ? 'bg-wait' : 'bg-brand')}>{b.n}</span>}
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
    <Link href={href('/alerts')} aria-label={b ? t(`Alertes : ${b.n} ouverte(s)`, `Alerts: ${b.n} open`) : t('Alertes', 'Alerts')}
      className={cn('relative flex size-11 items-center justify-center rounded-lg hover:bg-sunken', path.startsWith('/alerts') ? 'text-brand' : 'text-ink-2')}>
      <BellRing className="size-5" />
      {b && <span className={cn('num absolute top-1.5 right-1 min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] font-bold text-white', b.tone === 'stop' ? 'bg-stop' : 'bg-wait')}>{b.n > 99 ? '99+' : b.n}</span>}
    </Link>
  );
}

function Topbar() {
  const { t, lang, setLang } = useI18n();
  const href = useScopeHref();
  const [sound, setSound] = useState(false);
  useEffect(() => { const i = setInterval(() => setSound(audioReady()), 1000); return () => clearInterval(i); }, []);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-3 sm:px-6 lg:px-8">
        <Link href={href('/')} className="mr-0.5 hidden sm:block lg:hidden" aria-label="TAKATAK Food Hub"><span className="flex size-9 items-center justify-center rounded-full bg-rail text-[15px] font-black text-white"><span className="flex size-7 items-center justify-center rounded-full bg-electric">T</span></span></Link>
        <Hint id="shell.scope"><ScopeSwitcher /></Hint>
        <Hint id="shell.search">
          <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))}
            className="ml-2 hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink-3 hover:border-line-2 md:flex md:max-w-xs">
            <Search className="size-4" /><span className="truncate">{t('Chercher une commande, une page…', 'Search an order, a page…')}</span><span className="ml-auto flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
        </Hint>
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))} className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken md:hidden" aria-label={t('Chercher', 'Search')}><Search className="size-5" /></button>
          <AlertsBell />
          <Hint id="shell.sound">
          <button type="button" onClick={() => { unlockAudio(); playSound('soft'); setSound(true); }} className={cn('flex size-11 items-center justify-center rounded-lg hover:bg-sunken', sound ? 'text-ink-2' : 'text-wait-2')} aria-label={t('Son', 'Sound')} title={sound ? t('Son actif', 'Sound on') : t('Touchez pour activer le son', 'Tap to turn sound on')}>
            {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          </Hint>
          <TextSizeButton />
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="hidden h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-bold text-ink-2 hover:bg-sunken hover:text-ink sm:flex" aria-label="Langue / Language"><Globe className="size-4" />{lang === 'fr' ? 'EN' : 'FR'}</button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const { viewer } = useViewer();
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  const signOut = useCallback(async () => {
    // Drafts belong to the person: never left behind on a shared tablet.
    try { clearAllDrafts(window.localStorage, viewer.username); } catch { /* ignore */ }
    const r = await api<{ next: string }>('/api/foodhub/auth/logout', { method: 'POST' }).catch(() => ({ next: '/login' }));
    window.location.href = r.next;
  }, [viewer.username]);
  const initials = viewer.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="flex size-10 items-center justify-center rounded-full bg-ink text-[13px] font-extrabold text-canvas" aria-label={viewer.name}>{initials}</button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-rise">
          <div className="px-3 py-2">
            <div className="font-bold text-ink">{viewer.name}</div>
            <div className="text-xs text-ink-3">{viewer.role}{viewer.device ? ` · ${viewer.device.name}` : ''}</div>
          </div>
          <button type="button" onClick={() => { setLang(lang === 'fr' ? 'en' : 'fr'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sunken sm:hidden"><Globe className="size-4" />{lang === 'fr' ? 'English' : 'Français'}</button>
          {!viewer.builtin && <button type="button" onClick={() => { setOpen(false); router.push('/settings/profile'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sunken"><UserRound className="size-4" />{t('Mon profil et NIP', 'My profile & PIN')}</button>}
          {viewer.device
            ? <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-sunken"><Lock className="size-4" />{t('Verrouiller la tablette', 'Lock the tablet')}</button>
            : <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sunken"><LogOut className="size-4" />{t('Se déconnecter', 'Sign out')}</button>}
        </div>
      )}
    </div>
  );
}

function StatusBanners() {
  const { pulse, online } = usePulse();
  const healthNow = useSyncExternalStore(subscribeHealth, () => health(), () => 'good' as const);
  const { can } = useViewer();
  const { t } = useI18n();
  const [netOk, setNetOk] = useState(true);
  useEffect(() => { const u = () => setNetOk(navigator.onLine); u(); window.addEventListener('online', u); window.addEventListener('offline', u); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', u); }; }, []);
  const bars: ReactNode[] = [];
  if (netOk && online && healthNow === 'stale') bars.push(<Bar key="stale" tone="wait" icon={<WifiOff className="size-4" />}>{t('Les données ne se rafraîchissent plus — reconnexion… Les commandes continuent sur les tablettes des plateformes et dans Clover.', 'Data is not refreshing — reconnecting… Orders keep arriving on the platform tablets and in Clover.')}</Bar>);
  if (!netOk || !online) bars.push(<Bar key="off" tone="stop" icon={<WifiOff className="size-4" />}>{t('Pas de connexion — les commandes continuent sur les tablettes des plateformes et dans Clover. Reconnexion automatique…', 'No connection — orders keep coming on the platform tablets and in Clover. Reconnecting…')}</Bar>);
  if (pulse?.devices.offline) bars.push(<Bar key="dev" tone="wait" href="/alerts">{t(`${pulse.devices.offline} tablette(s) de cuisine hors ligne`, `${pulse.devices.offline} kitchen tablet(s) offline`)}</Bar>);
  if (pulse && !pulse.live && can('admin')) bars.push(<Bar key="live" tone="wait" href="/settings/channels">{t('Mode sécurité : rien n’est envoyé aux plateformes (LIVE_CONNECTORS_GLOBAL_ENABLED=false).', 'Safe mode: nothing is sent to the platforms (LIVE_CONNECTORS_GLOBAL_ENABLED=false).')}</Bar>);
  if (pulse?.mode === 'memory' && can('admin')) bars.push(<Bar key="mem" tone="info">{t('Mode démo : Supabase n’est pas branché, les données sont en mémoire.', 'Demo mode: Supabase is not connected, data lives in memory.')}</Bar>);
  if (!bars.length) return null;
  return <div className="space-y-px">{bars}</div>;
}

function Bar({ tone, children, href, icon }: { tone: 'stop' | 'wait' | 'info'; children: ReactNode; href?: string; icon?: ReactNode }) {
  const cls = cn('flex items-center justify-center gap-2 px-4 py-2 text-center text-[13px] font-semibold', tone === 'stop' ? 'bg-stop text-white' : tone === 'wait' ? 'bg-wait-soft text-wait-2' : 'bg-info-soft text-info-2');
  return href ? <Link href={href} className={cls}>{icon}{children} →</Link> : <div className={cls}>{icon}{children}</div>;
}

/** A → A+ → A++ for this screen (kitchen tablets start at A+). */
function TextSizeButton() {
  const { t } = useI18n();
  const [display, setDisplay] = useDisplay();
  const label = display.text === 'md' ? 'A' : display.text === 'lg' ? 'A+' : 'A++';
  return (
    <Hint id="shell.textsize">
      <button type="button" onClick={() => setDisplay({ text: nextTextSize(display.text) })} className="hidden h-10 min-w-10 items-center sm:flex justify-center rounded-md px-2 text-[15px] font-extrabold text-ink-3 hover:bg-sunken hover:text-ink"
        aria-label={t(`Taille du texte : ${label}`, `Text size: ${label}`)} title={t('Taille du texte', 'Text size')}>{label}</button>
    </Hint>
  );
}
