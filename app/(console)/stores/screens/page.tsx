'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Bell, BellOff, Columns2, ExternalLink, Expand, GripVertical, LayoutGrid, LogIn, Maximize2, MonitorPlay, Move, Pencil, Plus, RefreshCw,
  Download, List, RotateCcw, Save, Share2, ShieldAlert, Shrink, Smartphone, Square, Trash2, Wand2, X,
} from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { ago, api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { playSound, unlockAudio } from '@/lib/ui/sound';
import { ringDecision, type RingMemory } from '@/lib/ui/screens-ring';
import {
  addTile, BOARD, changeTile, clampPage, clampTile, defaultCustom, DEFAULT_WALL, gridShape, moveId, orderIds, pageCount, pageOf, pageSlice, parseWall,
  removeTile, type CustomTile, type GridView, type WallState, type WallView,
} from '@/lib/ui/screens-layout';

// Stores → Platform screens: the screens wall. Every Uber Eats, DoorDash and Skip order screen of every franchise runs on
// the screen relay host (deploy/screens/), wired and always on, and shows here: 1, 2, 4, 8, 12 or 16 at a time, as tabs,
// or on a custom board where each screen is dragged and resized. The owner signs in once, inside each screen: Food Hub
// never asks for or keeps a platform password. Status comes from the relay agent's heartbeat; the Watchtower rings when
// a screen goes down or orders wait. "Ring on this device" makes one device at the counter ring for all of them.
// Plan: docs/ORDER_SCREENS_RESCUE.md. The layout is saved on each device.

type Platform = 'ubereats' | 'doordash' | 'skip' | 'other';
type Status = 'online' | 'login_required' | 'error' | 'offline' | 'never';
type Screen = {
  id: string; name: string; platform: Platform; locationCode: string; viewUrl: string; createdBy: string; createdAt: string;
  lastSeenAt?: string | null; pageTitle?: string | null; pageHost?: string | null; titleCount?: number | null; autoReloads?: number | null;
  command?: { kind: 'reload' | 'open'; url?: string; at: string; by: string } | null; status: Status;
  mode?: 'web' | 'android' | null; app?: string | null; waitingSince?: string | null; storeIds?: string[]; protectedStoreIds?: string[];
};
type OrderPath = { platform: Platform; mode: 'via_clover' | 'direct' | 'none'; cloverReady: boolean; lastOrderAt: string | null };
type Form = { name: string; platform: Platform; locationCode: string; viewUrl: string; storeIds: string };
type T = (fr: string, en: string) => string;

const RING_KEY = 'takatak.screens.ring.v1';
const WALL_KEY = 'takatak.screens.wall.v1';
const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: 'doordash', label: 'DoorDash' }, { value: 'ubereats', label: 'Uber Eats' }, { value: 'skip', label: 'SkipTheDishes' }, { value: 'other', label: 'Autre / Other' },
];
const platformLabel = (p: Platform) => PLATFORMS.find((x) => x.value === p)?.label ?? p;
const PLATFORM_DOT: Record<Platform, string> = { doordash: 'bg-[#eb1700]', ubereats: 'bg-[#06c167]', skip: 'bg-[#f36d00]', other: 'bg-ink-3' };

