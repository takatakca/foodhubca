'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Bike, Check, ExternalLink, MapPin, Pencil, Phone, Printer, RefreshCw, Store, TriangleAlert, Truck, Wine, X } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Banner } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Drawer, Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { Delivery, DirectOrder } from '@/lib/foodhub/delivery/types';
import { api, ApiError, money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { DELIVERY_TONE, DIRECT_TONE, FLEET_NAME, PAYMENT_TONE, deliveryStatusLabel, directStatusLabel, eventLabel, paymentLabel, sourceLabel } from './labels';

export type DirectRow = DirectOrder & { delivery: Delivery | null };
type Detail = { order: DirectOrder; deliveries: Delivery[]; problems: string[]; running: Delivery | null };

export function DirectOrderDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState<'order' | 'courier' | null>(null);

  const load = useCallback(() => api<Detail>(`/api/foodhub/delivery/${id}`).then(setD).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [id, toast]);
  useEffect(() => { load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}, okText?: string) {
    setBusy(action);
    try {
      const r = await api<Detail & { message: string }>(`/api/foodhub/delivery/${id}`, { method: 'POST', json: { action, ...extra } });
      setD(r);
      toast.success(okText ?? r.message);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 499) return;
      const problems = e instanceof ApiError && Array.isArray(e.body.problems) ? (e.body.problems as string[]) : [];
      toast.error(e instanceof Error ? e.message : String(e), problems.slice(1).join(' · ') || undefined);
      load();
    } finally { setBusy(null); }
  }

  const o = d?.order;
  const closed = o ? ['completed', 'cancelled'].includes(o.status) : true;
  const running = d?.running ?? null;
  const last = d?.deliveries.at(-1) ?? null;
  const act_ = can('orders:act');

  return (
    <Drawer width="lg" onClose={onClose}
      title={o ? <span className="flex flex-wrap items-center gap-2"><span className="num">{o.number}</span><Badge tone={DIRECT_TONE[o.status] ?? 'neutral'}>{directStatusLabel(t, o.status)}</Badge></span> : t('Commande', 'Order')}
      subtitle={o ? `${o.brandName} · ${locName(o.locationCode)} · ${sourceLabel(t, o.source)} · ${timeOf(o.placedAt, loc, true)}` : undefined}
      footer={o && act_ && !closed ? (
        <div className="flex w-full flex-wrap items-center gap-2">
          {o.payment !== 'paid' && <Button variant="soft" icon={<Banknote className="size-4" />} loading={busy === 'mark_paid'} onClick={() => act('mark_paid', {}, t('Paiement noté', 'Payment noted'))}>{t('Paiement encaissé', 'Payment taken')}</Button>}
          {o.fulfillment === 'pickup' && <Button variant="go" icon={<Store className="size-4" />} loading={busy === 'picked_up'} onClick={() => act('picked_up')}>{t('Récupérée par le client', 'Picked up by customer')}</Button>}
          {o.status !== 'ready' && o.status !== 'out_for_delivery' && <Button variant="outline" icon={<Check className="size-4" />} loading={busy === 'ready'} onClick={() => act('ready')}>{t('Prête', 'Ready')}</Button>}
          <Button variant="ghost" className="ml-auto text-stop" icon={<X className="size-4" />} onClick={() => setCancelling('order')}>{t('Annuler la commande', 'Cancel order')}</Button>
        </div>
      ) : undefined}>
      {!o && <div className="space-y-3"><div className="h-24 animate-pulse rounded-md bg-sunken" /><div className="h-40 animate-pulse rounded-md bg-sunken" /></div>}
      {o && (
        <div className="space-y-5">
          {o.attention && !closed && (
            <Banner tone="warn" action={act_ ? <Button size="xs" variant="ghost" loading={busy === 'clear_attention'} onClick={() => act('clear_attention', {}, t('Marquée vérifiée', 'Marked as checked'))}>{t('C’est réglé', 'Done')}</Button> : undefined}>{o.attention}</Banner>
          )}
          {o.posError && !closed && <Banner tone="stop" action={act_ ? <Button size="xs" loading={busy === 'retry_clover'} icon={<Printer className="size-3.5" />} onClick={() => act('retry_clover')}>{t('Renvoyer à Clover', 'Send to Clover')}</Button> : undefined}>{t('Clover n’a pas reçu la commande : ', 'Clover did not receive the order: ')}{o.posError}</Banner>}

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-line p-3">
              <div className="mb-1 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Client', 'Customer')}</div>
              <div className="font-bold">{o.customer.name || '—'}</div>
              {o.customer.phone ? <a href={`tel:${o.customer.phone}`} className="mt-0.5 flex items-center gap-1.5 text-sm text-info-2 hover:underline"><Phone className="size-3.5" />{o.customer.phone}</a> : <div className="text-sm text-wait-2">{t('Pas de téléphone', 'No phone')}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={PAYMENT_TONE[o.payment] ?? 'neutral'}>{paymentLabel(t, o.payment)}</Badge>{o.containsAlcohol && <Badge tone="violet" icon={<Wine className="size-3" />}>{t('Alcool — ID 18+', 'Alcohol — ID 18+')}</Badge>}</div>
            </div>
            <div className="rounded-md border border-line p-3">
              <div className="mb-1 flex items-center justify-between text-xs font-bold tracking-wide text-ink-3 uppercase">
                {o.fulfillment === 'delivery' ? t('Livraison', 'Delivery') : t('Pour emporter', 'Pickup')}
                {o.fulfillment === 'delivery' && act_ && !closed && !running && <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-ink-2 normal-case hover:bg-sunken"><Pencil className="size-3" />{t('Modifier', 'Edit')}</button>}
              </div>
              {o.fulfillment === 'delivery' ? (o.dropoff
                ? <div className="flex gap-1.5 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" /><div>{o.dropoff.street}{o.dropoff.unit ? `, #${o.dropoff.unit}` : ''}<br />{o.dropoff.city} {o.dropoff.postalCode}{o.dropoff.instructions ? <div className="mt-1 text-xs text-ink-3">{o.dropoff.instructions}</div> : null}</div></div>
                : <div className="text-sm text-wait-2">{t('Adresse manquante', 'Address missing')}</div>)
                : <div className="text-sm">{o.readyAt ? `${t('Prête vers', 'Ready at')} ${timeOf(o.readyAt, loc)}` : '—'}</div>}
              {o.wantedAt && <div className="mt-1 text-xs font-semibold text-info-2">{t('Demandée pour', 'Wanted at')} {timeOf(o.wantedAt, loc)}</div>}
            </div>
          </section>

          {o.fulfillment === 'delivery' && (
            <section className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2 font-bold"><Truck className="size-4 text-brand" />{t('Livreur', 'Courier')}</div>
                {running && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={busy === 'refresh'} onClick={() => act('refresh', {}, t('À jour', 'Up to date'))}>{t('Actualiser', 'Refresh')}</Button>}
              </div>
              <div className="space-y-3 px-4 py-3">
                {last ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusDot tone={DELIVERY_TONE[last.status] ?? 'neutral'} pulse={Boolean(running)} />
                      <span className="font-semibold">{deliveryStatusLabel(t, last.status)}</span>
                      <Badge tone="neutral">{FLEET_NAME[last.fleet]}</Badge>
                      {last.environment === 'sandbox' && <Badge tone="info">{t('bac à sable', 'sandbox')}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
                      <Info label={t('Coût livreur', 'Courier cost')} value={last.fee !== undefined ? money(last.fee, loc) : '—'} />
                      <Info label={t('Pourboire', 'Tip')} value={money(last.tip, loc)} />
                      <Info label={t('Au comptoir', 'At the counter')} value={last.pickupEta ? timeOf(last.pickupEta, loc) : '—'} />
                      <Info label={t('Chez le client', 'At the customer')} value={last.dropoffEta ? timeOf(last.dropoffEta, loc) : '—'} />
                    </div>
                    {last.courier?.name && <div className="flex flex-wrap items-center gap-2 text-sm"><Bike className="size-4 text-ink-3" /><span className="font-semibold">{last.courier.name}</span>{last.courier.vehicle && <span className="text-ink-3">· {last.courier.vehicle}</span>}{last.courier.phone && <a href={`tel:${last.courier.phone}`} className="text-info-2 hover:underline">· {last.courier.phone}</a>}</div>}
                    <div className="flex flex-wrap gap-3 text-xs">
                      {last.trackingUrl && <a href={last.trackingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-info-2 hover:underline"><ExternalLink className="size-3.5" />{t('Suivi en direct', 'Live tracking')}</a>}
                      {last.supportReference && <span className="text-ink-3">{t('Réf. soutien', 'Support ref.')} {last.supportReference}</span>}
                      {last.trackingSmsAt && <span className="text-go-2">{t('Lien texté au client', 'Link texted to the customer')}</span>}
                    </div>
                    {last.comparedQuotes && last.comparedQuotes.length > 1 && (
                      <div className="text-xs text-ink-3">{t('Prix comparés :', 'Quotes compared:')} {last.comparedQuotes.map((q) => `${FLEET_NAME[q.fleet]} ${q.ok && q.fee !== undefined ? money(q.fee, loc) : t('indisponible', 'n/a')}`).join(' · ')}</div>
                    )}
                  </div>
                ) : <div className="text-sm text-ink-3">{t('Aucun livreur demandé pour l’instant.', 'No courier requested yet.')}</div>}
                {!closed && !running && d!.problems.length > 0 && (
                  <div className="rounded-md bg-wait-soft px-3 py-2 text-[13px] text-wait-2"><div className="mb-1 flex items-center gap-1.5 font-bold"><TriangleAlert className="size-4" />{t('Avant d’appeler un livreur', 'Before calling a courier')}</div><ul className="list-disc space-y-0.5 pl-5">{d!.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
                )}
                {act_ && !closed && (
                  <div className="flex flex-wrap gap-2">
                    {!running && <Button icon={<Truck className="size-4" />} loading={busy === 'dispatch'} disabled={d!.problems.length > 0} onClick={() => act('dispatch')}>{t('Appeler un livreur', 'Call a courier')}</Button>}
                    {running && <Button variant="outline" className="text-stop" icon={<X className="size-4" />} onClick={() => setCancelling('courier')}>{t('Annuler le livreur', 'Cancel the courier')}</Button>}
                  </div>
                )}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Articles', 'Items')}</div>
            <div className="divide-y divide-line rounded-md border border-line">
              {o.lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0"><span className="font-bold">{l.quantity} ×</span> {l.name}{l.alcohol && <Wine className="ml-1 inline size-3.5 text-violet" />}
                    {l.modifiers.length > 0 && <div className="text-xs text-ink-3">{l.modifiers.map((m) => m.name).join(', ')}</div>}
                    {l.notes && <div className="text-xs font-semibold text-wait-2">{l.notes}</div>}
                  </div>
                  <span className="num shrink-0">{money(l.total, loc)}</span>
                </div>
              ))}
              <div className="space-y-0.5 bg-raised px-3 py-2 text-[13px]">
                <Row label={t('Sous-total', 'Subtotal')} value={money(o.subtotal, loc)} />
                {o.deliveryFee > 0 && <Row label={t('Livraison', 'Delivery')} value={money(o.deliveryFee, loc)} />}
                <Row label={t('Taxes', 'Taxes')} value={money(o.tax, loc)} />
                {o.tip > 0 && <Row label={t('Pourboire livreur', 'Courier tip')} value={money(o.tip, loc)} />}
                <Row label={<strong>Total</strong>} value={<strong>{money(o.total, loc)}</strong>} />
              </div>
            </div>
            {o.notes && <p className="mt-2 text-xs text-ink-3">{o.notes}</p>}
            {o.posOrderId && <p className="mt-1 text-xs text-ink-4">Clover {o.posOrderId}</p>}
          </section>

          <section>
            <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Historique', 'Timeline')}</div>
            <ol className="relative space-y-2 border-l border-line pl-4">
              {[...o.events].reverse().map((e, i) => (
                <li key={i} className="text-[13px]">
                  <span className={cn('absolute -left-[5px] mt-1.5 size-2.5 rounded-full', /fail|refus|cancel/.test(e.type) ? 'bg-stop' : /delivered|paid|completed|booked/.test(e.type) ? 'bg-go' : 'bg-line-2')} />
                  <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{eventLabel(t, e.type)}</span><span className="text-xs text-ink-4">{timeOf(e.at, loc)}{e.by ? ` · ${e.by}` : ''}</span></div>
                  <div className="text-xs text-ink-3">{e.message}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      {editing && o && <EditAddress order={o} onClose={() => setEditing(false)} onSave={async (dropoff, customer) => { setEditing(false); await act('update', { dropoff, customer }, t('Commande mise à jour', 'Order updated')); }} />}
      {cancelling && o && (
        <Modal size="sm" title={cancelling === 'order' ? t(`Annuler ${o.number} ?`, `Cancel ${o.number}?`) : t('Annuler le livreur ?', 'Cancel the courier?')} onClose={() => setCancelling(null)}
          footer={<><Button variant="ghost" onClick={() => setCancelling(null)}>{t('Garder', 'Keep')}</Button><Button variant="danger" loading={busy === 'cancel' || busy === 'cancel_courier'} onClick={async () => { const what = cancelling; setCancelling(null); await act(what === 'order' ? 'cancel' : 'cancel_courier', { reason: what === 'order' ? 'Cancelled from Food Hub' : 'Cancelled from Food Hub' }); }}>{t('Annuler', 'Cancel')}</Button></>}>
          <p className="text-sm text-ink-2">{cancelling === 'order'
            ? t('Le livreur réservé est annulé aussi. Si le client a déjà payé, remboursez-le dans Clover — Food Hub ne rembourse jamais tout seul.', 'A booked courier is cancelled too. If the customer already paid, refund them in Clover — Food Hub never refunds by itself.')
            : t('Le service de livraison peut facturer des frais si le livreur est déjà en route.', 'The courier service may charge a fee once the courier is on the way.')}</p>
        </Modal>
      )}
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-sunken px-2.5 py-1.5"><div className="text-[11px] text-ink-3">{label}</div><div className="num font-semibold">{value}</div></div>;
}
function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-ink-3">{label}</span><span className="num">{value}</span></div>;
}

function EditAddress({ order, onClose, onSave }: { order: DirectOrder; onClose: () => void; onSave: (dropoff: Record<string, string>, customer: Record<string, string>) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ street: order.dropoff?.street ?? '', unit: order.dropoff?.unit ?? '', city: order.dropoff?.city ?? 'Montréal', postalCode: order.dropoff?.postalCode ?? '', instructions: order.dropoff?.instructions ?? '', name: order.customer.name ?? '', phone: order.customer.phone ?? '' });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <Modal title={t('Adresse et client', 'Address and customer')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button disabled={!f.street || !f.postalCode} onClick={() => onSave({ street: f.street, unit: f.unit, city: f.city, postalCode: f.postalCode, instructions: f.instructions }, { name: f.name, phone: f.phone })}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3"><Field label={t('Nom', 'Name')}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field><Field label={t('Téléphone', 'Phone')}><Input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field></div>
        <div className="grid grid-cols-[1fr_110px] gap-3"><Field label={t('Adresse', 'Street address')}><Input value={f.street} onChange={(e) => set({ street: e.target.value })} placeholder="5555 av. Monkland" /></Field><Field label={t('App.', 'Unit')}><Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field></div>
        <div className="grid grid-cols-[1fr_140px] gap-3"><Field label={t('Ville', 'City')}><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field><Field label={t('Code postal', 'Postal code')}><Input value={f.postalCode} onChange={(e) => set({ postalCode: e.target.value.toUpperCase() })} placeholder="H4A 1E1" /></Field></div>
        <Field label={t('Instructions (code de porte, étage…)', 'Instructions (door code, floor…)')}><Input value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
