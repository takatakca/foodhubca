'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, RefreshCw, Store, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

// Stores → Uber Eats: what Uber has for each mapped store (Store API), courier pickup instructions, promotions created
// by API, orders on/off for one store, and the Uber Direct account (organization, its stores, live deliveries).

type StoreRow = { id: string; brandName: string; locationCode: string; channelStoreId: string; orderManager: string | null };
type Info = {
  name?: string; pickupInstructions?: string; prepTimeMinutes?: number | null; status?: string; offlineReason?: string; isOrderable?: boolean | null; nextOpen?: string; nextClose?: string;
  priceAdjustment?: { enabled: boolean; maxDollars: number | null } | null;
};
type Promo = { promotion_id?: string; state?: string; promo_type?: string; start_time?: string; end_time?: string; flat_off_discount?: { discount_value?: { amount?: number } } };
type Detail = { live: boolean; info: { ok: boolean; info?: Info; error?: string }; holidays: { ok: boolean; dates: string[] }; menu: { ok: boolean; items?: number; categories?: number; soldOut?: string[]; error?: string }; promotions: { ok: boolean; promotions: Promo[]; error?: string } };
type Direct = { ok: boolean; organization?: { info?: { name?: string; merchant_type?: string }; billing_info?: { billing_status?: string } }; error?: string; readiness?: { environment: string; canSend: boolean } };
type Loc = { id: string; name: string; externalId?: string; address?: string };

const localInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function UberStoresPage() {
  const { t, lang } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [base, setBase] = useState<{ configured: boolean; live: boolean; note: string; noteFr: string; stores: StoreRow[] } | null>(null);
  const [storeId, setStoreId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickup, setPickup] = useState('');
  const [promo, setPromo] = useState(() => ({ discount: '3', minSpend: '20', start: localInput(Date.now() + 3600_000), end: localInput(Date.now() + 7 * 86400_000), firstTimeOnly: false }));
  const [direct, setDirect] = useState<{ org: Direct; locations: Loc[]; error?: string } | null>(null);

  useEffect(() => {
    api<{ configured: boolean; live: boolean; note: string; noteFr: string; stores: StoreRow[] }>('/api/foodhub/uber-tools')
      .then((d) => { setBase(d); if (d.stores[0]) setStoreId(d.stores[0].id); })
      .catch((e) => toast.error(t('Lecture impossible', 'Could not load'), e instanceof Error ? e.message : String(e)));
  }, [t, toast]);

  const read = useCallback(async () => {
    if (!storeId) return;
    setBusy('read');
    try {
      const d = await api<Detail>(`/api/foodhub/uber-tools?storeId=${encodeURIComponent(storeId)}`);
      setDetail(d);
      setPickup(d.info.info?.pickupInstructions ?? '');
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Uber n’a pas répondu', 'Uber did not answer'), e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }, [storeId, t, toast]);

  async function post(action: string, extra: Record<string, unknown>, done: string) {
    setBusy(action);
    try {
      await api('/api/foodhub/uber-tools', { method: 'POST', json: { storeId, action, ...extra } });
      toast.success(done);
      await read();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Uber a refusé', 'Uber refused'), e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function readDirect() {
    setBusy('direct');
    try {
      const org = await api<Direct>('/api/foodhub/uber-direct?view=org');
      const locs = await api<{ ok: boolean; locations: Loc[]; error?: string }>('/api/foodhub/uber-direct?view=locations').catch((e) => ({ ok: false, locations: [], error: e instanceof Error ? e.message : String(e) }));
      setDirect({ org, locations: locs.locations ?? [], error: locs.error });
    } catch (e) { setDirect({ org: { ok: false, error: e instanceof Error ? e.message : String(e) }, locations: [] }); }
    finally { setBusy(null); }
  }

  const store = base?.stores.find((s) => s.id === storeId);
  const info = detail?.info.info;
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <div>
      <PageHeader title={t('Magasins', 'Stores')} subtitle={t('Uber Eats : ce qu’Uber affiche pour chaque magasin, instructions au livreur, promotions, et le compte Uber Direct.', 'Uber Eats: what Uber shows for each store, courier instructions, promotions, and the Uber Direct account.')} />
      <StoresTabs />
      {!base && <div className="h-64 animate-pulse rounded-lg bg-sunken" />}
      {base && !base.configured && <Banner tone="warn" className="mb-4">{lang === 'fr' ? base.noteFr : base.note}</Banner>}
      {base && base.configured && !base.live && <Banner tone="info" className="mb-4">{t('Lecture seulement : les changements chez Uber demandent l’interrupteur « live » (LIVE_CONNECTORS_GLOBAL_ENABLED).', 'Read-only: changes on Uber need the live switch (LIVE_CONNECTORS_GLOBAL_ENABLED).')}</Banner>}

      {base && base.stores.length === 0 && <Banner tone="info">{t('Aucun magasin Uber Eats branché : Magasins → Branchement des magasins → « Brancher Uber Eats ».', 'No Uber Eats store connected yet: Stores → Store connections → “Connect Uber Eats”.')}</Banner>}

      {base && base.stores.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader icon={<Store className="size-5" />} title={t('Magasin Uber Eats', 'Uber Eats store')}
              right={<Button size="sm" variant="soft" loading={busy === 'read'} onClick={read} icon={<RefreshCw className="size-4" />}>{t('Lire chez Uber', 'Read from Uber')}</Button>} />
            <div className="space-y-3 px-5 pb-5">
              <Select value={storeId} onChange={(e) => { setStoreId(e.target.value); setDetail(null); }}>
                {base.stores.map((s) => <option key={s.id} value={s.id}>{s.brandName} · {s.locationCode}{s.orderManager === 'foodhub' ? '' : ` (${t('commandes ailleurs', 'orders elsewhere')})`}</option>)}
              </Select>
              {detail && !detail.info.ok && <Banner tone="warn">{detail.info.error}</Banner>}
              {info && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-ink-3">{t('Statut', 'Status')}</dt><dd><Badge tone={info.status === 'ONLINE' ? 'go' : 'wait'}>{info.status ?? '—'}</Badge>{info.offlineReason ? ` ${info.offlineReason}` : ''}</dd>
                  <dt className="text-ink-3">{t('Commandable', 'Orderable')}</dt><dd>{info.isOrderable === null || info.isOrderable === undefined ? '—' : info.isOrderable ? t('oui', 'yes') : t('non', 'no')}</dd>
                  <dt className="text-ink-3">{t('Temps de préparation chez Uber', 'Prep time on Uber')}</dt><dd>{info.prepTimeMinutes ? `${info.prepTimeMinutes} min` : '—'}</dd>
                  <dt className="text-ink-3">{t('Prochaine ouverture / fermeture', 'Next open / close')}</dt><dd>{info.nextOpen || '—'} / {info.nextClose || '—'}</dd>
                  <dt className="text-ink-3">{t('Changement de prix permis', 'Price change allowed')}</dt><dd>{info.priceAdjustment ? (info.priceAdjustment.enabled ? `${t('oui', 'yes')}${info.priceAdjustment.maxDollars ? `, ≤ ${info.priceAdjustment.maxDollars} $` : ''}` : t('non', 'no')) : '—'}</dd>
                  <dt className="text-ink-3">{t('Menu chez Uber', 'Menu on Uber')}</dt><dd>{detail?.menu.ok ? `${detail.menu.items} ${t('articles', 'items')}, ${detail.menu.soldOut?.length ?? 0} ${t('en rupture', 'sold out')}` : detail?.menu.error ?? '—'}</dd>
                  <dt className="text-ink-3">{t('Jours fériés chez Uber', 'Holidays on Uber')}</dt><dd>{detail?.holidays.dates.length ? detail.holidays.dates.join(', ') : '—'}</dd>
                </dl>
              )}
              {detail && (
                <div className="space-y-2 border-t border-line pt-3">
                  <Field label={t('Instructions au livreur (cueillette)', 'Pickup instructions for the courier')}><Input value={pickup} maxLength={500} onChange={(e) => setPickup(e.target.value)} /></Field>
                  <Button size="sm" variant="primary" disabled={!detail.live || !pickup.trim()} loading={busy === 'pickup'} onClick={() => post('pickup', { text: pickup }, t('Instructions envoyées à Uber', 'Instructions sent to Uber'))}>{t('Envoyer à Uber', 'Send to Uber')}</Button>
                </div>
              )}
              {detail && can('stores:map') && store && (
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="soft" disabled={!detail.live} loading={busy === 'integration'} onClick={() => post('integration', { enabled: true }, t('Commandes Uber activées', 'Uber orders on'))}>{t('Commandes vers Food Hub : activer', 'Orders to Food Hub: on')}</Button>
                  <Button size="sm" variant="soft" className="text-stop" disabled={!detail.live} loading={busy === 'integration'} onClick={() => { if (window.confirm(t('Uber n’enverra plus les commandes de ce magasin à Food Hub. Continuer ?', 'Uber will stop sending this store’s orders to Food Hub. Continue?'))) void post('integration', { enabled: false }, t('Commandes Uber arrêtées', 'Uber orders off')); }}>{t('Arrêter', 'Turn off')}</Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<BadgePercent className="size-5" />} title={t('Promotions Uber Eats', 'Uber Eats promotions')} subtitle={t('« X $ de rabais dès Y $ ». Seules les promotions créées par Food Hub sont listées (règle d’Uber).', '"X $ off from Y $". Only promotions created by Food Hub are listed (Uber’s rule).')} />
            <div className="space-y-3 px-5 pb-5">
              {!detail && <p className="text-sm text-ink-3">{t('Lisez d’abord le magasin chez Uber.', 'Read the store from Uber first.')}</p>}
              {detail && !detail.promotions.ok && <Banner tone="warn">{detail.promotions.error}</Banner>}
              {detail?.promotions.promotions.map((p) => (
                <div key={p.promotion_id} className="flex items-center justify-between gap-2 rounded-md border border-line p-2 text-sm">
                  <span><Badge tone={p.state === 'ACTIVE' ? 'go' : 'neutral'}>{p.state ?? '—'}</Badge> {p.promo_type} {p.flat_off_discount?.discount_value?.amount ? `${(p.flat_off_discount.discount_value.amount / 100).toFixed(2)} $` : ''} · {fmt(p.start_time)} → {fmt(p.end_time)}</span>
                  {p.promotion_id && p.state !== 'REVOKED' && <Button size="sm" variant="ghost" className="text-stop" disabled={!detail.live} loading={busy === 'promo_revoke'} onClick={() => post('promo_revoke', { promotionId: p.promotion_id }, t('Promotion retirée', 'Promotion revoked'))}>{t('Retirer', 'Revoke')}</Button>}
                </div>
              ))}
              {detail && (
                <fieldset disabled={!detail.live} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                  <Field label={t('Rabais ($)', 'Discount ($)')}><Input inputMode="decimal" value={promo.discount} onChange={(e) => setPromo({ ...promo, discount: e.target.value })} /></Field>
                  <Field label={t('Commande minimum ($)', 'Minimum order ($)')}><Input inputMode="decimal" value={promo.minSpend} onChange={(e) => setPromo({ ...promo, minSpend: e.target.value })} /></Field>
                  <Field label={t('Début', 'Start')}><Input type="datetime-local" value={promo.start} onChange={(e) => setPromo({ ...promo, start: e.target.value })} /></Field>
                  <Field label={t('Fin', 'End')}><Input type="datetime-local" value={promo.end} onChange={(e) => setPromo({ ...promo, end: e.target.value })} /></Field>
                  <Switch checked={promo.firstTimeOnly} onChange={(v) => setPromo({ ...promo, firstTimeOnly: v })} label={t('Nouveaux clients seulement', 'New customers only')} />
                  <div className="sm:col-span-2"><Button variant="primary" loading={busy === 'promo_create'} onClick={() => post('promo_create', { discount: Number(promo.discount), minSpend: promo.minSpend === '' ? undefined : Number(promo.minSpend), start: new Date(promo.start).toISOString(), end: new Date(promo.end).toISOString(), firstTimeOnly: promo.firstTimeOnly }, t('Promotion créée sur Uber Eats', 'Promotion created on Uber Eats'))}>{t('Créer la promotion', 'Create the promotion')}</Button></div>
                </fieldset>
              )}
            </div>
          </Card>
        </div>
      )}

      {can('stores:map') && (
        <Card className="mt-4">
          <CardHeader icon={<Truck className="size-5" />} title={t('Compte Uber Direct', 'Uber Direct account')} subtitle={t('Organisation, magasins Uber Direct et leur code de cuisine (external id). Les livraisons se règlent dans Réglages → Livraison.', 'Organization, Uber Direct stores and their kitchen code (external id). Deliveries are set in Settings → Delivery.')}
            right={<Button size="sm" variant="soft" loading={busy === 'direct'} onClick={readDirect} icon={<RefreshCw className="size-4" />}>{t('Lire chez Uber', 'Read from Uber')}</Button>} />
          <div className="space-y-2 px-5 pb-5 text-sm">
            {!direct && <p className="text-ink-3">{t('Pas encore lu.', 'Not read yet.')}</p>}
            {direct && !direct.org.ok && <Banner tone="warn">{direct.org.error}</Banner>}
            {direct?.org.ok && <p><strong>{direct.org.organization?.info?.name ?? '—'}</strong> · {direct.org.organization?.billing_info?.billing_status ?? '—'} · {direct.org.readiness?.environment}</p>}
            {direct?.error && <Banner tone="warn">{direct.error}</Banner>}
            {direct?.locations.map((l) => <div key={l.id} className="flex justify-between gap-2 rounded-md border border-line p-2"><span>{l.name}{l.address ? ` — ${l.address}` : ''}</span><Badge tone={l.externalId ? 'go' : 'wait'}>{l.externalId || t('pas de code', 'no code')}</Badge></div>)}
          </div>
        </Card>
      )}
    </div>
  );
}
