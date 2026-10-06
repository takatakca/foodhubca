'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Bike, Check, ChevronRight, Eye, MapPin, Printer, Volume2, X } from 'lucide-react';
import { Badge, PlatformMark, platformOf } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/form';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { CountdownRing, Elapsed, fmtDuration, useNow } from '@/components/ui/timer';
import { usePulse } from '@/components/live/pulse';
import { ALLERGY, courierLabel, useOrderActions } from '@/components/live/order-drawer';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { audioReady, loopSound, playSound, setVolume, unlockAudio } from '@/lib/ui/sound';
import { money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { LiveOrder } from '@/lib/foodhub/pulse';
import { cn } from '@/lib/ui/cn';

// ---------- per-screen alert settings (kitchen tablet vs office PC) ----------
export type AlertSettings = { sound: boolean; popup: boolean; repeatSec: number; desktop: boolean; volume: number };
const KEY = 'takatak.alerts.v1';
const DEFAULTS: AlertSettings = { sound: true, popup: true, repeatSec: 3, desktop: false, volume: 0.9 };
export function readAlertSettings(): AlertSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
}
export function writeAlertSettings(s: AlertSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('takatak:alerts'));
}
function useAlertSettings() {
  const [s, setS] = useState<AlertSettings>(DEFAULTS);
  useEffect(() => { const r = () => { const n = readAlertSettings(); setVolume(n.volume); setS(n); }; r(); window.addEventListener('takatak:alerts', r); return () => window.removeEventListener('takatak:alerts', r); }, []);
  return s;
}

const PREP = [10, 15, 20, 25, 30, 45];

/**
 * The new-order takeover: beep beep → one look → one tap. Shows every new order (and every auto-accepted
 * order nobody looked at yet) full screen, one at a time, with a countdown to the platform deadline.
 */