/** The first free numbered screen after the highest one (s01 when none exists). */
function nextSlot(screens: Array<{ id: string }>) {
  const nums = screens.map((s) => /^s(\d{2})$/.exec(s.id)?.[1]).filter(Boolean).map(Number);
  return nums.length ? Math.min(99, Math.max(...nums) + 1) : 1;
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function PlatformScreensPage() {
  const { t, lang } = useI18n();
  const { can, locations, locName } = useViewer();
  const toast = useToast();
  const narrow = useNarrow();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [paths, setPaths] = useState<OrderPath[]>([]);
  const [agent, setAgent] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Screen | 'new' | null>(null);
  const [setup, setSetup] = useState(false);
  const [remove, setRemove] = useState<Screen | null>(null);
  const [ring, setRing] = useState(false);
  const [wall, setWall] = useState<WallState>(DEFAULT_WALL);
  const [arrange, setArrange] = useState(false);
  const [full, setFull] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const [areaH, setAreaH] = useState<number | null>(null);
  const memory = useRef<RingMemory>({});
  const ringRef = useRef(false);
  const restored = useRef(false);
  const manage = can('stores:map');
  const canAct = can('orders:act');

  // This device's choices: ringing, view, order, custom board.
  // A device with no layout of its own starts from the layout shared with every device (if one was shared).
  useEffect(() => {
    let local: string | null = null;
    try {
      setRing(localStorage.getItem(RING_KEY) === '1');
      local = localStorage.getItem(WALL_KEY);
    } catch { /* private mode: defaults */ }
    if (local) setWall(parseWall(local));
    else api<{ wall: WallState | null }>('/api/foodhub/screens/layout').then((d) => { if (d.wall) setWall(parseWall(JSON.stringify(d.wall))); }).catch(() => undefined);
    restored.current = true;
  }, []);
  useEffect(() => { ringRef.current = ring; }, [ring]);
  useEffect(() => {
    if (!restored.current) return;
    try { localStorage.setItem(WALL_KEY, JSON.stringify(wall)); } catch { /* private mode */ }
  }, [wall]);

  const load = useCallback(() => api<{ screens: Screen[]; agentConfigured: boolean; orderPaths?: OrderPath[] }>('/api/foodhub/screens')
    .then((d) => {
      setScreens(d.screens); setPaths(d.orderPaths ?? []); setAgent(d.agentConfigured); setLoaded(true); setErr('');
      const r = ringDecision(d.screens, memory.current);
      memory.current = r.memory;
      if (ringRef.current && r.tone) playSound(r.tone);
    })
    .catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); const id = setInterval(load, ring ? 10_000 : 15_000); return () => clearInterval(id); }, [load, ring]);

  // The wall stays awake while it rings (a sleeping screen is a tablet that is off).
  useEffect(() => {
    if (!ring) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try { if (document.visibilityState === 'visible' && 'wakeLock' in navigator) lock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen'); } catch { /* not allowed */ }
    };
    wake();
    document.addEventListener('visibilitychange', wake);
    return () => { document.removeEventListener('visibilitychange', wake); lock?.release().catch(() => undefined); };
  }, [ring]);

  // The wall takes the whole window under its toolbar: it scrolls into view when the view changes, and full screen
  // hides the console altogether.
  useEffect(() => {
    const fit = () => setAreaH(Math.max(480, window.innerHeight - 128)); // the console's top bar (64) + the wall's toolbar
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wallRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  function toggleRing() {
    const next = !ring;
    if (next) { unlockAudio(); playSound('soft'); }
    setRing(next);
    try { localStorage.setItem(RING_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  }
  async function shareLayout() {
    try {
      await api('/api/foodhub/screens/layout', { method: 'PUT', body: JSON.stringify({ wall }) });
      toast.success(t('Disposition partagée', 'Layout shared'), t('Les appareils sans disposition à eux partent de celle-ci ; les autres peuvent la reprendre.', 'Devices without a layout of their own start from it; the others can take it.'));
    } catch (e) { fail(e); }
  }
  async function useSharedLayout() {
    try {
      const d = await api<{ wall: WallState | null }>('/api/foodhub/screens/layout');
      if (d.wall) { setWall(parseWall(JSON.stringify(d.wall))); toast.success(t('Disposition partagée reprise', 'Shared layout applied')); }
      else toast.error(t('Aucune disposition partagée pour l’instant.', 'No shared layout yet.'));
    } catch (e) { fail(e); }
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else wallRef.current?.requestFullscreen?.().catch(() => undefined);
  }

  const fail = (e: unknown) => { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); };
  async function command(s: Screen, action: 'reload' | 'open') {
    try {
      await api(`/api/foodhub/screens/${s.id}`, { method: 'POST', body: JSON.stringify({ action }) });
      toast.success(action === 'reload' ? t('Rechargement demandé', 'Reload asked') : t('Page de connexion demandée', 'Sign-in page asked'), t('Le serveur relais s’en occupe dans 20 s au plus.', 'The relay host does it within 20 s.'));
      await load();
    } catch (e) { fail(e); }
  }
  async function changePlatform(s: Screen, platform: Platform) {
    try {
      await api(`/api/foodhub/screens/${s.id}`, { method: 'PATCH', body: JSON.stringify({ platform }) });
      toast.success(t('Canal changé', 'Channel changed'), `${s.name} → ${platformLabel(platform)}. ${t('L’écran ouvre la page de connexion.', 'The screen opens the sign-in page.')}`);
      await load();
    } catch (e) { fail(e); }
  }
  async function doRemove(s: Screen) {
    setRemove(null);
    try { await api(`/api/foodhub/screens/${s.id}`, { method: 'DELETE' }); toast.success(t('Écran retiré', 'Screen removed'), s.name); await load(); }
    catch (e) { fail(e); }
  }

  // Numbered screens (s01, s02…) in their number order, then the others by name; the owner's own order wins.
  const natural = screens.slice().sort((a, b) => {
    const sa = /^s\d{2}$/.test(a.id), sb = /^s\d{2}$/.test(b.id);
    return sa !== sb ? (sa ? -1 : 1) : sa ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name);
  });
  const order = orderIds(natural.map((s) => s.id), wall.order);
  const byId = new Map(screens.map((s) => [s.id, s]));
  const ordered = order.map((id) => byId.get(id)).filter((s): s is Screen => !!s);
  const down = screens.filter((s) => s.status !== 'online' && s.status !== 'never').length;
  const waitingNow = ringDecision(screens, {});

  // A phone shows one screen at a time (with pages) or the tabs.
  const view: WallView = narrow && wall.view !== '1' && wall.view !== 'tabs' && wall.view !== 'list' ? '1' : wall.view;
  function setView(view: WallView) {
    setArrange(false);
    setWall((w) => ({ ...w, view, page: 0, custom: view === 'custom' && !w.custom.length ? defaultCustom(order) : w.custom }));
    if (!document.fullscreenElement) wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const reorder = (from: string, to: string) => setWall((w) => ({ ...w, order: moveId(order, from, to) }));
  const focus = (id: string) => { setArrange(false); setWall((w) => ({ ...w, view: 'tabs', tab: id })); };
  /** Show a screen where the owner is: its page in a grid view, its tab, or big when it is not on the custom board. */
  const reveal = (id: string) => {
    const per = Number(view);
    if (Number.isFinite(per) && per > 0) setWall((w) => ({ ...w, page: pageOf(order, id, per) }));
    else if (view === 'tabs' || !wall.custom.some((x) => x.id === id)) focus(id);
    wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const waitingScreens = ordered.filter((s) => s.status === 'online' && (s.titleCount ?? 0) > 0);

  const tileProps = (s: Screen) => ({
    s, lang, loc: shortLoc(locName(s.locationCode)), manage, canAct,
    onReload: () => command(s, 'reload'), onOpen: () => command(s, 'open'), onPlatform: (p: Platform) => changePlatform(s, p),
    onFocus: () => focus(s.id), onEdit: () => setEdit(s), onRemove: () => setRemove(s),
  });

  return (
    <div>
      <PageHeader title={t('Écrans des plateformes', 'Platform screens')}
        subtitle={loaded && screens.length > 0 ? undefined : t('Tous les écrans de commandes DoorDash, Uber Eats et Skip de toutes les franchises, côte à côte. Ils tournent sur le serveur relais, branché et toujours allumé : plus de tablette qui perd le Wi-Fi. Vous vous connectez une seule fois, dans chaque écran — Food Hub ne voit et ne garde jamais vos mots de passe.', 'Every DoorDash, Uber Eats and Skip order screen of every franchise, side by side. They run on the relay host, wired and always on: no more tablet losing its Wi-Fi. You sign in once, inside each screen — Food Hub never sees or keeps your passwords.')}
        right={<div className="flex flex-wrap gap-2">
          <Button variant={ring ? 'primary' : 'outline'} onClick={toggleRing} icon={ring ? <Bell className="size-4" /> : <BellOff className="size-4" />}>
            {ring ? t('Sonne sur cet appareil', 'Rings on this device') : t('Sonner sur cet appareil', 'Ring on this device')}
          </Button>
          {manage && <Button variant="outline" onClick={() => setSetup(true)} icon={<Wand2 className="size-4" />}>{t('Préparer les écrans', 'Set up screens')}</Button>}
          {manage && <Button onClick={() => setEdit('new')} icon={<Plus className="size-4" />}>{t('Ajouter un écran', 'Add a screen')}</Button>}
        </div>} />
      <StoresTabs />
      {err && <Banner tone="stop" className="mb-3">{err}</Banner>}
      {loaded && !agent && manage && (
        <Banner tone="warn" className="mb-3">{t('Le serveur relais n’est pas encore branché : réglez FOODHUB_SCREENS_AGENT_TOKEN (24 caractères ou plus) sur Food Hub et sur le serveur relais. Guide : docs/PLATFORM_SCREENS.md.', 'The relay host is not connected yet: set FOODHUB_SCREENS_AGENT_TOKEN (24+ characters) on Food Hub and on the relay host. Guide: docs/PLATFORM_SCREENS.md.')}</Banner>
      )}
      {waitingNow.waiting > 0 && (
        <Banner tone="warn" className={cn('mb-3 text-base', ring && 'animate-pulse')}>
          <strong>{t(`${waitingNow.waiting} commande(s) en attente`, `${waitingNow.waiting} order(s) waiting`)}</strong> —{' '}
          {waitingScreens.map((s, i) => (
            <span key={s.id}>{i > 0 && ' · '}<button type="button" className="font-semibold underline underline-offset-2" onClick={() => reveal(s.id)}>{s.name} ({s.titleCount})</button></span>
          ))}. {t('Touchez un écran pour y aller, puis acceptez dans l’écran de la plateforme.', 'Tap a screen to go to it, then accept inside the platform screen.')}
        </Banner>
      )}
      {loaded && down > 0 && <Banner tone="stop" className="mb-3">{t(`${down} écran(s) à vérifier : hors ligne, déconnecté(s) ou planté(s). Rechargez, ou reconnectez-vous dans l’écran.`, `${down} screen(s) need attention: offline, signed out or crashed. Reload, or sign in again inside the screen.`)}</Banner>}
      {paths.length > 0 && <OrderPathsStrip paths={paths} t={t} lang={lang} />}

      <div ref={wallRef} className={cn('flex scroll-mt-[72px] flex-col gap-2', full && 'bg-canvas p-2')}>
        <WallToolbar t={t} wall={{ ...wall, view }} count={ordered.length} narrow={narrow} full={full} arrange={arrange} ring={ring}
          onView={setView} onPage={(page) => setWall((w) => ({ ...w, page }))} onFull={toggleFull} onArrange={() => setArrange((a) => !a)} onRing={toggleRing}
          onResetCustom={() => setWall((w) => ({ ...w, custom: defaultCustom(order) }))}
          unplaced={wall.view === 'custom' ? ordered.filter((s) => !wall.custom.some((x) => x.id === s.id)) : []}
          onPlace={(id) => setWall((w) => ({ ...w, custom: addTile(w.custom, id) }))}
          onShare={manage ? shareLayout : undefined} onUseShared={useSharedLayout} />
        {loaded && screens.length === 0 ? (
          <Card><EmptyState icon={<MonitorPlay className="size-6" />} title={t('Aucun écran', 'No screen')}
            body={t('« Préparer les écrans » crée d’un coup les écrans numérotés (ex. 18 DoorDash, 18 Uber Eats, 18 Skip), chacun prêt à se connecter. Le serveur relais : docs/PLATFORM_SCREENS.md.', '“Set up screens” creates the numbered screens in one go (e.g. 18 DoorDash, 18 Uber Eats, 18 Skip), each ready to sign in. The relay host: docs/PLATFORM_SCREENS.md.')}
            action={manage ? <Button onClick={() => setSetup(true)} icon={<Wand2 className="size-4" />}>{t('Préparer les écrans', 'Set up screens')}</Button> : undefined} /></Card>
        ) : (
          <div className="min-h-0" style={narrow ? undefined : { height: full ? 'calc(100vh - 64px)' : areaH ? `${areaH}px` : 'max(480px, calc(100vh - 290px))' }}>
            {view === 'list' ? (
              <ListWall screens={ordered} locations={locations} manage={manage} canAct={canAct} t={t} lang={lang}
                onSaved={load} onFocus={focus} onCommand={command} />
            ) : view === 'tabs' ? (
              <TabsWall screens={ordered} active={wall.tab} t={t} onTab={(id) => setWall((w) => ({ ...w, tab: id }))} onMove={reorder} tile={tileProps} />
            ) : view === 'custom' ? (
              <CustomWall screens={ordered} tiles={wall.custom} arrange={arrange} t={t} tile={tileProps}
                onTiles={(custom) => setWall((w) => ({ ...w, custom }))} />
            ) : (
              <GridWall screens={ordered} view={Number(view) as GridView} page={wall.page} narrow={narrow} onMove={reorder} tile={tileProps} />
            )}
          </div>
        )}
      </div>

      {edit && <ScreenDialog screen={edit === 'new' ? null : edit} locations={locations} onClose={() => setEdit(null)}
        onDone={async (name) => { setEdit(null); toast.success(t('Écran enregistré', 'Screen saved'), name); await load(); }} />}
      {setup && <SetupDialog locations={locations} existing={screens.length} nextSlot={nextSlot(screens)} onClose={() => setSetup(false)}
        onDone={async (n) => { setSetup(false); toast.success(t('Écrans prêts', 'Screens ready'), t(`${n} écran(s) créé(s), chacun ouvre sa page de connexion.`, `${n} screen(s) created, each opens its sign-in page.`)); await load(); }} />}
      {remove && (
        <Modal size="sm" title={t('Retirer cet écran ?', 'Remove this screen?')} onClose={() => setRemove(null)}
          footer={<><Button variant="ghost" size="lg" onClick={() => setRemove(null)}>{t('Annuler', 'Cancel')}</Button><Button variant="danger" size="lg" onClick={() => doRemove(remove)}>{t('Retirer', 'Remove')}</Button></>}>
          <p className="text-sm text-ink-2"><strong className="text-ink">{remove.name}</strong> · {platformLabel(remove.platform)}. {t('Il disparaît de Food Hub et la surveillance ne le suit plus. L’écran continue de tourner sur le serveur relais.', 'It leaves Food Hub and the watchtower stops following it. The screen keeps running on the relay host.')}</p>
        </Modal>
      )}
    </div>
  );
}

// ---- How each platform's orders reach Clover (the screens never carry orders) ----

function OrderPathsStrip({ paths, t, lang }: { paths: OrderPath[]; t: T; lang: 'fr' | 'en' }) {
  const text = (p: OrderPath) => p.mode === 'via_clover' ? t('commandes → Clover par le lien de la plateforme', 'orders → Clover through the platform’s link')
    : p.mode === 'direct' ? (p.cloverReady ? t('commandes → Food Hub → Clover', 'orders → Food Hub → Clover') : t('commandes → Food Hub (Clover pas branché)', 'orders → Food Hub (Clover not connected)'))
    : t('écran seulement : le ticket sort de la tablette ou de l’imprimante', 'screen only: the ticket comes from the tablet or printer');
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1 text-xs sm:flex-wrap sm:overflow-visible">
      {paths.map((p) => {
        const ok = p.mode === 'via_clover' || (p.mode === 'direct' && p.cloverReady);
        return (
          <span key={p.platform} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1', ok ? 'border-go/30 bg-go-soft text-go-2' : 'border-wait/30 bg-wait-soft text-wait-2')}
            title={p.lastOrderAt ? `${t('Dernière commande', 'Last order')} ${ago(p.lastOrderAt, lang)}` : undefined}>
            <span className={cn('size-2 rounded-full', PLATFORM_DOT[p.platform])} />
            <strong>{platformLabel(p.platform)}</strong> {text(p)}
            {p.lastOrderAt && <span className="opacity-75">· {ago(p.lastOrderAt, lang)}</span>}
          </span>
        );
      })}
    </div>
  );
}

// ---- Toolbar: views, pages, arrange, full screen ----

function WallToolbar({ t, wall, count, narrow, full, arrange, ring, unplaced, onView, onPage, onFull, onArrange, onRing, onResetCustom, onPlace, onShare, onUseShared }: {
  t: T; wall: WallState; count: number; narrow: boolean; full: boolean; arrange: boolean; ring: boolean; unplaced: Screen[];
  onView: (v: WallView) => void; onPage: (p: number) => void; onFull: () => void; onArrange: () => void; onRing: () => void; onResetCustom: () => void; onPlace: (id: string) => void;
  onShare?: () => void; onUseShared: () => void;
}) {
  const per = wall.view === 'tabs' || wall.view === 'custom' || wall.view === 'list' ? null : Number(wall.view);
  const pages = per ? pageCount(count, per) : 1;
  const page = per ? clampPage(wall.page, count, per) : 0;
  const views: Array<{ v: WallView; label: ReactNode; title: string }> = [
    { v: '1', label: <Square className="size-3.5" />, title: t('1 écran', '1 screen') },
    { v: '2', label: <Columns2 className="size-3.5" />, title: t('2 écrans', '2 screens') },
    ...(['4', '8', '12', '16', '20', '24'] as const).map((v) => ({ v, label: v, title: t(`${v} écrans`, `${v} screens`) })),
    { v: 'tabs', label: t('Onglets', 'Tabs'), title: t('Un grand écran, les autres en onglets', 'One big screen, the others as tabs') },
    { v: 'custom', label: <><LayoutGrid className="size-3.5" />{t('Personnalisé', 'Custom')}</>, title: t('Placez et redimensionnez chaque écran', 'Place and resize each screen') },
    { v: 'list', label: <><List className="size-3.5" />{t('Liste', 'List')}</>, title: t('Tous les écrans en liste : nommer, canal, succursale, magasins', 'Every screen as a list: name, channel, location, stores') },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={t('Affichage', 'View')} className="inline-flex flex-wrap rounded-md border border-line bg-surface p-0.5">
        {views.filter((x) => !narrow || x.v === '1' || x.v === 'tabs' || x.v === 'list').map((x) => (
          <button key={x.v} type="button" role="radio" aria-checked={wall.view === x.v} title={x.title} onClick={() => onView(x.v)}
            className={cn('inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm px-2 text-xs font-bold', wall.view === x.v ? 'bg-ink text-canvas' : 'text-ink-2 hover:bg-sunken')}>
            {x.label}
          </button>
        ))}
      </div>
      {per && pages > 1 && (
        <div className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</Button>
          {t('Page', 'Page')} {page + 1} / {pages}
          <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>›</Button>
        </div>
      )}
      {wall.view === 'custom' && !narrow && (
        <>
          <Button size="sm" variant={arrange ? 'primary' : 'outline'} onClick={onArrange} icon={<Move className="size-3.5" />}>{arrange ? t('Terminer', 'Done') : t('Arranger', 'Arrange')}</Button>
          {arrange && <Button size="sm" variant="ghost" onClick={onResetCustom} icon={<RotateCcw className="size-3.5" />}>{t('Grille égale', 'Even grid')}</Button>}
          {arrange && unplaced.map((s) => (
            <Button key={s.id} size="xs" variant="soft" onClick={() => onPlace(s.id)} icon={<Plus className="size-3" />}>{s.name}</Button>
          ))}
        </>
      )}
      <span className="ml-auto inline-flex flex-wrap gap-1">
        {!narrow && onShare && <Button size="sm" variant="ghost" onClick={onShare} icon={<Share2 className="size-3.5" />} title={t('Cette disposition devient celle de tous les appareils sans disposition à eux', 'This layout becomes the one of every device without its own')}>{t('Partager la disposition', 'Share layout')}</Button>}
        {!narrow && <Button size="sm" variant="ghost" onClick={onUseShared} icon={<Download className="size-3.5" />} title={t('Reprendre la disposition partagée sur cet appareil', 'Use the shared layout on this device')}>{t('Disposition partagée', 'Shared layout')}</Button>}
        {full && <Button size="sm" variant={ring ? 'primary' : 'outline'} onClick={onRing} icon={ring ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}>{ring ? t('Sonne', 'Ringing') : t('Muet', 'Muted')}</Button>}
        {!narrow && <Button size="sm" variant="outline" onClick={onFull} icon={full ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}>{full ? t('Quitter le plein écran', 'Exit full screen') : t('Plein écran', 'Full screen')}</Button>}
      </span>
    </div>
  );
}

// ---- The three walls ----

type TileFor = (s: Screen) => Omit<TileProps, 'compact' | 'header'>;

function dragHandlers(id: string, onMove: (from: string, to: string) => void) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/x-screen', id); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('text/x-screen')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
    onDrop: (e: DragEvent) => { const from = e.dataTransfer.getData('text/x-screen'); if (from) { e.preventDefault(); onMove(from, id); } },
  };
}

