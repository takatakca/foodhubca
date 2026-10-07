'use client';

import { useState } from 'react';
import { Plus, Store, Trash2, Truck } from 'lucide-react';
import { Banner } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Item = { name: string; quantity: string; price: string; alcohol: boolean };
const QC_TAX = 0.14975;

/** An order taken by a person (counter, phone): Clover ticket + courier rules, like every direct order. */
export function NewDirectOrder({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t, loc } = useI18n();
  const { locations, brands } = useViewer();
  const toast = useToast();
  const [f, setF] = useState({
    locationCode: locations[0]?.code ?? '', brandName: brands[0] ?? '', name: '', phone: '', fulfillment: 'delivery' as 'pickup' | 'delivery',
    street: '', unit: '', city: 'Montréal', postalCode: '', instructions: '', tip: '3', paid: false, sms: true, notes: '',
  });
  const [items, setItems] = useState<Item[]>([{ name: '', quantity: '1', price: '', alcohol: false }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const setItem = (i: number, p: Partial<Item>) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price.replace(',', '.')) || 0), 0);
  const delivery = f.fulfillment === 'delivery';

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ order: { id: string; number: string }; problems: string[] }>('/api/foodhub/delivery', {
        method: 'POST',
        json: {
          source: 'phone', locationCode: f.locationCode, brandName: f.brandName, customer: { name: f.name, phone: f.phone }, fulfillment: f.fulfillment,
          dropoff: delivery ? { street: f.street, unit: f.unit, city: f.city, postalCode: f.postalCode, instructions: f.instructions } : undefined,
          items: items.map((i) => ({ name: i.name, quantity: Number(i.quantity) || 1, price: Number(i.price.replace(',', '.')) || 0, alcohol: i.alcohol })),
          tip: delivery ? Number(f.tip.replace(',', '.')) || 0 : 0, payment: f.paid ? 'paid' : undefined, confirmBySms: f.sms, notes: f.notes,
        },
      });
      toast.success(t(`Commande ${r.order.number} créée`, `Order ${r.order.number} created`), r.problems[0]);
      onCreated(r.order.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const ready = f.locationCode && f.brandName && items.some((i) => i.name.trim() && Number(i.price.replace(',', '.')) >= 0) && (!delivery || (f.street && f.postalCode && f.phone));
  return (
    <Modal size="lg" title={t('Nouvelle commande', 'New order')} subtitle={t('Prise au comptoir ou au téléphone : envoyée à Clover, avec un livreur si c’est une livraison.', 'Taken at the counter or on the phone: sent to Clover, with a courier for a delivery.')} onClose={onClose}
      footer={<><span className="mr-auto num text-sm text-ink-3">{t('Total estimé', 'Estimated total')} <strong className="text-ink">{money(subtotal * (1 + QC_TAX) + (delivery ? Number(f.tip.replace(',', '.')) || 0 : 0), loc)}</strong></span><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!ready} onClick={save}>{t('Créer la commande', 'Create order')}</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Cuisine', 'Kitchen')}><Select value={f.locationCode} onChange={(e) => set({ locationCode: e.target.value })}>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</Select></Field>
          <Field label={t('Marque', 'Brand')}><Select value={f.brandName} onChange={(e) => set({ brandName: e.target.value })}>{brands.map((b) => <option key={b} value={b}>{b}</option>)}</Select></Field>
        </div>
        <Segmented<'pickup' | 'delivery'> value={f.fulfillment} onChange={(v) => set({ fulfillment: v })} options={[{ key: 'delivery', label: <span className="flex items-center gap-1.5"><Truck className="size-4" />{t('Livraison', 'Delivery')}</span> }, { key: 'pickup', label: <span className="flex items-center gap-1.5"><Store className="size-4" />{t('Pour emporter', 'Pickup')}</span> }]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom du client', 'Customer name')}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t('Cellulaire', 'Mobile')} hint={delivery ? t('Obligatoire : le livreur l’appelle.', 'Required: the courier calls it.') : undefined}><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="514 555-0123" /></Field>
        </div>
        {delivery && (
          <div className="grid gap-3 rounded-md border border-line p-3">
            <div className="grid grid-cols-[1fr_100px] gap-3"><Field label={t('Adresse', 'Street address')}><Input value={f.street} onChange={(e) => set({ street: e.target.value })} placeholder="5555 av. Monkland" /></Field><Field label={t('App.', 'Unit')}><Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field></div>
            <div className="grid grid-cols-[1fr_130px] gap-3"><Field label={t('Ville', 'City')}><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field><Field label={t('Code postal', 'Postal code')}><Input value={f.postalCode} onChange={(e) => set({ postalCode: e.target.value.toUpperCase() })} placeholder="H4A 1E1" /></Field></div>
            <div className="grid grid-cols-[1fr_130px] gap-3"><Field label={t('Instructions pour le livreur', 'Courier instructions')}><Input value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder={t('Code 1234, 2e étage', 'Code 1234, 2nd floor')} /></Field><Field label={t('Pourboire ($)', 'Tip ($)')}><Input inputMode="decimal" value={f.tip} onChange={(e) => set({ tip: e.target.value })} /></Field></div>
          </div>
        )}
        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Articles', 'Items')}</div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_96px_auto_auto] items-center gap-2">
                <Input inputSize="sm" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder={t('Poulet entier, frites…', 'Whole chicken, fries…')} aria-label={t('Article', 'Item')} />
                <Input inputSize="sm" inputMode="numeric" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value.replace(/[^\d]/g, '') })} aria-label={t('Quantité', 'Quantity')} />
                <Input inputSize="sm" inputMode="decimal" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} placeholder="0,00" aria-label={t('Prix', 'Price')} />
                <Checkbox checked={it.alcohol} onChange={(v) => setItem(i, { alcohol: v })} label="18+" />
                <IconButton label={t('Retirer', 'Remove')} size="sm" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></IconButton>
              </div>
            ))}
          </div>
          <Button size="xs" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setItems((l) => [...l, { name: '', quantity: '1', price: '', alcohol: false }])}>{t('Ajouter un article', 'Add an item')}</Button>
        </div>
        <Field label={t('Note pour la cuisine', 'Kitchen note')}><Input value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox checked={f.paid} onChange={(v) => set({ paid: v })} label={t('Déjà payée (carte prise au comptoir)', 'Already paid (card taken at the counter)')} />
          <Checkbox checked={f.sms} onChange={(v) => set({ sms: v })} label={t('Texter la confirmation au client', 'Text the confirmation to the customer')} />
        </div>
        {delivery && !f.paid && <Banner tone="warn">{t('Les livreurs n’encaissent jamais : le livreur partira quand la commande sera marquée « Paiement encaissé ».', 'Couriers never collect money: the courier goes once the order is marked "Payment taken".')}</Banner>}
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}
