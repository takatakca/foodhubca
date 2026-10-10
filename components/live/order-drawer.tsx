'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlarmClockPlus, Bike, Check, CircleDollarSign, ExternalLink, MessageSquareText, PackageCheck, Phone, Printer, RotateCcw, Send, ShoppingBag, TriangleAlert, Undo2, X } from 'lucide-react';
import { Badge, PlatformMark, platformOf, type Tone } from '@/components/ui/badge';
import { Banner } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { Chips, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Drawer, Modal } from '@/components/ui/overlay';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Countdown, Elapsed } from '@/components/ui/timer';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { refreshEverything } from '@/components/live/pulse';
import { api, ApiError, money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { orderSourceLabel, type OrderEvent, type StoredOrder } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

export type FullOrder = StoredOrder & { actions?: string[] };

export const STATUS_TONE: Record<string, Tone> = { new: 'brand', accepted: 'wait', ready: 'go', dispatched: 'info', completed: 'neutral', cancelled: 'stop', failed: 'violet' };
export function statusLabel(t: T, s: string) {
  return ({ new: t('Nouvelle', 'New'), accepted: t('En préparation', 'Preparing'), ready: t('Prête', 'Ready'), dispatched: t('Partie', 'Picked up'), completed: t('Terminée', 'Completed'), cancelled: t('Annulée', 'Cancelled'), failed: t('Sur tablette Skip', 'On Skip tablet') } as Record<string, string>)[s] ?? s;
}
export function courierLabel(t: T, s: string) {
  return ({ assigned: t('Livreur assigné', 'Courier assigned'), arriving: t('Livreur arrive', 'Courier arriving'), at_store: t('Livreur au comptoir', 'Courier at the counter'), picked_up: t('Récupérée', 'Picked up'), delivered: t('Livrée', 'Delivered'), unassigned: t('Livreur retiré', 'Courier unassigned') } as Record<string, string>)[s] ?? s;
}
export const ALLERGY = /allerg|arachid|peanut|noix|\bnuts?\b|gluten|c(œ|oe)liaque|celiac|lactose|sans lait|dairy|fruits de mer|shellfish|sésame|sesame/i;

const EVENT: Record<string, [string, string]> = {
  received: ['Reçue de la plateforme', 'Received from the platform'], duplicate_delivery: ['Doublon ignoré', 'Duplicate ignored'], unmapped_store: ['Magasin non relié', 'Store not mapped'],
  pos_injected: ['Envoyée à Clover', 'Sent to Clover'], pos_failed: ['Clover a refusé', 'Clover refused it'], pos_skipped: ['Clover non connecté', 'Clover not connected'],
  accepted: ['Acceptée', 'Accepted'], accept: ['Acceptée', 'Accepted'], accept_failed: ['Acceptation échouée', 'Accept failed'], deny: ['Refusée', 'Rejected'], deny_failed: ['Refus échoué', 'Reject failed'],
  ready: ['Prête', 'Ready'], ready_failed: ['« Prête » non envoyé', 'Ready not sent'], dispatch: ['Remise au livreur', 'Picked up'], complete: ['Terminée', 'Completed'],
  cancel: ['Annulée', 'Cancelled'], cancel_failed: ['Annulation échouée', 'Cancel failed'], printed: ['Imprimée en cuisine', 'Printed in the kitchen'], print_failed: ['Impression échouée', 'Print failed'],
  routed_to_skip_tablet: ['Envoyée à la tablette Skip', 'Sent to the Skip tablet'], needs_attention: ['À vérifier', 'Needs attention'], platform_status: ['Mise à jour plateforme', 'Platform update'],
  pos_paid: ['Payée dans Clover', 'Paid in Clover'], pos_payment_failed: ['Paiement Clover non noté', 'Clover payment not recorded'], pos_cancelled: ['Retirée de Clover', 'Removed from Clover'],
  scheduled: ['Commande planifiée', 'Scheduled order'], fired: ['Lancée en cuisine', 'Sent to the kitchen'], courier: ['Livreur', 'Courier'], seen: ['Vue en cuisine', 'Seen in the kitchen'],
  delayed: ['Temps ajouté', 'Time added'], report_missing: ['Article manquant signalé', 'Missing item reported'], report_missing_failed: ['Article manquant non envoyé', 'Missing item not sent'],
  adjust_price: ['Changement de prix envoyé', 'Price change sent'], adjust_price_failed: ['Changement de prix refusé', 'Price change refused'], fulfillment_issue_resolved: ['Réponse du client (rupture)', 'Customer answered (out of stock)'],
  customer_sms: ['Texto au client', 'Text to the customer'], customer_sms_failed: ['Texto au client échoué', 'Text to the customer failed'], auto_completed: ['Fermée automatiquement', 'Closed automatically'],
  mapping_warning: ['Ligne en texte libre dans Clover', 'Free-text line in Clover'], pos_retry_scheduled: ['Nouvel essai Clover prévu', 'Clover retry scheduled'],
  pos_retry_gave_up: ['Essais Clover épuisés — gérant alerté', 'Clover retries used up — manager alerted'], pos_adopted: ['Déjà dans Clover — reliée', 'Already in Clover — linked'],
  pos_total_mismatch: ['Total Clover ≠ plateforme', 'Clover total ≠ platform'], accept_skipped: ['Pas acceptée (annulée)', 'Not accepted (cancelled)'], via_clover: ['Reçue par Clover', 'Received through Clover'],
};

/** Runs an order action with the right dialogs (reason, manager PIN via ApprovalProvider) and toasts. */
export function useOrderActions(onDone?: (o: FullOrder | null) => void) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (orderId: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await api<{ order: FullOrder; result: { ok: boolean; message: string }; actions: string[] }>(`/api/foodhub/orders/${orderId}`, { method: 'POST', json: { action, ...extra } });
      if (r.result.ok) {
        if (!['ack', 'print'].includes(action)) toast.success(actionDone(t, action), r.result.message && r.result.message !== 'OK' ? r.result.message : undefined);
      } else toast.error(t('La plateforme a refusé', 'The platform refused'), r.result.message);
      onDone?.({ ...r.order, actions: r.actions });
      refreshEverything();
      return r;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Action impossible', 'Could not do it'), e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [onDone, t, toast]);
  return { run, busy };
}

function actionDone(t: T, a: string) {
  return ({ accept: t('Acceptée ✓', 'Accepted ✓'), deny: t('Refusée', 'Rejected'), ready: t('Prête ✓', 'Ready ✓'), dispatch: t('Remise au livreur', 'Picked up'), complete: t('Terminée', 'Completed'), cancel: t('Annulée', 'Cancelled'), retry_pos: t('Envoyée à Clover', 'Sent to Clover'), print: t('Imprimée', 'Printed'), report_missing: t('Signalé à la plateforme', 'Reported to the platform'), adjust_price: t('Prix envoyé au client', 'Price sent to the customer'), delay: t('Temps ajouté', 'Time added') } as Record<string, string>)[a] ?? a;
}

/** The primary next step for an order in the kitchen. */
export function primaryAction(o: Pick<FullOrder, 'status' | 'actions'>): 'accept' | 'ready' | 'dispatch' | 'complete' | null {
  const a = o.actions ?? [];
  if (a.includes('accept')) return 'accept';
  if (a.includes('ready')) return 'ready';
  if (a.includes('dispatch')) return 'dispatch';
  if (a.includes('complete') && o.status === 'dispatched') return 'complete';
  return null;
}

export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [order, setOrder] = useState<FullOrder | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await api<{ order: StoredOrder; events: OrderEvent[]; actions: string[] }>(`/api/foodhub/orders/${orderId}`);
      setOrder({ ...d.order, actions: d.actions }); setEvents(d.events); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [orderId]);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  const p = order ? platformOf(order.channel) : null;
  return (
    <Drawer onClose={onClose} width="lg"
      title={order ? <span className="flex items-center gap-2.5"><PlatformMark channel={order.channel} size="md" />#{order.displayId || order.externalOrderId.slice(0, 8)}<Badge tone={STATUS_TONE[order.status]}>{statusLabel(t, order.status)}</Badge>{orderSourceLabel(order.orderSource) && <Badge tone="neutral">{orderSourceLabel(order.orderSource)}</Badge>}</span> : t('Commande', 'Order')}
      subtitle={order ? `${p?.label} · ${order.brandName ?? t('Marque ?', 'Brand ?')}` : undefined}
      headerRight={order ? <Link href={`/orders/${order.id}`} className="rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t('Ouvrir en plein écran', 'Open full page')}><ExternalLink className="size-5" /></Link> : null}>
      {error && <div className="p-5"><Banner tone="stop">{error}</Banner></div>}
      {!order && !error && <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-sunken" />)}</div>}
      {order && <OrderDetail order={order} events={events} onChange={(o) => { if (o) setOrder(o); load(); }} />}
    </Drawer>
  );
}

export function OrderDetail({ order, events, onChange, compact }: { order: FullOrder; events: OrderEvent[]; onChange: (o: FullOrder | null) => void; compact?: boolean }) {
  const { t, loc, lang } = useI18n();
  const { can, locName } = useViewer();
  const { run, busy } = useOrderActions(onChange);
  const [reasonFor, setReasonFor] = useState<'deny' | 'cancel' | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const tl = order.timeline ?? {};
  const actions = order.actions ?? [];
  const act = can('orders:act');
  const allergy = [order.notes, ...order.lines.map((l) => l.notes)].some((n) => n && ALLERGY.test(n));
  const prim = primaryAction(order);
  const items = order.lines.reduce((s, l) => s + l.quantity, 0);
  const tel = customerTel(order);

  return (
    <div className={cn('space-y-4', compact ? '' : 'p-5')}>
      {/* timer strip */}
      <div className="grid grid-cols-3 gap-2">
        <Mini label={t('Reçue', 'Received')} value={timeOf(order.createdAt, loc)} sub={<Elapsed since={order.createdAt} />} />
        <Mini label={t('Prête à', 'Ready by')} value={tl.readyTarget ? timeOf(tl.readyTarget, loc) : '—'} sub={tl.readyTarget && ['new', 'accepted'].includes(order.status) ? <Countdown to={tl.readyTarget} /> : tl.readyAt ? `✓ ${timeOf(tl.readyAt, loc)}` : null} />
        <Mini label={t('Mode', 'Mode')} value={order.fulfillment === 'pickup' ? t('Pour emporter', 'Pickup') : order.fulfillment === 'dine_in' ? t('Sur place', 'Dine-in') : t('Livraison', 'Delivery')} sub={`${items} ${t('article(s)', 'item(s)')}`} />
      </div>

      {allergy && <Banner tone="stop"><strong>{t('ALLERGIE / note importante', 'ALLERGY / important note')}</strong> — {t('lisez les notes avant de préparer.', 'read the notes before cooking.')}</Banner>}
      {order.posError && !order.posOrderId && <Banner tone={tl.posRetry?.nextAt && !tl.posRetry.gaveUpAt ? 'warn' : 'stop'} action={act && actions.includes('retry_pos') ? <Button size="sm" variant="outline" loading={busy === 'retry_pos'} onClick={() => run(order.id, 'retry_pos')} icon={<RotateCcw className="size-4" />}>{t('Renvoyer', 'Retry')}</Button> : null}>
        <strong>{t('Clover n’a pas reçu la commande.', 'Clover did not get the order.')}</strong> {order.posError}
        {tl.posRetry?.nextAt && !tl.posRetry.gaveUpAt && <> {t(`Food Hub réessaie tout seul à ${timeOf(tl.posRetry.nextAt, loc)} — rien n’est accepté sur la plateforme avant que Clover l’ait.`, `Food Hub tries again by itself at ${timeOf(tl.posRetry.nextAt, loc)} — nothing is accepted on the platform until Clover has it.`)}</>}
        {tl.posRetry?.gaveUpAt && <> {t(`${tl.posRetry.attempts} essais automatiques sans succès : renvoyez-la, ou entrez-la à la main puis « Accepter sans Clover ».`, `${tl.posRetry.attempts} automatic tries failed: retry it, or enter it by hand then “Accept without Clover”.`)}</>}
      </Banner>}
      {(order.mappingWarnings?.length ?? 0) > 0 && (
        <Banner tone="warn">
          <strong>{t('À vérifier sur le billet Clover :', 'Check on the Clover ticket:')}</strong>{' '}
          {order.mappingWarnings!.map((w, i) => {
            const fr = w.reason === 'foreign_menu' ? 'le menu vient d’un autre marchand Clover : tout est en texte libre.' : w.reason === 'no_menu' ? 'aucun menu pour cette marque : tout est en texte libre.' : `${w.kind === 'item' ? 'article' : 'option'} « ${w.name} » ${w.reason === 'no_clover_link' ? 'pas relié à Clover' : 'introuvable dans le menu'} (texte libre).`;
            const en = w.reason === 'foreign_menu' ? 'the menu comes from another Clover merchant: everything is free text.' : w.reason === 'no_menu' ? 'no menu for this brand: everything is free text.' : `${w.kind} “${w.name}” ${w.reason === 'no_clover_link' ? 'not linked to Clover' : 'not found in the menu'} (free text).`;
            return <span key={i}>{i ? ' · ' : ''}{lang === 'fr' ? fr : en}</span>;
          })}
        </Banner>
      )}
      {order.channelError && <Banner tone="warn"><strong>{t('Plateforme non mise à jour :', 'Platform not updated:')}</strong> {order.channelError}</Banner>}
      {order.viaPos && <Banner tone="info"><strong>{t('Reçue par l’intégration Clover de la plateforme.', 'Received through the platform’s own Clover integration.')}</strong> {t('Clover l’a déjà acceptée, imprimée et encaissée. Food Hub la suit seulement : accepter, refuser ou annuler se fait dans l’app de la plateforme ou dans Clover.', 'Clover already accepted, printed and recorded it. Food Hub only follows it: accept, reject or cancel in the platform’s app or in Clover.')}</Banner>}
      {tl.scheduledFor && <Banner tone="info">{t('Commande planifiée pour', 'Scheduled for')} <strong>{timeOf(tl.scheduledFor, loc, true)}</strong>{tl.fireAt ? ` · ${t('billet cuisine à', 'kitchen ticket at')} ${timeOf(tl.fireAt, loc)}` : ''}</Banner>}

      {/* actions */}
      {act && (actions.length > 0 || ['accepted', 'ready'].includes(order.status)) && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap gap-2">
            {prim === 'accept' && <Button variant="go" size="lg" className="flex-1" loading={busy === 'accept'} onClick={() => run(order.id, 'accept')} icon={<Check className="size-5" />}>{t('Accepter', 'Accept')}</Button>}
            {prim === 'ready' && <Button variant="go" size="lg" className="flex-1" loading={busy === 'ready'} onClick={() => run(order.id, 'ready')} icon={<PackageCheck className="size-5" />}>{t('Prête', 'Ready')}</Button>}
            {prim === 'dispatch' && <Button variant="primary" size="lg" className="flex-1" loading={busy === 'dispatch'} onClick={() => run(order.id, 'dispatch')} icon={<Bike className="size-5" />}>{t('Remise au livreur', 'Picked up')}</Button>}
            {prim === 'complete' && <Button variant="primary" size="lg" className="flex-1" loading={busy === 'complete'} onClick={() => run(order.id, 'complete')} icon={<Check className="size-5" />}>{t('Terminer', 'Complete')}</Button>}
            {actions.includes('deny') && <Button variant="outline" size="lg" className="text-stop" onClick={() => order.channel === 'skip' && !order.viaHub ? run(order.id, 'deny', { reason: 'Handled on Skip tablet' }) : setReasonFor('deny')} icon={<X className="size-5" />}>{order.channel === 'skip' && !order.viaHub ? t('Vers tablette Skip', 'To Skip tablet') : t('Refuser', 'Reject')}</Button>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['accepted', 'ready'].includes(order.status) && [5, 10].map((m) => <Button key={m} size="sm" variant="soft" loading={busy === 'delay'} onClick={() => run(order.id, 'delay', { delayMinutes: m })} icon={<AlarmClockPlus className="size-4" />}>+{m} min</Button>)}
            {actions.includes('complete') && prim !== 'complete' && <Button size="sm" variant="soft" onClick={() => run(order.id, 'complete')}>{t('Terminer', 'Complete')}</Button>}
            {actions.includes('print') && <Button size="sm" variant="soft" loading={busy === 'print'} onClick={() => run(order.id, 'print')} icon={<Printer className="size-4" />}>{t('Réimprimer (Clover)', 'Reprint (Clover)')}</Button>}
            <a className={buttonClass('soft', 'sm')} href={`/ticket/${order.id}`} target="_blank" rel="noreferrer"><Printer className="size-4" />{t('Billet 80 mm', '80 mm ticket')}</a>
            {actions.includes('report_missing') && <Button size="sm" variant="soft" onClick={() => setMissingOpen(true)} icon={<ShoppingBag className="size-4" />}>{t('Article manquant', 'Missing item')}</Button>}
            {actions.includes('adjust_price') && <Button size="sm" variant="soft" onClick={() => setPriceOpen(true)} icon={<CircleDollarSign className="size-4" />}>{t('Changer le prix', 'Change the price')}</Button>}
            {actions.includes('retry_pos') && !order.posError && <Button size="sm" variant="soft" loading={busy === 'retry_pos'} onClick={() => run(order.id, 'retry_pos')} icon={<Send className="size-4" />}>{t('Envoyer à Clover', 'Send to Clover')}</Button>}
            {actions.includes('cancel') && <Button size="sm" variant="soft" className="text-stop" onClick={() => setReasonFor('cancel')} icon={<Undo2 className="size-4" />}>{t('Annuler la commande', 'Cancel order')}</Button>}
          </div>
          {['accepted', 'ready'].includes(order.status) && (order.channel === 'doordash' || order.channel === 'skip') && (
            <p className="mt-2 text-xs text-ink-3">{order.channel === 'doordash' ? t('DoorDash : annulation après acceptation depuis le portail ou la tablette DoorDash.', 'DoorDash: cancel after accepting from the DoorDash portal or tablet.') : t('Skip : annulation après acceptation par la tablette ou le soutien Skip.', 'Skip: cancel after accepting from the Skip tablet or support.')}</p>
          )}
        </div>
      )}

      {/* courier + customer */}
      {(tl.courier || order.customerName) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tl.courier && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-2 text-sm font-bold text-ink"><Bike className="size-4 text-info" />{courierLabel(t, tl.courier.status)}</div>
              <div className="mt-1 text-[13px] text-ink-3">{[tl.courier.name, tl.courier.vehicle, tl.courier.etaAt ? `${t('au comptoir vers', 'at counter ~')} ${timeOf(tl.courier.etaAt, loc)}` : null].filter(Boolean).join(' · ') || '—'}</div>
              {tl.courier.phone && <a href={`tel:${tl.courier.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink underline-offset-4 hover:underline"><Phone className="size-3.5" />{t('Appeler le livreur', 'Call courier')}</a>}
            </div>
          )}
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="text-sm font-bold text-ink">{order.customerName || t('Client', 'Customer')}</div>
            <div className="mt-1 text-[13px] text-ink-3">{t('Numéro relais fourni par la plateforme quand disponible.', 'Relay number from the platform when available.')}</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {tel && <a href={tel} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink underline-offset-4 hover:underline"><Phone className="size-3.5" />{t('Appeler', 'Call')}</a>}
              {act && !['completed', 'cancelled'].includes(order.status) && <button type="button" onClick={() => setTextOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink underline-offset-4 hover:underline"><MessageSquareText className="size-3.5" />{t('Texter', 'Text')}</button>}
            </div>
          </div>
        </div>
      )}

      {/* items */}
      <div className="rounded-lg border border-line bg-surface">
        <div className="divide-y divide-line">
          {order.lines.map((l, i) => (
            <div key={i} className="flex gap-3 px-4 py-3">
              <span className="num flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-sm font-extrabold text-canvas">{l.quantity}</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{l.name}</div>
                {l.modifiers.map((m, j) => <div key={j} className="text-[13px] text-ink-2">+ {m.quantity > 1 ? `${m.quantity}× ` : ''}{m.name}</div>)}
                {l.notes && <div className={cn('mt-1 rounded-sm px-2 py-1 text-[13px] font-semibold', ALLERGY.test(l.notes) ? 'bg-stop-soft text-stop-2' : 'bg-wait-soft text-wait-2')}>« {l.notes} »</div>}
                {!l.posItemRef && <div className="text-[11px] text-ink-4">{t('ligne libre dans Clover', 'custom line in Clover')}</div>}
              </div>
              <div className="num text-sm font-semibold text-ink-2">{money(l.total, loc)}</div>
            </div>
          ))}
        </div>
        {order.notes && <div className={cn('mx-4 mb-3 rounded-md px-3 py-2 text-sm font-semibold', ALLERGY.test(order.notes) ? 'bg-stop-soft text-stop-2' : 'bg-wait-soft text-wait-2')}>📝 {order.notes}</div>}
        {order.doorDash && <DoorDashFacts order={order} loc={loc} />}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-[13px]">
          <dt className="text-ink-3">{t('Sous-total', 'Subtotal')}</dt><dd className="num text-right">{money(order.subtotal, loc)}</dd>
          {order.discount ? <><dt className="text-ink-3">{t('Rabais', 'Discount')}</dt><dd className="num text-right">−{money(order.discount, loc)}</dd></> : null}
          <dt className="text-ink-3">{t('Taxes', 'Tax')}</dt><dd className="num text-right">{money(order.tax, loc)}</dd>
          {order.deliveryFee ? <><dt className="text-ink-3">{t('Livraison', 'Delivery')}</dt><dd className="num text-right">{money(order.deliveryFee, loc)}</dd></> : null}
          {order.tip ? <><dt className="text-ink-3">{t('Pourboire', 'Tip')}</dt><dd className="num text-right">{money(order.tip, loc)}</dd></> : null}
          <dt className="font-bold text-ink">{t('Total client', 'Customer total')}</dt><dd className="num text-right font-extrabold text-ink">{money(order.total, loc)}</dd>
        </dl>
      </div>

      {/* details */}
      <div className="rounded-lg border border-line bg-surface p-4 text-[13px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">{t('Succursale', 'Location')}</dt><dd>{order.locationCode ? locName(order.locationCode) : <span className="text-stop">{t('Magasin non relié', 'Store not mapped')} ({order.channelStoreId})</span>}</dd>
          <dt className="text-ink-3">{t('No plateforme', 'Platform id')}</dt><dd className="font-mono text-xs break-all">{order.externalOrderId}</dd>
          <dt className="text-ink-3">Clover</dt><dd className="font-mono text-xs">{order.posOrderId || '—'} {tl.posPaymentId ? <Badge tone="go" className="ml-1">{t('payée', 'paid')}</Badge> : tl.posPaymentError ? <Badge tone="stop" className="ml-1" title={tl.posPaymentError}>{t('paiement non noté', 'payment not recorded')}</Badge> : null}</dd>
          {tl.acceptedAt && <><dt className="text-ink-3">{t('Acceptée', 'Accepted')}</dt><dd>{timeOf(tl.acceptedAt, loc)} · {tl.acceptedBy === 'auto' ? t('automatiquement', 'automatically') : tl.acceptedBy}{tl.seenBy ? ` · ${t('vue par', 'seen by')} ${tl.seenBy}` : ''}</dd></>}
          {tl.approvedBy && <><dt className="text-ink-3">{t('Approuvé par', 'Approved by')}</dt><dd>{tl.approvedBy}</dd></>}
          {tl.cancelledAt && <><dt className="text-ink-3">{t('Annulée', 'Cancelled')}</dt><dd>{timeOf(tl.cancelledAt, loc)} · {tl.cancelledBy} · {tl.cancelReason}</dd></>}
          {(tl.missingItems?.length ?? 0) > 0 && <><dt className="text-ink-3">{t('Manquants', 'Missing')}</dt><dd>{tl.missingItems!.map((m) => `${m.quantity}× ${m.name}`).join(', ')}</dd></>}
        </dl>
      </div>

      {/* history */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between"><div className="text-sm font-bold text-ink">{t('Historique', 'History')}</div><button type="button" className="text-xs font-semibold text-ink-3 hover:text-ink" onClick={() => setShowRaw(!showRaw)}>{showRaw ? t('Masquer les détails', 'Hide details') : t('Détails techniques', 'Technical details')}</button></div>
        <ol className="relative space-y-2.5 border-l border-line pl-4">
          {events.map((e, i) => {
            const label = EVENT[e.type] ? (lang === 'fr' ? EVENT[e.type][0] : EVENT[e.type][1]) : e.type;
            const d = e.detail as Record<string, any>;
            const bad = /fail|refus/.test(e.type);
            return (
              <li key={i} className="relative">
                <span className={cn('absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface', bad ? 'bg-stop' : 'bg-ink-4')} />
                <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]"><span className="num text-xs text-ink-3">{new Date(e.at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span className="font-semibold text-ink">{label}</span>
                  <span className="text-ink-3">{(lang === 'fr' && d?.messageFr) || d?.message || d?.error || d?.reason || d?.posOrderId || d?.state || ''}{d?.by ? ` · ${d.by}` : d?.auto ? ` · ${t('auto', 'auto')}` : ''}{d?.approvedBy ? ` · ✓ ${d.approvedBy}` : ''}</span></div>
                {showRaw && <pre className="mt-1 overflow-x-auto rounded-sm bg-sunken p-2 text-[11px]">{JSON.stringify(e.detail, null, 2)}</pre>}
              </li>
            );
          })}
          {events.length === 0 && <li className="text-[13px] text-ink-3">{t('Aucun événement.', 'No events.')}</li>}
        </ol>
      </div>

      {reasonFor && (
        <ReasonDialog title={reasonFor === 'deny' ? t('Refuser la commande', 'Reject the order') : t('Annuler la commande', 'Cancel the order')}
          note={reasonFor === 'cancel' ? t('Uber Eats reçoit la raison et rembourse le client.', 'Uber Eats gets the reason and refunds the customer.') : t('La raison est envoyée à la plateforme avec son propre code.', 'The reason goes to the platform with its own code.')}
          confirmLabel={reasonFor === 'deny' ? t('Refuser', 'Reject') : t('Annuler la commande', 'Cancel order')} busy={busy === reasonFor}
          onClose={() => setReasonFor(null)} onPick={async (code, details) => { const a = reasonFor; const r = await run(order.id, a, { reasonCode: code, reason: details }); if (r) setReasonFor(null); }} />
      )}
      {missingOpen && <MissingDialog order={order} onClose={() => setMissingOpen(false)} onSend={async (missing) => { const r = await run(order.id, 'report_missing', { missing }); if (r) setMissingOpen(false); }} />}
      {priceOpen && <PriceDialog onClose={() => setPriceOpen(false)} onSend={async (adjust) => { const r = await run(order.id, 'adjust_price', { adjust }); if (r?.result.ok) setPriceOpen(false); }} />}
      {textOpen && <TextCustomer order={order} onClose={() => setTextOpen(false)} />}
    </div>
  );
}

function customerTel(o: FullOrder): string | null {
  const raw = (o.raw ?? {}) as Record<string, any>;
  const src = raw.order ?? raw;
  const p = src?.eater?.phone ?? src?.consumer?.phone_number ?? src?.customer?.phoneNumber ?? src?.customer?.phone ?? null;
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, '');
  const code = String(src?.eater?.phone_code ?? src?.customer?.phoneMaskingCode ?? '').replace(/\D/g, '');
  return `tel:${digits}${code ? `,,${code}` : ''}`;
}

function Mini({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="num mt-0.5 text-base font-extrabold text-ink">{value}</div>
      {sub && <div className="text-xs">{sub}</div>}
    </div>
  );
}

/** What a DoorDash order carries beyond the common fields: cutlery, scheduled / catering, promotions (who pays), tax DoorDash keeps. */
function DoorDashFacts({ order, loc }: { order: FullOrder; loc: string }) {
  const { t } = useI18n();
  const d = order.doorDash!;
  const chips: ReactNode[] = [];
  if (d.plasticware !== undefined) chips.push(<Badge key="cu" tone={d.plasticware ? 'go' : 'neutral'}>{d.plasticware ? t('Ustensiles : oui', 'Cutlery: yes') : t('Ustensiles : non', 'Cutlery: no')}</Badge>);
  if (d.catering) chips.push(<Badge key="ca" tone="info">{t('Traiteur', 'Catering')}</Badge>);
  else if (d.scheduled) chips.push(<Badge key="sc" tone="info">{t('Commande planifiée', 'Scheduled order')}</Badge>);
  if (d.commissionType === 'dashpass') chips.push(<Badge key="dp" tone="neutral">DashPass</Badge>);
  if (d.taxRemittedByDoorDash) chips.push(<Badge key="tx" tone="wait" title={t('DoorDash perçoit et remet cette taxe : elle n’est pas versée au restaurant.', 'DoorDash collects and remits this tax: it is not paid out to the restaurant.')}>{t('Taxe remise par DoorDash', 'Tax remitted by DoorDash')}{d.taxRemittedAmount ? ` ${money(d.taxRemittedAmount, loc)}` : ''}</Badge>);
  if (!chips.length && !d.promotions?.length && !d.customerPhone && !d.deliveryAddress) return null;
  return (
    <div className="mx-4 mb-3 space-y-1.5 rounded-md border border-line px-3 py-2 text-[13px]">
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {d.promotions?.map((p, i) => (
        <div key={i} className="flex justify-between gap-3 text-ink-2"><span>{t('Promo', 'Promo')} {p.code || p.campaignId || p.id || ''}</span><span className="num">{t('vous', 'you')} {money(p.merchantFunded, loc)} · DoorDash {money(p.doordashFunded, loc)}</span></div>
      ))}
      {d.deliveryAddress && <div className="text-ink-2">🚚 {d.deliveryAddress}{d.addressInstructions ? ` — ${d.addressInstructions}` : ''}</div>}
      {d.customerPhone && <div className="text-ink-3">{t('Téléphone client (masqué si activé)', 'Customer phone (masked when enabled)')} : <span className="num">{d.customerPhone}</span></div>}
    </div>
  );
}

function MissingDialog({ order, onSend, onClose }: { order: FullOrder; onSend: (m: Array<{ line: number; quantity: number }>) => void; onClose: () => void }) {
  const { t } = useI18n();
  const dd = order.channel === 'doordash';
  const [qty, setQty] = useState<Record<number, number>>({});
  const picked = Object.entries(qty).filter(([, q]) => q > 0).map(([line, quantity]) => ({ line: Number(line), quantity }));
  const uber = order.channel === 'uber_eats';
  return (
    <Modal title={dd ? t('Article manquant — DoorDash', 'Missing item — DoorDash') : uber ? t('Article manquant — Uber Eats', 'Missing item — Uber Eats') : t('Article manquant — SkipTheDishes', 'Missing item — SkipTheDishes')}
      subtitle={dd ? t('DoorDash retire l’article (ou réduit la quantité) et ajuste le total du client.', 'DoorDash removes the item (or lowers the quantity) and adjusts the customer’s total.') : uber ? t('Uber demande au client : retirer l’article ou annuler. Sa réponse revient ici.', 'Uber asks the customer: remove the item or cancel. The answer comes back here.') : t('Skip retire l’article et ajuste le prix payé par le client.', 'Skip removes the item and adjusts what the customer pays.')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Retour', 'Back')}</Button><Button variant="danger" disabled={!picked.length} onClick={() => onSend(picked)}>{dd ? t('Envoyer à DoorDash', 'Send to DoorDash') : uber ? t('Envoyer à Uber Eats', 'Send to Uber Eats') : t('Envoyer à Skip', 'Send to Skip')}</Button></>}>
      <div className="space-y-2">
        {order.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
            <div><div className="font-semibold">{l.quantity}× {l.name}</div>{!dd && !uber && !l.externalId && <div className="text-xs text-ink-3">{t('pas d’identifiant Skip — utilisez la tablette', 'no Skip item id — use the tablet')}</div>}{dd && !l.lineItemId && <div className="text-xs text-ink-3">{t('pas d’identifiant de ligne DoorDash — utilisez la tablette', 'no DoorDash line id — use the tablet')}</div>}</div>
            <Chips size="sm" value={qty[i] ?? 0} onChange={(v) => setQty({ ...qty, [i]: v })} options={Array.from({ length: Math.round(l.quantity) + 1 }, (_, n) => ({ value: n, label: n === 0 ? t('aucun', 'none') : `−${n}` }))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

const PRICE_REASONS: Array<[string, string, string]> = [
  ['REQUESTED_ADD_ONS', 'Extra demandé par le client', 'Add-on the customer asked for'], ['BIGGER_SIZE', 'Plus grand format', 'Bigger size'], ['NEW_ITEM_ADDED', 'Article ajouté', 'Item added'],
  ['ITEM_SOLD_OUT', 'Article en rupture', 'Item sold out'], ['REMOVED_ITEM', 'Article retiré', 'Item removed'], ['ADD_ON_UNAVAILABLE', 'Extra non disponible', 'Add-on unavailable'], ['OTHER', 'Autre', 'Other'],
];

/** Uber Eats price change (Adjust Order Price): the customer confirms it in the Uber Eats app. 50 $ at most, up or down. */
function PriceDialog({ onSend, onClose }: { onSend: (a: { amount: number; reason: string; customReason?: string }) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('REQUESTED_ADD_ONS');
  const [custom, setCustom] = useState('');
  const n = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(n) && n !== 0 && Math.abs(n) <= 50 && (reason !== 'OTHER' || custom.trim().length > 0);
  return (
    <Modal title={t('Changer le prix — Uber Eats', 'Change the price — Uber Eats')} subtitle={t('Montant négatif pour baisser le prix. Le client confirme dans l’app Uber Eats (50 $ au plus).', 'Negative amount to lower the price. The customer confirms in the Uber Eats app (50 $ at most).')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Retour', 'Back')}</Button><Button variant="primary" disabled={!valid} onClick={() => onSend({ amount: n, reason, ...(reason === 'OTHER' ? { customReason: custom.trim() } : {}) })}>{t('Envoyer au client', 'Send to the customer')}</Button></>}>
      <div className="grid gap-3">
        <Field label={t('Montant ($)', 'Amount ($)')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2.50" /></Field>
        <Field label={t('Raison', 'Reason')}><Select value={reason} onChange={(e) => setReason(e.target.value)}>{PRICE_REASONS.map(([v, fr, en]) => <option key={v} value={v}>{lang === 'fr' ? fr : en}</option>)}</Select></Field>
        {reason === 'OTHER' && <Field label={t('Expliquez', 'Explain')}><Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={200} /></Field>}
      </div>
    </Modal>
  );
}

function TextCustomer({ order, onClose }: { order: FullOrder; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [info, setInfo] = useState<{ contact: { canSms: boolean; tel: string | null; masked: string | null }; templates: { late: { fr: string; en: string } } } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<NonNullable<typeof info>>(`/api/foodhub/orders/${order.id}/contact`).then((d) => { setInfo(d); setText(lang === 'fr' ? d.templates.late.fr : d.templates.late.en); }).catch((e) => setErr(e.message));
  }, [order.id, lang]);
  async function send() {
    setBusy(true); setErr('');
    try { await api(`/api/foodhub/orders/${order.id}/contact`, { method: 'POST', json: { text } }); toast.success(t('Texto envoyé', 'Text sent')); onClose(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={t('Contacter le client', 'Contact the customer')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Fermer', 'Close')}</Button>{info?.contact.canSms && <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={send} icon={<Send className="size-4" />}>{t('Envoyer le texto', 'Send text')}</Button>}</>}>
      {!info && !err && <div className="h-24 animate-pulse rounded-md bg-sunken" />}
      {err && <Banner tone="stop">{err}</Banner>}
      {info && (
        <div className="space-y-3">
          {info.contact.tel ? <a href={info.contact.tel} className={buttonClass('outline', 'lg', 'w-full')}><Phone className="size-5" />{t('Appeler', 'Call')} {info.contact.masked}</a>
            : <Banner tone="info">{t('La plateforme n’a pas partagé de numéro pour ce client. Passez par le soutien de la plateforme.', 'The platform did not share a number for this customer. Use the platform’s support.')}</Banner>}
          {info.contact.canSms ? (
            <>
              <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={320} />
              <p className="flex items-center gap-1.5 text-xs text-ink-3"><TriangleAlert className="size-3.5" />{t('Messages de service seulement (retard, question). Jamais de publicité.', 'Service messages only (delay, question). Never marketing.')}</p>
            </>
          ) : info.contact.tel ? <p className="text-[13px] text-ink-3">{t('Ce numéro relais accepte les appels seulement (code d’accès inclus).', 'This relay number takes calls only (access code included).')}</p> : null}
        </div>
      )}
    </Modal>
  );
}

export function OrderPageLink({ id, children }: { id: string; children: ReactNode }) {
  return <Link href={`/orders?open=${id}`} className="font-semibold text-ink underline-offset-4 hover:underline">{children}</Link>;
}