export function IncomingOrders() {
  const { pulse } = usePulse();
  const { can, viewer, locName } = useViewer();
  const { t, lang, loc } = useI18n();
  const settings = useAlertSettings();
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [prep, setPrep] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const now = useNow(1000);
  const { run, busy } = useOrderActions();
  const stopLoop = useRef<null | (() => void)>(null);
  const announced = useRef<Set<string>>(new Set());

  const enabled = can('orders:act') && settings.popup;
  const queue = useMemo(() => (pulse?.incoming ?? []).filter((o) => !(snoozed[o.id] > now) && !(done[o.id] > now - 15_000)), [pulse, snoozed, done, now]);
  const order: LiveOrder | undefined = queue[Math.min(index, Math.max(0, queue.length - 1))];
  const kitchenMin = order?.locationCode ? pulse?.kitchen?.[order.locationCode]?.minutes ?? 15 : 15;

  useEffect(() => { setPrep(null); setRejecting(false); }, [order?.id]);
  useEffect(() => { if (index >= queue.length) setIndex(0); }, [queue.length, index]);

  // Sound: loops while anything is waiting (needs one tap on the page first — browsers' rule).
  const ringing = enabled && settings.sound && queue.length > 0;
  useEffect(() => {
    if (!ringing) { stopLoop.current?.(); stopLoop.current = null; return; }
    if (!stopLoop.current) stopLoop.current = loopSound(queue.some((o) => o.status === 'new') ? 'order' : 'soft', Math.max(2, settings.repeatSec) * 1000);
    return undefined;
  }, [ringing, settings.repeatSec, queue]);
  useEffect(() => () => { stopLoop.current?.(); }, []);

  // Desktop notification + tab title when the screen is in the background.
  useEffect(() => {
    if (!enabled) return;
    for (const o of queue) {
      if (announced.current.has(o.id)) continue;
      announced.current.add(o.id);
      if (settings.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { new Notification(`${platformOf(o.channel).label} #${o.displayId}`, { body: `${o.brandName ?? ''} · ${money(o.total, loc)}`, tag: o.id, requireInteraction: true }); } catch { /* ignore */ }
      }
    }
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = queue.length ? `(${queue.length}) ${base}` : base;
  }, [queue, enabled, settings.desktop, loc]);

  const close = useCallback((id: string) => { setDone((d) => ({ ...d, [id]: Date.now() })); setIndex(0); }, []);
  const accept = useCallback(async () => {
    if (!order) return;
    unlockAudio();
    if (order.status === 'new') {
      const r = await run(order.id, 'accept', { prepMinutes: prep ?? kitchenMin });
      if (r?.result.ok) { playSound('ready'); close(order.id); }
    } else {
      const r = await run(order.id, 'ack');
      if (r) close(order.id);
    }
  }, [order, run, prep, kitchenMin, close]);
  const later = useCallback(() => { if (order) { setSnoozed((s) => ({ ...s, [order.id]: Date.now() + 60_000 })); setIndex(0); } }, [order]);

  useEffect(() => {
    if (!enabled || !order || rejecting) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); accept(); }
      if (e.key === 'Escape') later();
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % Math.max(1, queue.length));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [enabled, order, accept, later, rejecting, queue.length]);

  if (!enabled || !order) return null;

  const p = platformOf(order.channel);
  const isNew = order.status === 'new';
  // Skip's JET backup hand-off exists only for Skip's own orders — a relayed Skip order is rejected normally (with a reason).
  const skipTablet = order.channel === 'skip' && !order.viaHub;
  const allergy = [order.notes, ...order.lines.map((l) => l.notes)].some((n) => n && ALLERGY.test(n));
  const items = order.lines.reduce((s, l) => s + l.quantity, 0);
  const minutes = prep ?? kitchenMin;
  const waited = (now - Date.parse(order.createdAt)) / 1000;

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-ink/70 backdrop-blur-sm animate-fade sm:items-center sm:p-6" onPointerDown={() => unlockAudio()}>
      <div className={cn('relative flex max-h-dvh w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-pop animate-rise sm:max-h-[94dvh] sm:rounded-2xl', isNew && 'sm:animate-ring')}>
        {/* header */}
        <div className={cn('flex items-center gap-4 px-5 py-4 text-white sm:px-6', p.color)}>
          <PlatformMark channel={order.channel} size="lg" className="bg-white/20" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold tracking-[0.14em] uppercase opacity-90">{isNew ? t('Nouvelle commande', 'New order') : t('Acceptée automatiquement — à voir', 'Auto-accepted — please look')}</div>
            <div className="flex flex-wrap items-baseline gap-x-3 text-2xl font-extrabold sm:text-3xl">#{order.displayId}<span className="text-base font-semibold opacity-90">{p.label}</span></div>
          </div>
          {queue.length > 1 && <Badge tone="dark" className="bg-black/30 text-white">{Math.min(index, queue.length - 1) + 1} / {queue.length}</Badge>}
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {/* who / where / how long */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-ink">{order.brandName ?? t('Marque inconnue', 'Unknown brand')}</div>
              <div className="flex items-center gap-1.5 text-sm text-ink-3"><MapPin className="size-3.5" />{order.locationCode ? shortLoc(locName(order.locationCode)) : t('magasin non relié', 'store not mapped')} · {order.fulfillment === 'pickup' ? t('pour emporter', 'pickup') : t('livraison', 'delivery')} · {items} {t('art.', 'items')}</div>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <div className="text-right"><div className="text-xs text-ink-3">{t('Total client', 'Customer total')}</div><div className="num text-xl font-extrabold">{money(order.total, loc)}</div></div>
              {isNew && order.deadlineAt ? (
                <CountdownRing from={order.createdAt} to={order.deadlineAt} size={84}>
                  <span className="num text-lg font-extrabold">{fmtDuration((Date.parse(order.deadlineAt) - now) / 1000)}</span>
                  <span className="text-[10px] text-ink-3">{t('pour répondre', 'to answer')}</span>
                </CountdownRing>
              ) : (
                <div className="text-right"><div className="text-xs text-ink-3">{t('Attend depuis', 'Waiting')}</div><Elapsed since={order.createdAt} warnAt={90} badAt={180} className="text-xl" /></div>
              )}
            </div>
          </div>

          {allergy && <div className="mx-5 mt-4 rounded-lg bg-stop px-4 py-3 text-base font-extrabold text-white sm:mx-6">⚠ {t('ALLERGIE — lisez les notes', 'ALLERGY — read the notes')}</div>}
          {order.posError && <div className="mx-5 mt-4 rounded-lg bg-stop-soft px-4 py-3 text-sm font-semibold text-stop-2 sm:mx-6">{t('Clover n’a pas reçu cette commande — elle ne s’imprimera pas.', 'Clover did not get this order — it will not print.')}</div>}
          {order.courier && <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-info-soft px-4 py-2.5 text-sm font-semibold text-info-2 sm:mx-6"><Bike className="size-4" />{courierLabel(t, order.courier.status)}{order.courier.name ? ` · ${order.courier.name}` : ''}</div>}

          {/* items */}
          <ul className="divide-y divide-line px-5 py-2 sm:px-6">
            {order.lines.map((l, i) => (
              <li key={i} className="flex gap-3 py-3">
                <span className="num flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink text-lg font-extrabold text-canvas">{l.quantity}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg leading-snug font-bold text-ink">{l.name}</div>
                  {l.modifiers.map((m, j) => <div key={j} className="text-[15px] text-ink-2">+ {m.quantity > 1 ? `${m.quantity}× ` : ''}{m.name}</div>)}
                  {l.notes && <div className={cn('mt-1 inline-block rounded-md px-2 py-1 text-sm font-bold', ALLERGY.test(l.notes) ? 'bg-stop text-white' : 'bg-wait-soft text-wait-2')}>« {l.notes} »</div>}
                </div>
              </li>
            ))}
          </ul>
          {order.notes && <div className={cn('mx-5 mb-4 rounded-lg px-4 py-3 text-[15px] font-bold sm:mx-6', ALLERGY.test(order.notes) ? 'bg-stop text-white' : 'bg-wait-soft text-wait-2')}>📝 {order.notes}</div>}
        </div>

        {/* actions */}
        <div className="safe-bottom border-t border-line bg-raised px-5 py-4 sm:px-6">
          {isNew && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3"><AlarmClock className="size-4" />{t('Prête dans', 'Ready in')}</span>
              <Chips size="sm" value={minutes} onChange={(v) => setPrep(v)} options={PREP.map((m) => ({ value: m, label: `${m} min` }))} />
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="go" size="xl" className="flex-1 text-xl" loading={busy === 'accept' || busy === 'ack'} onClick={accept} icon={isNew ? <Check className="size-7" /> : <Eye className="size-7" />}>
              {isNew ? <span>{t('Accepter', 'Accept')} <span className="font-semibold opacity-90">· {minutes} min</span></span> : t('Vu — en préparation', 'Seen — cooking it')}
            </Button>
            {isNew && order.actions.includes('deny') && (
              <Button variant="outline" size="xl" className="text-stop sm:w-44" onClick={() => skipTablet ? run(order.id, 'deny', { reason: 'Handled on Skip tablet' }).then((r) => r && close(order.id)) : setRejecting(true)} icon={<X className="size-6" />}>
                {skipTablet ? t('Tablette Skip', 'Skip tablet') : t('Refuser', 'Reject')}
              </Button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Button variant="ghost" size="sm" onClick={later} icon={<AlarmClock className="size-4" />}>{t('Plus tard (1 min)', 'Later (1 min)')}</Button>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 font-semibold text-ink-2 hover:bg-sunken" href={`/ticket/${order.id}`} target="_blank" rel="noreferrer"><Printer className="size-4" />{t('Billet', 'Ticket')}</a>
            {!audioReady() && settings.sound && <button type="button" onClick={() => { unlockAudio(); playSound('soft'); }} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-wait-soft px-3 font-semibold text-wait-2"><Volume2 className="size-4" />{t('Activer le son', 'Turn sound on')}</button>}
            <span className="ml-auto text-ink-3">{waited > 60 ? `${t('en attente depuis', 'waiting for')} ${fmtDuration(waited)}` : ''}</span>
            {queue.length > 1 && <Button variant="outline" size="sm" onClick={() => setIndex((i) => (i + 1) % queue.length)} icon={<ChevronRight className="size-4" />}>{t('Suivante', 'Next')}</Button>}
          </div>
          {viewer.device && <div className="mt-1 text-[11px] text-ink-4">{t('Entrée = accepter · Échap = plus tard', 'Enter = accept · Esc = later')}</div>}
        </div>
      </div>
      {rejecting && (
        <ReasonDialog title={t('Refuser la commande', 'Reject the order')} note={t('La raison est envoyée à la plateforme. Un gérant doit approuver avec son NIP.', 'The reason goes to the platform. A manager approves with their PIN.')}
          confirmLabel={t('Refuser', 'Reject')} busy={busy === 'deny'} onClose={() => setRejecting(false)}
          onPick={async (code, details) => { const r = await run(order.id, 'deny', { reasonCode: code, reason: details }); if (r?.result.ok) { playSound('cancel'); setRejecting(false); close(order.id); } }} />
      )}
      <span className="sr-only" aria-live="assertive">{lang === 'fr' ? `Nouvelle commande ${p.label} ${order.displayId}` : `New ${p.label} order ${order.displayId}`}</span>
    </div>
  );
}