function GridWall({ screens, view, page, narrow, onMove, tile }: { screens: Screen[]; view: GridView; page: number; narrow: boolean; onMove: (from: string, to: string) => void; tile: TileFor }) {
  const { cols, rows } = gridShape(view);
  const visible = pageSlice(screens, view, page);
  const style: CSSProperties | undefined = narrow ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
  return (
    <div className={cn('grid gap-2', narrow ? 'grid-cols-1' : 'h-full')} style={style}>
      {visible.map((s) => (
        <div key={s.id} className={cn('min-h-0 min-w-0', narrow && 'h-[70vh]')}>
          <ScreenTile {...tile(s)} compact={view >= 8} header={dragHandlers(s.id, onMove)} />
        </div>
      ))}
    </div>
  );
}

function TabsWall({ screens, active, t, onTab, onMove, tile }: { screens: Screen[]; active: string | null; t: T; onTab: (id: string) => void; onMove: (from: string, to: string) => void; tile: TileFor }) {
  const current = screens.find((s) => s.id === active) ?? screens[0];
  return (
    <div className="flex h-full flex-col gap-2">
      <div role="tablist" aria-label={t('Écrans', 'Screens')} className="flex gap-1 overflow-x-auto pb-1">
        {screens.map((s) => {
          const on = s.id === current?.id;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => onTab(s.id)} {...dragHandlers(s.id, onMove)}
              className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold', on ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink-2 hover:bg-sunken')}>
              <span className={cn('size-2 rounded-full', PLATFORM_DOT[s.platform])} />
              {s.name}
              <StatusDot tone={statusTone(s.status)} />
              {(s.titleCount ?? 0) > 0 && s.status === 'online' && <Badge tone="wait">{s.titleCount}</Badge>}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">{current && <ScreenTile {...tile(current)} compact={false} />}</div>
    </div>
  );
}

