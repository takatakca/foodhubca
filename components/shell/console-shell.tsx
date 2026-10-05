'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, Globe, Lock, LogOut, MapPin, Menu as MenuIcon, Search, Sparkles, UserRound, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { Kbd, StatusDot } from '@/components/ui/badge';
import { ToastProvider } from '@/components/ui/toast';
import { ApprovalProvider } from '@/components/live/approval';
import { IncomingOrders } from '@/components/live/incoming';
import { CancelAlarm } from '@/components/live/cancel-alarm';
import { PulseProvider, usePulse } from '@/components/live/pulse';
import { DeviceHeartbeat } from '@/components/live/device-heartbeat';
import { CommandPalette } from './command-palette';
import { NAV, type NavItem } from './nav';
import { CopilotDrawer } from './copilot';
import { shortLoc, useViewer } from './viewer';
import { audioReady, playSound, unlockAudio } from '@/lib/ui/sound';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  return (
    <ToastProvider>
      <ApprovalProvider>
        <PulseProvider fixedScope={viewer.device ? [viewer.device.locationCode] : undefined}>
          <Frame>{children}</Frame>
          <IncomingOrders />
          <CancelAlarm />
          <CommandPalette />
          {viewer.device && <DeviceHeartbeat />}
        </PulseProvider>
      </ApprovalProvider>
    </ToastProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { can, allLocations } = useViewer();
  const { t } = useI18n();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem('takatak.rail') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => { const o = () => setCopilot(true); window.addEventListener('takatak:copilot', o); return () => window.removeEventListener('takatak:copilot', o); }, []);
  useEffect(() => { setMore(false); }, [pathname]);
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const first = () => unlockAudio();
    window.addEventListener('pointerdown', first, { once: true });
    return () => window.removeEventListener('pointerdown', first);
  }, []);
  const items = NAV.filter((n) => can(n.perm) && (!n.allLocations || allLocations));
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem('takatak.rail', c ? '0' : '1'); } catch { /* ignore */ } return !c; }); };
  const kitchen = pathname.startsWith('/kitchen');

  return (
    <div className={cn('min-h-dvh', kitchen && 'theme-kitchen bg-canvas text-ink')}>
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col bg-rail text-white transition-[width] duration-200 lg:flex', collapsed ? 'w-[72px]' : 'w-60')}>
        <div className={cn('flex h-16 items-center gap-2 px-5', collapsed && 'justify-center px-0')}>
          <span className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-black">T</span>
          {!collapsed && <span className="text-[15px] font-extrabold tracking-[0.14em]">TAKATAK</span>}
        </div>
        <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {items.map((n) => <NavLink key={n.href} item={n} collapsed={collapsed} />)}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <button type="button" onClick={() => setCopilot(true)} className={cn('flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white', collapsed && 'justify-center px-0')}>
            <Sparkles className="size-[18px] text-brand" />{!collapsed && t('Copilote', 'Co-pilot')}
          </button>
          <button type="button" onClick={toggle} className={cn('flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-white/50 hover:bg-white/10 hover:text-white', collapsed && 'justify-center px-0')} aria-label={collapsed ? t('Agrandir le menu', 'Expand menu') : t('Réduire le menu', 'Collapse menu')}>
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />{t('Réduire', 'Collapse')}</>}
          </button>
        </div>
      </aside>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-60')}>
        <Topbar onCopilot={() => setCopilot(true)} />
        <StatusBanners />
        <main className={cn('mx-auto w-full flex-1 px-4 pt-5 pb-28 sm:px-6 lg:pb-10', kitchen ? 'max-w-none' : 'max-w-[1400px]')}>{children}</main>
      </div>

      {/* mobile bottom bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {items.filter((n) => ['/', '/orders', '/kitchen', '/alerts'].includes(n.href)).map((n) => <MobileLink key={n.href} item={n} />)}
          <button type="button" onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-ink-3"><MenuIcon className="size-5" />{t('Plus', 'More')}</button>
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-ink/40 lg:hidden" onClick={() => setMore(false)}>
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-4 animate-rise" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><span className="font-extrabold">TAKATAK</span><button type="button" onClick={() => setMore(false)} aria-label="Close"><X className="size-5" /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((n) => <Link key={n.href} href={n.href} className="flex flex-col items-center gap-1.5 rounded-lg bg-sunken p-3 text-xs font-semibold"><n.icon className="size-5" />{n.label(t)}</Link>)}
              <button type="button" onClick={() => { setMore(false); setCopilot(true); }} className="flex flex-col items-center gap-1.5 rounded-lg bg-brand-soft p-3 text-xs font-semibold text-brand-2"><Sparkles className="size-5" />{t('Copilote', 'Co-pilot')}</button>
            </div>
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

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useI18n();
  const path = usePathname();
  const on = item.href === '/' ? path === '/' : path === item.href || path.startsWith(`${item.href}/`);
  const b = useBadge(item.badge);
  return (
    <Link href={item.href} title={collapsed ? item.label(t) : undefined}
      className={cn('relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors', on ? 'bg-white text-[#151514]' : 'text-white/70 hover:bg-white/10 hover:text-white', collapsed && 'justify-center px-0')}>
      <item.icon className={cn('size-[18px] shrink-0', on && 'text-brand')} />
      {!collapsed && <span className="flex-1 truncate">{item.label(t)}</span>}
      {b && (collapsed
        ? <span className={cn('absolute top-1.5 right-2 size-2.5 rounded-full', b.tone === 'stop' ? 'bg-stop' : b.tone === 'wait' ? 'bg-wait' : 'bg-brand')} />
        : <span className={cn('num min-w-6 rounded-full px-1.5 text-center text-[11px] leading-5 font-bold text-white', b.tone === 'stop' ? 'bg-stop' : b.tone === 'wait' ? 'bg-wait' : 'bg-brand', b.tone !== 'wait' && 'animate-pulse-soft')}>{b.n}</span>)}
    </Link>
  );
}

function MobileLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const path = usePathname();
  const on = item.href === '/' ? path === '/' : path.startsWith(item.href);
  const b = useBadge(item.badge);
  return (
    <Link href={item.href} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', on ? 'text-ink' : 'text-ink-3')}>
      <item.icon className={cn('size-5', on && 'text-brand')} />{item.label(t)}
      {b && <span className={cn('num absolute top-2 right-[calc(50%-20px)] min-w-4 rounded-full px-1 text-[10px] leading-4 font-bold text-white', b.tone === 'stop' ? 'bg-stop' : 'bg-brand')}>{b.n}</span>}
    </Link>
  );
}

function Topbar({ onCopilot }: { onCopilot: () => void }) {
  const { viewer, locations, allLocations } = useViewer();
  const { pulse, scope, setScope, online } = usePulse();
  const { t, lang, setLang, loc } = useI18n();
  const [sound, setSound] = useState(false);
  useEffect(() => { const i = setInterval(() => setSound(audioReady()), 1000); return () => clearInterval(i); }, []);
  const scopeLabel = viewer.device ? shortLoc(locations.find((l) => l.code === viewer.device!.locationCode)?.name ?? viewer.device.locationCode)
    : scope.length === 0 ? (allLocations ? t('Toutes les succursales', 'All locations') : t('Mes succursales', 'My locations'))
      : scope.length === 1 ? shortLoc(locations.find((l) => l.code === scope[0])?.name ?? scope[0]) : `${scope.length} ${t('succursales', 'locations')}`;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="mr-1 flex items-center gap-2 lg:hidden"><span className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-black text-white">T</span></Link>
        <ScopePicker label={scopeLabel} locked={Boolean(viewer.device) || locations.length <= 1} scope={scope} setScope={setScope} />
        <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))}
          className="hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-ink-3 hover:border-line-2 md:flex md:max-w-sm">
          <Search className="size-4" /><span className="truncate">{t('Chercher une commande, une page…', 'Search an order, a page…')}</span><span className="ml-auto flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </button>
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          {pulse && (
            <div className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold sm:flex" title={t('Ventes du jour (livraison)', 'Today’s delivery sales')}>
              <StatusDot tone={!online ? 'stop' : pulse.live ? 'go' : 'wait'} pulse={online && pulse.live} />
              <span className="num">{money(pulse.orders.sales, loc)}</span><span className="text-ink-3">· {pulse.orders.today} {t('cmd', 'orders')}</span>
            </div>
          )}
          <button type="button" onClick={() => { unlockAudio(); playSound('soft'); setSound(true); }} className={cn('flex size-10 items-center justify-center rounded-md hover:bg-sunken', sound ? 'text-ink-3' : 'text-wait-2')} aria-label={t('Son', 'Sound')} title={sound ? t('Son actif', 'Sound on') : t('Touchez pour activer le son', 'Tap to turn sound on')}>
            {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new Event('takatak:palette'))} className="flex size-10 items-center justify-center rounded-md text-ink-3 hover:bg-sunken md:hidden" aria-label={t('Chercher', 'Search')}><Search className="size-5" /></button>
          <button type="button" onClick={onCopilot} className="hidden size-10 items-center justify-center rounded-md text-brand hover:bg-brand-soft sm:flex" aria-label={t('Copilote', 'Co-pilot')}><Sparkles className="size-5" /></button>
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="hidden h-10 items-center gap-1 rounded-md px-2 sm:flex text-[13px] font-bold text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Langue / Language"><Globe className="size-4" />{lang === 'fr' ? 'EN' : 'FR'}</button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function ScopePicker({ label, locked, scope, setScope }: { label: string; locked: boolean; scope: string[]; setScope: (s: string[]) => void }) {
  const { locations } = useViewer();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  if (locked) return <div className="flex h-10 items-center gap-2 rounded-md px-2 text-sm font-bold text-ink"><MapPin className="size-4 text-brand" />{label}</div>;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-md px-2 text-sm font-bold text-ink hover:bg-sunken">
        <MapPin className="size-4 text-brand" /><span className="max-w-[24vw] truncate sm:max-w-[40vw]">{label}</span><ChevronDown className="size-4 text-ink-3" />
      </button>
      {open && (
        <div className="absolute top-12 left-0 z-50 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-rise">
          <button type="button" onClick={() => { setScope([]); setOpen(false); }} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-sunken', !scope.length && 'bg-sunken')}>{t('Toutes', 'All')}{!scope.length && <span className="text-brand">✓</span>}</button>
          {locations.map((l) => {
            const on = scope.includes(l.code);
            return (
              <button key={l.code} type="button" onClick={() => setScope(on ? scope.filter((c) => c !== l.code) : [...scope, l.code])} className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sunken', on && 'bg-sunken')}>
                <span><span className="font-semibold">{shortLoc(l.name)}</span><span className="block text-xs text-ink-3">{l.address}</span></span>{on && <span className="text-brand">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
    const r = await api<{ next: string }>('/api/foodhub/auth/logout', { method: 'POST' }).catch(() => ({ next: '/login' }));
    window.location.href = r.next;
  }, []);
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
  const { can } = useViewer();
  const { t } = useI18n();
  const [netOk, setNetOk] = useState(true);
  useEffect(() => { const u = () => setNetOk(navigator.onLine); u(); window.addEventListener('online', u); window.addEventListener('offline', u); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', u); }; }, []);
  const bars: ReactNode[] = [];
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