function CustomWall({ screens, tiles: saved, arrange, t, tile, onTiles }: { screens: Screen[]; tiles: CustomTile[]; arrange: boolean; t: T; tile: TileFor; onTiles: (tiles: CustomTile[]) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x: number; y: number; base: CustomTile } | null>(null);
  const [live, setLive] = useState<CustomTile | null>(null);
  const byId = new Map(screens.map((s) => [s.id, s]));
  const tiles = saved.filter((x) => byId.has(x.id));

  function start(e: ReactPointerEvent, base: CustomTile, mode: 'move' | 'resize') {
    if (!arrange || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: base.id, mode, x: e.clientX, y: e.clientY, base };
    setLive(base);
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    const el = board.current;
    if (!d || !el) return;
    const cw = el.clientWidth / BOARD;
    const ch = el.clientHeight / BOARD;
    const dx = Math.round((e.clientX - d.x) / cw);
    const dy = Math.round((e.clientY - d.y) / ch);
    setLive(clampTile(d.mode === 'move' ? { ...d.base, x: d.base.x + dx, y: d.base.y + dy } : { ...d.base, w: d.base.w + dx, h: d.base.h + dy }));
  }
  function end() {
    const d = drag.current;
    drag.current = null;
    if (d && live) onTiles(changeTile(saved, d.id, { dx: live.x - d.base.x, dy: live.y - d.base.y, dw: live.w - d.base.w, dh: live.h - d.base.h }));
    setLive(null);
  }
  /** Arrow keys move the focused tile when arranging; Shift + arrows resize it. */
  function key(e: ReactKeyboardEvent, id: string) {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const s = step[e.key];
    if (!arrange || !s) return;
    e.preventDefault();
    onTiles(changeTile(saved, id, e.shiftKey ? { dw: s[0], dh: s[1] } : { dx: s[0], dy: s[1] }));
  }

  return (
    <div ref={board} className={cn('relative h-full w-full rounded-md', arrange && 'bg-[linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] bg-[size:calc(100%/12)_calc(100%/12)]')}>
      {tiles.length === 0 && (
        <div className="grid h-full place-items-center text-sm text-ink-3">{t('Touchez « Arranger », puis ajoutez des écrans au tableau.', 'Tap “Arrange”, then add screens to the board.')}</div>
      )}
      {tiles.map((base) => {
        const s = byId.get(base.id)!;
        const p = live && live.id === base.id ? live : base;
        return (
          <div key={base.id} className={cn('absolute p-1', live?.id === base.id && 'z-20')}
            style={{ left: `${(p.x / BOARD) * 100}%`, top: `${(p.y / BOARD) * 100}%`, width: `${(p.w / BOARD) * 100}%`, height: `${(p.h / BOARD) * 100}%` }}>
            <ScreenTile {...tile(s)} compact={p.w <= 3 || p.h <= 3} />
            {arrange && (
              <div tabIndex={0} role="group" aria-label={`${s.name} — ${t('flèches : déplacer, Maj + flèches : redimensionner', 'arrows: move, Shift + arrows: resize')}`}
                onKeyDown={(e) => key(e, base.id)} onPointerDown={(e) => start(e, base, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                className="absolute inset-1 z-10 flex cursor-move items-center justify-center rounded-md border-2 border-dashed border-brand bg-brand/10 outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <span className="inline-flex items-center gap-1 rounded bg-ink px-2 py-1 text-xs font-bold text-canvas"><GripVertical className="size-3.5" />{s.name}</span>
                <button type="button" aria-label={t('Retirer du tableau', 'Take off the board')} onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onTiles(removeTile(saved, base.id))} className="absolute right-1 top-1 rounded bg-surface p-1 text-ink-2 shadow-card hover:text-stop"><X className="size-3.5" /></button>
                <span aria-hidden onPointerDown={(e) => { e.stopPropagation(); start(e, base, 'resize'); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                  className="absolute bottom-0 right-0 size-5 cursor-se-resize rounded-tl bg-brand" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- List: every screen on one line (54 accounts are named and assigned here, no live view loaded) ----

function ListWall({ screens, locations, manage, canAct, t, lang, onSaved, onFocus, onCommand }: {
  screens: Screen[]; locations: Array<{ code: string; name: string }>; manage: boolean; canAct: boolean; t: T; lang: 'fr' | 'en';
  onSaved: () => void; onFocus: (id: string) => void; onCommand: (s: Screen, action: 'reload' | 'open') => void;
}) {
  const counts = PLATFORMS.map((p) => ({ ...p, n: screens.filter((s) => s.platform === p.value).length })).filter((p) => p.n > 0);
  return (
    <div className="h-full overflow-auto rounded-md border border-line bg-surface">
      <div className="flex flex-wrap gap-2 border-b border-line px-3 py-2 text-xs text-ink-2">
        <strong className="text-ink">{t(`${screens.length} écran(s)`, `${screens.length} screen(s)`)}</strong>
        {counts.map((p) => <span key={p.value} className="inline-flex items-center gap-1"><span className={cn('size-2 rounded-full', PLATFORM_DOT[p.value])} />{p.label} {p.n}</span>)}
        <span className="ml-auto">{t('Un compte par écran : chacun se connecte avec son propre courriel et mot de passe, tapés par vous dans l’écran.', 'One account per screen: each signs in with its own email and password, typed by you inside the screen.')}</span>
      </div>
      <table className="w-full min-w-[860px] text-sm">
        <thead className="sticky top-0 z-10 bg-sunken text-left text-xs text-ink-3">
          <tr>
            <th className="px-3 py-2">#</th><th className="px-2 py-2">{t('Canal', 'Channel')}</th><th className="px-2 py-2">{t('Nom (restaurant)', 'Name (restaurant)')}</th>
            <th className="px-2 py-2">{t('Succursale', 'Location')}</th><th className="px-2 py-2">{t('Magasins', 'Stores')}</th><th className="px-2 py-2">{t('État', 'Status')}</th><th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {screens.map((s) => <ListRow key={s.id} s={s} locations={locations} manage={manage} canAct={canAct} t={t} lang={lang} onSaved={onSaved} onFocus={onFocus} onCommand={onCommand} />)}
        </tbody>
      </table>
    </div>
  );
}

function ListRow({ s, locations, manage, canAct, t, lang, onSaved, onFocus, onCommand }: {
  s: Screen; locations: Array<{ code: string; name: string }>; manage: boolean; canAct: boolean; t: T; lang: 'fr' | 'en';
  onSaved: () => void; onFocus: (id: string) => void; onCommand: (s: Screen, action: 'reload' | 'open') => void;
}) {
  const toast = useToast();
  const initial = { name: s.name, platform: s.platform, locationCode: s.locationCode, storeIds: (s.storeIds ?? []).join(', ') };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = f.name !== initial.name || f.platform !== initial.platform || f.locationCode !== initial.locationCode || f.storeIds !== initial.storeIds;
  const waiting = s.status === 'online' && (s.titleCount ?? 0) > 0 ? s.titleCount ?? 0 : 0;
  async function save() {
    setBusy(true);
    try {
      await api(`/api/foodhub/screens/${s.id}`, { method: 'PATCH', body: JSON.stringify(f) });
      toast.success(t('Écran enregistré', 'Screen saved'), `${s.id} · ${f.name}`);
      onSaved();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <tr className={cn('border-t border-line align-middle', waiting > 0 && 'bg-wait-soft')}>
      <td className="px-3 py-1.5 font-mono text-xs text-ink-3">{s.id}</td>
      <td className="px-2 py-1.5">
        {manage ? (
          <Select selectSize="sm" aria-label={t('Canal', 'Channel')} value={f.platform} onChange={(e) => setF((x) => ({ ...x, platform: e.target.value as Platform }))} className="h-8 text-xs">
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        ) : <span className="inline-flex items-center gap-1.5 text-xs font-bold"><span className={cn('size-2 rounded-full', PLATFORM_DOT[s.platform])} />{platformLabel(s.platform)}</span>}
      </td>
      <td className="px-2 py-1.5">{manage ? <Input inputSize="sm" aria-label={t('Nom', 'Name')} value={f.name} maxLength={60} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /> : s.name}</td>
      <td className="px-2 py-1.5">
        {manage ? (
          <Select selectSize="sm" aria-label={t('Succursale', 'Location')} value={f.locationCode} onChange={(e) => setF((x) => ({ ...x, locationCode: e.target.value }))} className="h-8 text-xs">
            {locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}
          </Select>
        ) : <span className="text-xs">{shortLoc(locations.find((l) => l.code === s.locationCode)?.name ?? s.locationCode)}</span>}
      </td>
      <td className="px-2 py-1.5">
        {manage ? <Input inputSize="sm" aria-label={t('Magasins', 'Stores')} value={f.storeIds} inputMode="numeric" placeholder="28040070" onChange={(e) => setF((x) => ({ ...x, storeIds: e.target.value }))} />
          : <span className="text-xs">{(s.storeIds ?? []).join(', ') || '—'}</span>}
        {(s.protectedStoreIds ?? []).length > 0 && <Badge tone="stop" className="mt-1" icon={<ShieldAlert className="size-3" />}>{t('protégé', 'protected')}</Badge>}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
        <span className="inline-flex items-center gap-1.5"><StatusDot tone={statusTone(s.status)} />{statusText(s, t, lang)}</span>
        {waiting > 0 && <Badge tone="wait" className="ml-1">{waiting} {t('en attente', 'waiting')}</Badge>}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        {manage && <Button size="xs" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} loading={busy} onClick={save} icon={<Save className="size-3.5" />}>{t('Enregistrer', 'Save')}</Button>}
        {canAct && s.platform !== 'other' && <TileButton label={t('Page de connexion', 'Sign-in page')} onClick={() => onCommand(s, 'open')} disabled={!!s.command}><LogIn className="size-3.5" /></TileButton>}
        <TileButton label={t('Voir l’écran', 'See the screen')} onClick={() => onFocus(s.id)}><Maximize2 className="size-3.5" /></TileButton>
      </td>
    </tr>
  );
}

// ---- One screen ----

const statusTone = (s: Status) => (s === 'online' ? 'go' : s === 'never' ? 'neutral' : s === 'login_required' ? 'wait' : 'stop') as 'go' | 'neutral' | 'wait' | 'stop';

function statusText(s: Screen, t: T, lang: 'fr' | 'en') {
  switch (s.status) {
    case 'online': return t('En ligne', 'Online');
    case 'login_required': return t('Connexion requise', 'Sign-in needed');
    case 'error': return t('Page plantée', 'Page crashed');
    case 'offline': return `${t('Hors ligne', 'Offline')} · ${ago(s.lastSeenAt, lang)}`;
    default: return t('Jamais vu', 'Never seen');
  }
}

type TileProps = {
  s: Screen; lang: 'fr' | 'en'; loc: string; manage: boolean; canAct: boolean; compact: boolean;
  header?: Record<string, unknown>;
  onReload: () => void; onOpen: () => void; onPlatform: (p: Platform) => void; onFocus: () => void; onEdit: () => void; onRemove: () => void;
};

function ScreenTile({ s, lang, loc, manage, canAct, compact, header, onReload, onOpen, onPlatform, onFocus, onEdit, onRemove }: TileProps) {
  const { t } = useI18n();
  const tone = statusTone(s.status);
  const waiting = s.status === 'online' && (s.titleCount ?? 0) > 0 ? s.titleCount ?? 0 : 0;
  const protectedIds = s.protectedStoreIds ?? [];
  return (
    <section aria-label={`${platformLabel(s.platform)} — ${s.name}`}
      className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-surface shadow-card', waiting > 0 ? 'border-wait ring-2 ring-wait/60' : tone === 'stop' ? 'border-stop/50' : 'border-line')}>
      <header {...header} onDoubleClick={onFocus} className={cn('flex items-center gap-1.5 border-b border-line', compact ? 'px-1.5 py-1' : 'px-2.5 py-1.5', header && 'cursor-grab active:cursor-grabbing')}>
        <span className={cn('size-2.5 shrink-0 rounded-full', PLATFORM_DOT[s.platform])} aria-hidden />
        {manage && !compact ? (
          <Select selectSize="sm" aria-label={t('Canal', 'Channel')} value={s.platform} onChange={(e) => onPlatform(e.target.value as Platform)} className="h-7 w-auto py-0 text-xs font-bold">
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        ) : !compact ? <span className="shrink-0 text-xs font-bold text-ink">{platformLabel(s.platform)}</span> : null}
        <span className={cn('min-w-0 truncate font-semibold text-ink', compact ? 'text-xs' : 'text-sm')} title={`${s.name} · ${loc}`}>{s.name}</span>
        {waiting > 0 && <Badge tone="wait" className={cn(compact ? '' : 'text-sm')}>{waiting} {t('en attente', 'waiting')}</Badge>}
        {s.mode === 'android' && <Badge tone="info" icon={<Smartphone className="size-3" />} title={s.app ?? undefined}>{compact ? '' : 'Android'}</Badge>}
        {protectedIds.length > 0 && <Badge tone="stop" icon={<ShieldAlert className="size-3" />} title={t(`Magasin protégé ${protectedIds.join(', ')} : personne n’agit dessus depuis Food Hub.`, `Protected store ${protectedIds.join(', ')}: nobody acts on it from Food Hub.`)}>{compact ? '' : t('protégé', 'protected')}</Badge>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-3">
          <StatusDot tone={tone} pulse={s.status === 'online'} />{!compact && <span className="whitespace-nowrap">{statusText(s, t, lang)}</span>}
        </span>
        <span className="inline-flex shrink-0">
          {canAct && <TileButton label={t('Recharger', 'Reload')} onClick={onReload} disabled={!!s.command}><RefreshCw className="size-3.5" /></TileButton>}
          {canAct && !compact && s.platform !== 'other' && <TileButton label={t('Page de connexion', 'Sign-in page')} onClick={onOpen} disabled={!!s.command}><LogIn className="size-3.5" /></TileButton>}
          <TileButton label={t('Agrandir', 'Make big')} onClick={onFocus}><Maximize2 className="size-3.5" /></TileButton>
          <a className="inline-flex size-7 items-center justify-center rounded-sm text-ink-2 hover:bg-sunken" href={s.viewUrl} target="_blank" rel="noopener noreferrer" title={t('Ouvrir seul', 'Open alone')} aria-label={t('Ouvrir seul', 'Open alone')}><ExternalLink className="size-3.5" /></a>
          {manage && !compact && <TileButton label={t('Modifier', 'Edit')} onClick={onEdit}><Pencil className="size-3.5" /></TileButton>}
          {manage && !compact && <TileButton label={t('Retirer', 'Remove')} onClick={onRemove}><Trash2 className="size-3.5" /></TileButton>}
        </span>
      </header>
      <div className="relative min-h-0 flex-1 bg-black">
        {/* The relay host's own page (KasmVNC / noVNC). It needs scripts and its own storage, so it is not sandboxed;
            it is a separate origin, so it cannot read Food Hub. */}
        <iframe title={`${platformLabel(s.platform)} — ${s.name}`} src={s.viewUrl} referrerPolicy="no-referrer" loading="lazy"
          allow="clipboard-read; clipboard-write; fullscreen; autoplay" className="absolute inset-0 h-full w-full" />
        {(s.status === 'never' || s.status === 'offline') && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/70 p-3 text-center text-xs text-canvas">
            <div><MonitorPlay className="mx-auto mb-1 size-6 opacity-80" />
              <strong>{s.status === 'never' ? t('En attente du serveur relais', 'Waiting for the relay host') : t('Pas de signal du serveur relais', 'No signal from the relay host')}</strong>
              {!compact && <div className="mt-1 opacity-80">{t(`Écran ${s.id}. Dès que le serveur relais tourne, il s’affiche ici, prêt à se connecter.`, `Screen ${s.id}. As soon as the relay host runs, it shows here, ready to sign in.`)}</div>}
            </div>
          </div>
        )}
        {s.status === 'login_required' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-wait px-2 py-1 text-center text-[11px] font-bold text-white">
            {t('Connectez-vous dans cet écran (vous tapez le mot de passe vous-même, une seule fois)', 'Sign in inside this screen (you type the password yourself, once)')}
          </div>
        )}
        {s.status === 'error' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-stop px-2 py-1 text-center text-[11px] font-bold text-white">{t('Page plantée — touchez Recharger', 'Page crashed — tap Reload')}</div>
        )}
      </div>
    </section>
  );
}

function TileButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} onDoubleClick={(e) => e.stopPropagation()}
      className="inline-flex size-7 items-center justify-center rounded-sm text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-40">{children}</button>
  );
}

// ---- Dialogs ----

const MAX_SLOTS = 99;

function SetupDialog({ locations, existing, nextSlot, onClose, onDone }: { locations: Array<{ code: string; name: string }>; existing: number; nextSlot: number; onClose: () => void; onDone: (n: number) => void }) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [locationCode, setLocation] = useState(locations[0]?.code ?? '');
  // One account per screen: 18 DoorDash + 18 Uber Eats + 18 Skip by default (owner's 54 accounts).
  const [counts, setCounts] = useState({ doordash: 18, ubereats: 18, skip: 18 });
  const [start, setStart] = useState(nextSlot);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = counts.doordash + counts.ubereats + counts.skip;
  const last = start + total - 1;
  const num = (v: string) => Math.max(0, Math.min(MAX_SLOTS, Math.floor(Number(v) || 0)));
  const slot = (n: number) => `s${String(n).padStart(2, '0')}`;
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ created: number; kept: string[] }>('/api/foodhub/screens/setup', { method: 'POST', body: JSON.stringify({ baseUrl, locationCode, counts, start }) });
      onDone(r.created);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={t('Préparer les écrans', 'Set up screens')} onClose={onClose}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={busy} disabled={!total || last > MAX_SLOTS} onClick={go}>{t(`Créer ${total} écran(s)`, `Create ${total} screen(s)`)}</Button></>}>
      <div className="space-y-3">
        {err && <Banner tone="stop">{err}</Banner>}
        <p className="text-sm text-ink-2">{t('Crée les écrans numérotés s01, s02… Chacun ouvre la page de connexion de son canal sur le serveur relais : vous vous connectez ensuite une fois dans chaque écran. Le serveur relais utilise les mêmes numéros (docs/ORDER_SCREENS_RESCUE.md).', 'Creates the numbered screens s01, s02… Each opens its channel’s sign-in page on the relay host: you then sign in once in each screen. The relay host uses the same numbers (docs/ORDER_SCREENS_RESCUE.md).')}</p>
        {existing > 0 && <Banner tone="info">{t('Les numéros qui existent déjà sont gardés tels quels ; seuls les nouveaux sont créés.', 'Numbers that already exist are kept as they are; only new ones are created.')}</Banner>}
        <div className="grid grid-cols-3 gap-2">
          {(['doordash', 'ubereats', 'skip'] as const).map((p) => (
            <Field key={p} label={<span className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-full', PLATFORM_DOT[p])} />{platformLabel(p)}</span>}>
              <Input type="number" min={0} max={MAX_SLOTS} value={counts[p]} onChange={(e) => setCounts((c) => ({ ...c, [p]: num(e.target.value) }))} />
            </Field>
          ))}
        </div>
        <Field label={t('Commencer au numéro', 'Start at number')}
          hint={total ? t(`Crée ${slot(start)} à ${slot(last)} : un compte par écran, chacun avec sa propre connexion. Plusieurs serveurs relais ? Lancez-le une fois par serveur, avec son adresse et son numéro de départ.`, `Creates ${slot(start)} to ${slot(last)}: one account per screen, each with its own sign-in. Several relay hosts? Run it once per host, with its address and start number.`) : undefined}
          error={last > MAX_SLOTS ? t(`${MAX_SLOTS} écrans au plus (s01 à s${MAX_SLOTS}).`, `${MAX_SLOTS} screens at most (s01 to s${MAX_SLOTS}).`) : undefined}>
          <Input type="number" min={1} max={MAX_SLOTS} value={start} onChange={(e) => setStart(Math.max(1, Math.min(MAX_SLOTS, Math.floor(Number(e.target.value) || 1))))} />
        </Field>
        <Field label={t('Succursale', 'Location')}>
          <Select value={locationCode} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>
        </Field>
        <Field label={t('Adresse du serveur relais', 'Relay host address')}
          hint={t('Ex. https://ecrans.exemple.ca/ — chaque écran sera à …/s01/, …/s02/. Jamais de mot de passe dans l’adresse.', 'E.g. https://screens.example.ca/ — each screen will be at …/s01/, …/s02/. Never a password in the address.')}>
          <Input value={baseUrl} inputMode="url" placeholder="https://" onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ScreenDialog({ screen, locations, onClose, onDone }: { screen: Screen | null; locations: Array<{ code: string; name: string }>; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<Form>(() => ({
    name: screen?.name ?? '', platform: screen?.platform ?? 'doordash', locationCode: screen?.locationCode ?? locations[0]?.code ?? '', viewUrl: screen?.viewUrl ?? '',
    storeIds: (screen?.storeIds ?? []).join(', '),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ screen: Screen }>(screen ? `/api/foodhub/screens/${screen.id}` : '/api/foodhub/screens', { method: screen ? 'PATCH' : 'POST', body: JSON.stringify(f) });
      onDone(r.screen.name);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={screen ? t('Modifier l’écran', 'Edit screen') : t('Ajouter un écran', 'Add a screen')} onClose={onClose}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={busy} onClick={go}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="space-y-3">
        {err && <Banner tone="stop">{err}</Banner>}
        <Field label={t('Canal', 'Channel')}>
          <Select value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
        </Field>
        <Field label={t('Nom', 'Name')} hint={t('Ex. « DoorDash — PPP NDG »', 'E.g. “DoorDash — PPP NDG”')}>
          <Input value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('Succursale', 'Location')}>
          <Select value={f.locationCode} onChange={(e) => set('locationCode', e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>
        </Field>
        <Field label={t('Adresse de l’écran (serveur relais)', 'Screen address (relay host)')}
          hint={t('L’adresse https de cet écran sur le serveur relais, ex. https://ecrans.exemple.ca/s01/. Jamais de mot de passe dans l’adresse.', 'This screen’s https address on the relay host, e.g. https://screens.example.ca/s01/. Never a password in the address.')}>
          <Input value={f.viewUrl} inputMode="url" placeholder="https://" onChange={(e) => set('viewUrl', e.target.value)} />
        </Field>
        <Field label={t('Magasins affichés (facultatif)', 'Stores shown (optional)')}
          hint={t('Les numéros de magasin de la plateforme que ce compte affiche, séparés par des virgules. Un magasin protégé est marqué « protégé ».', 'The platform store numbers this account shows, separated by commas. A protected store is marked “protected”.')}>
          <Input value={f.storeIds} inputMode="numeric" onChange={(e) => set('storeIds', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
