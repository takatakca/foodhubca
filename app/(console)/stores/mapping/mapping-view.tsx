'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link2, Lock, Pencil, Plus, Radar, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, PlatformMark, PlatformTag, platformOf } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { FormDraftNote } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { ExtraBrandPriceNotice, useExtraBrandPriceConfirm } from '@/components/billing/extra-brand-price';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { stateOf, stateText } from '../stores-view';
import { api, ApiError } from '@/lib/ui/api';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';
import { countEn, countFr } from '@/lib/ui/count-label';
import { uberPosForStore, uberRoutingConfirmed } from '@/lib/foodhub/adapters/uber-link';
import { uberCloverChoice } from '@/lib/foodhub/uber-clover-choice';
import type { ChannelStore } from '@/lib/foodhub/types';

type Form = { id?: string; channel: string; channelStoreId: string; brandName: string; locationCode: string; cloverMerchantId: string; destinationCloverLocation?: string; autoAccept: boolean; doNotTouch: boolean; platformStoreId?: string; menuLocked?: boolean; menuLockedReason?: string };
/** Whether Food Hub may change this store's menu (menu/lock.ts): built-in and environment locks cannot be lifted here. */
type MenuLock = { locked: boolean; source?: 'built_in' | 'env' | 'store'; reason?: string; reasonFr?: string };
type StoreRow = ChannelStore & { menuLock?: MenuLock };
/** The link form being shown: its draft id (one per store, per discovered Uber store, or 'new') and starting values. */
type OpenForm = { draftId: string; initial: Form; sourceLocation?: string; lock?: MenuLock };
type OrderManager = 'foodhub' | 'pending' | 'other' | 'unknown';
type Pick = { storeId: string; name: string; address?: string; brandName: string; locationCode: string; cloverMerchantId: string; cloverSuggested: boolean; orderManager?: OrderManager; include: boolean };
type CloverMerchant = { id: string; name: string | null; isDefault: boolean };
type UberResult = { ok: boolean; message: string; orderManager?: OrderManager | null; integrationEnabled?: boolean | null };
type UberActivation = UberResult & { mappingConflict?: boolean; disconnected?: boolean };
type Known = import('@/lib/foodhub/known-stores').KnownStore;

export function MappingView() {
  const { t } = useI18n();
  const { locations, brands, locName } = useViewer();
  const params = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const checkPrice = useExtraBrandPriceConfirm();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  /** Stores disconnected less than 6 s ago: hidden, and only removed on the server once "Undo" is no longer offered. */
  const [leaving, setLeaving] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const uberConnectionBusy = useRef(false);
  const [uberConnectionAction, setUberConnectionAction] = useState<'activate' | 'check' | 'enable' | `disconnect:${string}` | null>(null);
  const uberConnectionWorking = uberConnectionAction !== null;
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [connectId, setConnectId] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [results, setResults] = useState<Record<string, UberActivation>>({});
  const [cloverMerchants, setCloverMerchants] = useState<CloverMerchant[]>([]);
  const [checks, setChecks] = useState<Record<string, UberResult>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const [known, setKnown] = useState<Array<Known & { brandName: string; locationCode: string }>>([]);

  const load = useCallback(() => {
    api<{ stores: Known[] }>('/api/foodhub/stores/known').then((d) => setKnown(d.stores.map((k) => ({ ...k, brandName: k.suggestedBrand ?? '', locationCode: k.suggestedLocation ?? '' })))).catch(() => undefined);
    return api<{ stores: StoreRow[] }>('/api/foodhub/stores').then((d) => setStores(d.stores)).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const err = params.get('uber_error');
    if (err) toast.error('Uber Eats', err);
    const id = params.get('uber_connect');
    if (!id) return;
    setConnectId(id);
    setResults({});
    api<{ stores: Array<{ id: string; name: string; address?: string; suggestedBrand?: string; suggestedLocation?: string; suggestedClover?: string; requiresCloverChoice?: boolean; orderManager?: OrderManager }>; error: string | null; active: boolean; cloverMerchants?: CloverMerchant[] }>(`/api/foodhub/uber-connect/session?id=${id}`)
      .then((d) => {
        if (d.error) toast.error(d.error);
        setCloverMerchants(d.cloverMerchants ?? []);
        setPicks(d.stores.map((x) => ({ storeId: x.id, name: x.name, address: x.address, brandName: x.suggestedBrand || '', locationCode: x.suggestedLocation || '', cloverMerchantId: x.suggestedClover || '', cloverSuggested: Boolean(x.suggestedClover), orderManager: x.orderManager, include: Boolean(x.suggestedBrand && x.suggestedLocation && !x.requiresCloverChoice) })));
      })
      .catch((e) => toast.error(e.message));
  }, [params, toast]);

  const blank = (): Form => ({ channel: 'uber_eats', channelStoreId: '', brandName: brands[0] ?? '', locationCode: locations[0]?.code ?? '', cloverMerchantId: '', autoAccept: true, doNotTouch: false });

  /**
   * Disconnect without an "are you sure?": the row goes away at once with 6 s to take it back, and the store is only
   * removed on the server when that window closes (until then its orders keep flowing as before).
   */
  function remove(s: StoreRow) {
    const name = `${s.brandName} · ${platformOf(s.channel).label}`;
    const back = () => setLeaving((l) => l.filter((x) => x !== s.id));
    setLeaving((l) => [...l, s.id]);
    toast.undo(t(`${name} débranché`, `${name} disconnected`), back, {
      body: t('Ses commandes arriveront « non reliées » (ni acceptées seules, ni envoyées à la bonne caisse Clover) jusqu’à ce qu’il soit rebranché.', 'Its orders will arrive unlinked (not accepted by themselves, not sent to the right Clover register) until it is connected again.'),
      onCommit: () => {
        api(`/api/foodhub/stores?id=${s.id}`, { method: 'DELETE', keepalive: true })
          // Gone on the server: drop it here too, so a failed refresh never shows it connected again.
          .then(() => { setStores((all) => all && all.filter((x) => x.id !== s.id)); return load(); })
          .catch((e) => { if (!(e instanceof ApiError && e.status === 499)) toast.error(t(`${name} n’a pas été débranché`, `${name} was not disconnected`), e instanceof Error ? e.message : String(e)); })
          .finally(back);
      },
    });
  }
  async function discover() {
    setBusy('discover');
    try { const d = await api<{ stores: Array<{ id: string; name: string; address?: string }> }>('/api/foodhub/stores/discover', { method: 'POST', json: { channel: 'uber_eats' } }); setDiscovered(d.stores); if (!d.stores.length) toast.info(t('Uber n’a renvoyé aucun magasin.', 'Uber returned no store.')); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  function needsRegister(pick: Pick) {
    const defaultMerchantId = cloverMerchants.find((merchant) => merchant.isDefault)?.id ?? null;
    return uberCloverChoice(pick.storeId, pick.locationCode, stores ?? [], defaultMerchantId).required;
  }

  const chosen = picks.filter((p) => p.include && !results[p.storeId]?.mappingConflict);

  async function activate() {
    if (uberConnectionBusy.current) return;
    if (chosen.some((p) => !p.brandName || !p.locationCode)) { toast.warn(t('Choisissez une marque et une cuisine pour chaque magasin coché.', 'Pick a brand and a kitchen for every selected store.')); return; }
    if (chosen.some((p) => needsRegister(p) && (!p.cloverMerchantId || p.cloverSuggested))) {
      toast.warn(t('Choisissez la caisse Clover de destination pour chaque magasin sélectionné qui en a besoin.', 'Choose the destination Clover register for each selected store that requires one.'));
      return;
    }
    const confirmed = await checkPrice(chosen.map((p) => ({ brandName: p.brandName, channel: 'uber_eats', merchantId: p.cloverMerchantId })));
    if (!confirmed || uberConnectionBusy.current) return;
    uberConnectionBusy.current = true;
    setUberConnectionAction('activate');
    try {
      const d = await api<{ results: Array<{ storeId: string } & UberActivation> }>('/api/foodhub/uber-connect/activate', { method: 'POST', json: { id: connectId, stores: chosen.map((p) => ({ storeId: p.storeId, brandName: p.brandName, locationCode: p.locationCode, cloverMerchantId: p.cloverMerchantId || undefined, cloverSuggested: p.cloverSuggested || undefined })) } });
      setResults((previous) => ({ ...previous, ...Object.fromEntries(d.results.map((r) => [r.storeId, r])) }));
      const accepted = d.results.filter((r) => r.ok).length;
      const configured = d.results.filter((r) => r.ok && !r.mappingConflict && uberRoutingConfirmed(r)).length;
      const summary = t(`${configured}/${d.results.length} · Routage Uber configuré`, `${configured}/${d.results.length} · Uber routing configured`);
      if (d.results.some((r) => r.mappingConflict)) toast.warn(t('Vérifiez les liaisons modifiées pendant l’activation.', 'Review links changed during activation.'));
      else if (configured > 0 && configured === d.results.length) {
        toast.success(summary, t('Vérifiez la réception avec une commande de test.', 'Verify receipt with a test order.'));
      } else toast.warn(
        t(`${accepted}/${d.results.length} · Activation acceptée par Uber`, `${accepted}/${d.results.length} · Activation accepted by Uber`),
        summary,
      );
      window.history.replaceState(null, '', '/stores/mapping');
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally {
      uberConnectionBusy.current = false;
      setUberConnectionAction(null);
    }
  }

  /** "Disconnect from Uber": DELETE pos_data for one store (offboarding), with the merchant login of this session. */
  async function disconnect(p: Pick) {
    if (uberConnectionBusy.current) return;
    const yes = await confirm({
      title: t(`Débrancher ${p.name} d’Uber ?`, `Disconnect ${p.name} from Uber?`), tone: 'danger', confirmLabel: t('Débrancher', 'Disconnect'),
      body: t('Uber cessera d’envoyer les commandes et les appels de menu de ce magasin à Food Hub. Pour le rebrancher, il faudra une nouvelle activation.', 'Uber stops sending this store’s orders and menu calls to Food Hub. Linking it again needs a new activation.'),
    });
    if (!yes || uberConnectionBusy.current) return;
    uberConnectionBusy.current = true;
    setUberConnectionAction(`disconnect:${p.storeId}`);
    try {
      const d = await api<{ message: string; mappingConflict?: boolean }>('/api/foodhub/uber-connect/disconnect', { method: 'POST', json: { id: connectId, storeId: p.storeId } });
      const message = d.mappingConflict
        ? t('Uber a accepté le débranchement. Vérifiez la liaison enregistrée dans Food Hub.', 'Uber accepted the disconnect. Review the saved Food Hub link.')
        : d.message;
      setResults((all) => ({ ...all, [p.storeId]: { ok: true, message, disconnected: true, mappingConflict: d.mappingConflict } }));
      setPicks((all) => all.map((x) => (x.storeId === p.storeId ? { ...x, orderManager: 'unknown', include: false } : x)));
      const before = stores?.find((s) => s.channel === 'uber_eats' && s.channelStoreId === p.storeId);
      if (before) setChecks((all) => ({
        ...all, [before.id]: { ok: true, orderManager: 'unknown', integrationEnabled: null, message },
      }));
      if (d.mappingConflict) toast.warn(message, p.name);
      else toast.success(t('Débranché d’Uber', 'Disconnected from Uber'), p.name);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally {
      uberConnectionBusy.current = false;
      setUberConnectionAction(null);
    }
  }

  /** Read the order manager and webhook configuration from Uber. The optional write enables webhooks when off. */
  async function checkUber(enable = false) {
    if (uberConnectionBusy.current) return;
    uberConnectionBusy.current = true;
    setUberConnectionAction(enable ? 'enable' : 'check');
    try {
      const d = await api<{ rows: Array<{ storeId: string } & UberResult> }>('/api/foodhub/uber-connect/check', { method: 'POST', json: { enable } });
      setChecks(Object.fromEntries(d.rows.map((r) => [r.storeId, r])));
      setCheckError(null);
      const configured = d.rows.filter((r) => r.ok && uberRoutingConfirmed(r)).length;
      const summary = t(`${configured}/${d.rows.length} · Routage Uber configuré`, `${configured}/${d.rows.length} · Uber routing configured`);
      if (configured < d.rows.length) toast.warn(summary, t('Vérifiez l’état de chaque magasin.', 'Review each store’s status.'));
      else toast.info(summary);
      load();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) {
        const message = e instanceof Error ? e.message : String(e);
        setCheckError(message);
        toast.error(t('La vérification Uber a échoué.', 'The Uber check failed.'), message);
      }
    } finally {
      uberConnectionBusy.current = false;
      setUberConnectionAction(null);
    }
  }

  async function linkKnown(k: Known & { brandName: string; locationCode: string }) {
    if (!k.brandName || !k.locationCode) { toast.warn(t('Choisissez la marque et la cuisine.', 'Pick the brand and the kitchen.')); return; }
    if (!(await checkPrice({ brandName: k.brandName, channel: k.channel }))) return;
    setBusy(`known-${k.storeId}`);
    try { await api('/api/foodhub/stores', { method: 'POST', json: { channel: k.channel, channelStoreId: k.storeId, brandName: k.brandName, locationCode: k.locationCode, autoAccept: true } }); toast.success(t(`${k.name} relié`, `${k.name} linked`)); load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  /** "Tout relier": every row with a brand and a kitchen, one after the other (each brand's extra price is confirmed first). */
  async function linkAllKnown() {
    const ready = known.filter((k) => !k.mapped && k.brandName && k.locationCode) as Array<Known & { brandName: string; locationCode: string }>;
    if (!ready.length) { toast.warn(t('Choisissez la marque et la cuisine.', 'Pick the brand and the kitchen.')); return; }
    setBusy('known-all');
    let ok = 0;
    try {
      for (const k of ready) {
        if (!(await checkPrice({ brandName: k.brandName, channel: k.channel }))) continue;
        try { await api('/api/foodhub/stores', { method: 'POST', json: { channel: k.channel, channelStoreId: k.storeId, brandName: k.brandName, locationCode: k.locationCode, autoAccept: true } }); ok++; }
        catch (e) { if (e instanceof ApiError && e.status === 499) break; toast.error(k.name, e instanceof Error ? e.message : String(e)); }
      }
      if (ok) toast.success(t(`${countFr(ok, 'magasin relié', 'magasins reliés')}`, `${countEn(ok, 'store')} linked`));
      load();
    } finally { setBusy(''); }
  }
  function editStore(store: StoreRow, locationCode = store.locationCode) {
    const moving = locationCode !== store.locationCode;
    setForm({
      draftId: formDraftId('store-link', moving ? `${store.id}:move:${locationCode}` : store.id),
      sourceLocation: store.locationCode,
      lock: store.menuLock,
      initial: {
        id: store.id, channel: store.channel, channelStoreId: store.channelStoreId, brandName: store.brandName, locationCode,
        cloverMerchantId: moving ? '' : store.cloverMerchantId ?? '', autoAccept: store.autoAccept,
        doNotTouch: store.meta?.doNotTouch === true,
        platformStoreId: typeof store.meta?.platformStoreId === 'string' ? store.meta.platformStoreId : '',
        menuLocked: Boolean(store.menuLock?.locked),
        menuLockedReason: typeof store.meta?.menuLockedReason === 'string' ? store.meta.menuLockedReason : '',
      },
    });
  }

  function openDiscoveredStore(storeId: string) {
    const linked = stores?.find((store) => store.channel === 'uber_eats' && store.channelStoreId === storeId);
    if (linked) return editStore(linked);
    setForm({
      draftId: formDraftId('store-link', `uber-${storeId}`),
      initial: { ...blank(), channel: 'uber_eats', channelStoreId: storeId, brandName: '', locationCode: '' },
    });
  }

  function moveKnown(k: Known) {
    const store = stores?.find((s) => s.id === k.mapped?.id);
    if (store) editStore(store, k.confirmedByPlatform && k.expectedLocation ? k.expectedLocation : store.locationCode);
  }
  const unlinked = known.filter((k) => !k.mapped);
  const misplaced = known.filter((k) => k.locationMismatch);
  const unresolved = known.filter((k) => k.mapped && k.address && !k.confirmedByPlatform);
  const shown = (stores ?? []).filter((s) => !leaving.includes(s.id));

  return (
    <div>
      <PageHeader title={t('Restaurants', 'Restaurants')} tabs={<StoresTabs className="mb-0" />} subtitle={t('Reliez chaque magasin de chaque plateforme à une marque, une cuisine et une caisse Clover.', 'Link every platform store to a brand, a kitchen and a Clover register.')}
        right={<><Hint id="mapping.uber"><a href="/api/foodhub/uber-connect/start" className={buttonClass('brand', 'md')}><Link2 className="size-4" />{t('Brancher Uber Eats', 'Connect Uber Eats')}</a></Hint><Hint id="mapping.add"><Button variant="outline" onClick={() => setForm({ draftId: formDraftId('store-link'), initial: blank() })} icon={<Plus className="size-4" />}>{t('Ajouter un magasin', 'Add a store')}</Button></Hint></>} />

      {connectId && picks.length > 0 && (
        <Card className="mb-5 border-uber/40">
          <CardHeader icon={<PlatformMark channel="uber_eats" size="sm" />} title={t(`Magasins de votre compte Uber Eats (${picks.length})`, `Stores on your Uber Eats account (${picks.length})`)} subtitle={t('Vérifiez la marque, la cuisine et la caisse Clover suggérées, puis demandez l’activation. Uber peut accepter pendant qu’une autre intégration traite encore les commandes.', 'Review the suggested brand, kitchen and Clover register, then request activation. Uber can accept while another integration still manages orders.')}
            right={<Hint id="mapping.activate"><Button variant="brand" loading={uberConnectionAction === 'activate'} disabled={uberConnectionWorking || !stores || !chosen.length} onClick={activate}>{t('Activer et relier', 'Activate & link')}</Button></Hint>} />
          <Table cards>
            <thead><tr><Th><span className="sr-only">{t('Choisir', 'Pick')}</span></Th><Th>{t('Magasin Uber', 'Uber store')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Cuisine', 'Kitchen')}</Th><Th>Clover</Th><Th>{t('Gestionnaire observé', 'Observed order manager')}</Th><Th><span className="sr-only">{t('Résultat', 'Result')}</span></Th></tr></thead>
            <tbody>{picks.map((p, i) => {
              const upd = (patch: Partial<Pick>) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const r = results[p.storeId];
              const manager = r ? r.orderManager : p.orderManager;
              const disconnectManager = r?.disconnected ? undefined : r?.orderManager ?? p.orderManager;
              const message = r?.mappingConflict && !r.disconnected
                ? t('Uber a accepté l’activation. Vérifiez la cuisine et la caisse enregistrées dans Liaisons.', 'Uber accepted activation. Review the saved kitchen and register in Mapping.')
                : r?.message;
              return (<Fragment key={p.storeId}>
                <Tr>
                  <Td label={t('Activer', 'Activate')}><input type="checkbox" className="size-5" aria-label={t(`Activer ${p.name}`, `Activate ${p.name}`)} checked={p.include && !r?.mappingConflict} disabled={r?.mappingConflict} onChange={(e) => upd({ include: e.target.checked })} /></Td>
                  <Td primary><div className="font-semibold">{p.name}</div><div className="text-small text-ink-3">{p.address}</div></Td>
                  <Td label={t('Marque', 'Brand')}><Select selectSize="sm" aria-label={t(`Marque de ${p.name}`, `${p.name} brand`)} value={p.brandName} onChange={(e) => upd({ brandName: e.target.value })}><option value="">—</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Td>
                  <Td label={t('Cuisine', 'Kitchen')}><Select selectSize="sm" aria-label={t(`Cuisine de ${p.name}`, `${p.name} kitchen`)} value={p.locationCode} onChange={(e) => upd({ locationCode: e.target.value, cloverMerchantId: '', cloverSuggested: false })}><option value="">—</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Td>
                  <Td label="Clover"><Select selectSize="sm" value={p.cloverMerchantId} onChange={(e) => upd({ cloverMerchantId: e.target.value, cloverSuggested: false })} aria-label="Clover"><option value="">{needsRegister(p) ? t('Choisir la caisse de destination', 'Choose the destination register') : t('par défaut', 'default')}</option>{cloverMerchants.map((m) => <option key={m.id} value={m.id}>{m.name ? `${m.name} · ${m.id}` : m.id}{m.isDefault ? t(' (défaut)', ' (default)') : ''}</option>)}</Select></Td>
                  <Td label={t('Gestionnaire observé', 'Observed order manager')}>
                    <div className="flex flex-wrap gap-1">
                      <ManagerBadge value={manager} title={r && !r.disconnected ? message : undefined} />
                      {r?.ok && !r.disconnected && <WebhooksBadge enabled={r.integrationEnabled} />}
                    </div>
                  </Td>
                  <Td>{r && <ActivationBadge result={r} title={message} />}
                    {(disconnectManager === 'foodhub' || disconnectManager === 'pending') && (
                      <Button variant="ghost" size="sm" className="text-stop" loading={uberConnectionAction === `disconnect:${p.storeId}`} disabled={uberConnectionWorking} onClick={() => disconnect(p)}>{t('Débrancher d’Uber', 'Disconnect from Uber')}</Button>
                    )}</Td>
                </Tr>
                {r && <tr><td colSpan={7} className={`px-4 pb-3 text-small ${r.mappingConflict ? 'text-wait-2' : r.ok ? 'text-ink-2' : 'text-stop-2'}`}>{message}</td></tr>}
              </Fragment>);
            })}</tbody>
          </Table>
        </Card>
      )}

      {unresolved.length > 0 && (
        <Banner tone="warn" className="mb-5">
          <strong>{t('Adresses Uber à rapprocher', 'Uber addresses to match')}</strong>
          <ul>{unresolved.map((store) => <li key={store.storeId}>{store.name} · {store.address}</li>)}</ul>
        </Banner>
      )}

      {misplaced.length > 0 && (
        <Banner tone="warn" className="mb-5">
          <strong>{t(`Cuisine à vérifier pour ${countFr(misplaced.length, 'magasin Uber', 'magasins Uber')}`, `Check the kitchen for ${countEn(misplaced.length, 'Uber store')}`)}</strong>
          <ul className="mt-2 space-y-1.5">{misplaced.map((k) => (
            <li key={k.storeId} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{k.name}</span><span className="font-mono text-micro text-ink-3">{k.storeId}</span>
              <span>{t('Cuisine actuelle', 'Mapped kitchen')} · {shortLoc(locName(k.mapped?.locationCode))}</span>
              <span>{k.confirmedByPlatform ? t('Selon l’adresse Uber', 'From the Uber address') : t('Selon le registre historique', 'From the historical register')} · <strong>{shortLoc(locName(k.expectedLocation))}</strong></span>
              <Button size="sm" variant="outline" disabled={!stores?.some((s) => s.id === k.mapped?.id)} onClick={() => moveKnown(k)}>{k.confirmedByPlatform ? t('Déplacer', 'Move') : t('Vérifier la liaison', 'Review mapping')}</Button>
            </li>
          ))}</ul>
        </Banner>
      )}

      {unlinked.length > 0 && (
        <Card className="mb-5">
          <CardHeader icon={<PlatformMark channel="uber_eats" size="sm" />} title={t(`Vos magasins Uber Eats à relier (${unlinked.length}/${known.length})`, `Your Uber Eats stores to link (${unlinked.length}/${known.length})`)}
            subtitle={t('Les magasins que vous nous avez donnés. Choisissez la marque et la cuisine de chacun, puis reliez-les. Une fois Uber Eats branché, l’adresse Uber confirme la cuisine.', 'The stores you gave us. Pick each one’s brand and kitchen, then link them. Once Uber Eats is connected, Uber’s address confirms the kitchen.')}
            right={<Button variant="primary" loading={busy === 'known-all'} disabled={!unlinked.some((k) => k.brandName && k.locationCode)} onClick={linkAllKnown}>{t('Tout relier', 'Link all')}</Button>} />
          <Table cards>
            <thead><tr><Th>{t('Magasin Uber', 'Uber store')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Cuisine', 'Kitchen')}</Th><Th><span className="sr-only">{t('Relier', 'Link')}</span></Th></tr></thead>
            <tbody>{unlinked.map((k) => {
              const upd = (patch: Partial<Known & { brandName: string; locationCode: string }>) => setKnown((all) => all.map((x) => (x.storeId === k.storeId ? { ...x, ...patch } : x)));
              return (
                <Tr key={k.storeId}>
                  <Td primary><div className="font-semibold">{k.name}</div><div className="font-mono text-micro text-ink-3">{k.storeId}</div>{k.address ? <div className={k.confirmedByPlatform ? "text-small text-go-2" : "text-small text-ink-3"}>{k.confirmedByPlatform ? "✓ " : ""}{k.address}{!k.confirmedByPlatform && t(' · cuisine à vérifier', ' · verify kitchen')}</div> : <div className="text-small text-ink-3">{t('Adresse Uber à vérifier', 'Uber address awaiting verification')}</div>}</Td>
                  <Td label={t('Marque', 'Brand')}><Select selectSize="sm" aria-label={t(`Marque de ${k.name}`, `${k.name} brand`)} value={k.brandName} onChange={(e) => upd({ brandName: e.target.value })}><option value="">—</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Td>
                  <Td label={t('Cuisine', 'Kitchen')}><Select selectSize="sm" aria-label={t(`Cuisine de ${k.name}`, `${k.name} kitchen`)} value={k.locationCode} onChange={(e) => upd({ locationCode: e.target.value })}><option value="">{t('— choisir —', '— choose —')}</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Td>
                  <Td align="right"><Button size="sm" variant="outline" loading={busy === `known-${k.storeId}`} disabled={!k.brandName || !k.locationCode} onClick={() => linkKnown(k)}>{t('Relier', 'Link')}</Button></Td>
                </Tr>
              );
            })}</tbody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader title={t(`Magasins branchés (${shown.length})`, `Connected stores (${shown.length})`)} right={<>
          <Button variant="outline" size="sm" loading={uberConnectionAction === 'check'} disabled={uberConnectionWorking} onClick={() => checkUber(false)} icon={<ShieldCheck className="size-4" />}>{t('Vérifier chez Uber', 'Check with Uber')}</Button>
          {Object.values(checks).some((c) => c.ok && c.integrationEnabled === false) && <Button variant="brand" size="sm" loading={uberConnectionAction === 'enable'} disabled={uberConnectionWorking} onClick={() => checkUber(true)}>{t('Activer les commandes Uber', 'Switch Uber orders on')}</Button>}
          <Button variant="outline" size="sm" loading={busy === 'discover'} onClick={discover} icon={<Radar className="size-4" />}>{t('Découvrir les magasins Uber', 'Discover Uber stores')}</Button>
        </>} />
        {discovered.length > 0 && (
          <div className="mx-5 mb-4 rounded-lg border border-line bg-raised">
            {discovered.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <div className="min-w-0 flex-1"><div className="text-body font-semibold">{d.name}</div><div className="truncate font-mono text-small text-ink-3">{d.id}</div>{d.address && <div className="text-small text-ink-3">{d.address}</div>}</div>
                <Button size="sm" variant="outline" disabled={!stores} onClick={() => openDiscoveredStore(d.id)}>{t('Utiliser', 'Use')}</Button>
              </div>
            ))}
          </div>
        )}
        {stores && shown.length === 0 ? <EmptyState icon={<Link2 className="size-6" />} title={t('Aucun magasin branché', 'No store connected')} body={t('Ajoutez le numéro de chaque magasin, ou branchez Uber Eats en un clic.', 'Add each store’s number, or connect Uber Eats in one click.')} action={<Button variant="outline" onClick={() => setForm({ draftId: formDraftId('store-link'), initial: blank() })} icon={<Plus className="size-4" />}>{t('Ajouter un magasin', 'Add a store')}</Button>} /> : (
          <Table cards>
            <thead><tr><Th>{t('Marque', 'Brand')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Cuisine', 'Kitchen')}</Th><Th>{t('Numéro du magasin', 'Store number')}</Th><Th>Clover</Th><Th>{t('Accepte seul', 'Auto-accept')}</Th><Th>{t('Statut', 'Status')}</Th><Th><span className="sr-only">{t('Actions', 'Actions')}</span></Th></tr></thead>
            <tbody>
              {shown.map((s) => {
                const st = stateOf(s);
                const check = checks[s.id];
                const directUber = s.channel === 'uber_eats' && !s.channelStoreId.startsWith('relay:');
                const routing = check ?? (directUber ? uberPosForStore(s) : undefined);
                const failedCheck = checkError ?? (check && !check.ok ? check.message : null);
                return (
                  <Tr key={s.id}>
                    <Td primary className="font-semibold">{s.brandName}</Td>
                    <Td label={t('Plateforme', 'Platform')}><PlatformTag channel={s.channel} /></Td>
                    <Td label={t('Cuisine', 'Kitchen')} className="text-ink-2">{shortLoc(locName(s.locationCode))}</Td>
                    <Td label={t('Numéro', 'Number')} className="max-w-48 font-mono text-small" title={s.channelStoreId}>
                      <div className="truncate">{s.channelStoreId}</div>
                      {s.meta?.platformStoreId ? <div className="truncate text-micro text-ink-3">#{String(s.meta.platformStoreId)}</div> : null}
                      {s.menuLock?.locked && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-wait/15 px-2 py-0.5 font-sans text-micro font-bold text-wait-2" title={t(s.menuLock.reasonFr ?? s.menuLock.reason ?? '', s.menuLock.reason ?? '')}><Lock className="size-3" />{t('Menu verrouillé', 'Menu locked')}</span>}
                    </Td>
                    <Td label="Clover" className="font-mono text-small text-ink-3">{s.cloverMerchantId || t('par défaut', 'default')}</Td>
                    <Td label={t('Accepte seul', 'Auto-accept')}>{s.autoAccept ? <span aria-label={t('oui', 'yes')}>✓</span> : <span aria-label={t('non', 'no')}>—</span>}</Td>
                    <Td label={t('Statut', 'Status')}>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={st.tone}>{stateText(t, st.state)}</Badge>
                        {directUber && (
                          failedCheck ? <Badge tone="wait" title={failedCheck}>{t('Vérification Uber échouée', 'Uber check failed')}</Badge>
                            : <>
                              <ManagerBadge value={routing?.orderManager} title={check?.message} />
                              <WebhooksBadge enabled={routing?.integrationEnabled} />
                            </>
                        )}
                        {s.meta?.doNotTouch === true && <Badge tone="neutral" title={t('Food Hub n’envoie ni menu ni rupture à ce magasin.', 'Food Hub sends this store no menu and no 86.')}>{t('ne pas toucher', 'do not touch')}</Badge>}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" onClick={() => editStore(s)} aria-label={t('Modifier', 'Edit')}><Pencil className="size-4" /></button>
                      <Hint id="mapping.disconnect"><button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-stop" onClick={() => remove(s)} aria-label={t('Débrancher', 'Disconnect')}><Trash2 className="size-4" /></button></Hint>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {form && <StoreLinkForm key={form.draftId} {...form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

/** The order manager reported by Uber. Webhook configuration is shown separately. */
function ManagerBadge({ value, title }: { value?: OrderManager | null; title?: string }) {
  const { t } = useI18n();
  if (!value || value === 'unknown') return <Badge tone="neutral" title={title}>{t('Gestionnaire non confirmé', 'Order manager unconfirmed')}</Badge>;
  if (value === 'foodhub') return <Badge tone="info" title={title}>Food Hub</Badge>;
  if (value === 'pending') return <Badge tone="wait" title={title}>{t('vers Food Hub (en cours)', 'moving to Food Hub')}</Badge>;
  return <Badge tone="stop" title={title ?? t('Uber indique qu’une autre intégration gère les commandes.', 'Uber reports another integration as the order manager.')}>{t('autre intégration', 'other integration')}</Badge>;
}

function ActivationBadge({ result, title }: { result: UberActivation; title?: string }) {
  const { t } = useI18n();
  if (result.mappingConflict) return <Badge tone="wait" title={title}>{t('Liaison à vérifier', 'Review link')}</Badge>;
  if (result.disconnected) return <Badge tone="neutral" title={title}>{t('Débranché d’Uber', 'Disconnected from Uber')}</Badge>;
  if (!result.ok) return <Badge tone="stop" title={title}>{t('Échec', 'Failed')}</Badge>;
  return <Badge tone={uberRoutingConfirmed(result) ? 'go' : 'wait'} title={title}>{t('Activation acceptée', 'Activation accepted')}</Badge>;
}

function WebhooksBadge({ enabled }: { enabled: boolean | null | undefined }) {
  const { t } = useI18n();
  if (enabled === true) return <Badge tone="info">{t('Webhooks de commandes actifs', 'Order webhooks on')}</Badge>;
  if (enabled === false) return <Badge tone="wait">{t('Webhooks de commandes désactivés', 'Order webhooks off')}</Badge>;
  return <Badge tone="neutral">{t('État des webhooks non confirmé', 'Order webhook status unknown')}</Badge>;
}

/**
 * Connect a store / edit a connection. What is typed is kept on this tablet (closing by mistake, a reload or a crash
 * loses nothing) and only sent by the form's own button; a successful save forgets the draft.
 */
function StoreLinkForm({ draftId, initial, sourceLocation, lock, onClose, onSaved }: OpenForm & { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { viewer, locations, brands } = useViewer();
  const toast = useToast();
  const draft = useFormDraft<Form>(draftId, viewer.username, initial);
  const form = draft.value;
  const setForm = draft.set;
  const movingUber = form.channel === 'uber_eats' && Boolean(sourceLocation) && form.locationCode !== sourceLocation;
  // Require a choice for the destination kitchen, including when restoring an older draft.
  const cloverMerchantId = movingUber && form.destinationCloverLocation !== form.locationCode ? '' : form.cloverMerchantId;
  const [saving, setSaving] = useState(false);
  const checkPrice = useExtraBrandPriceConfirm();
  // Built-in / environment locks are shown, never offered as a switch (the server refuses to lift them anyway).
  const fixedLock = Boolean(lock?.locked && lock.source !== 'store');

  const ID_HINT: Record<string, string> = {
    uber_eats: t('UUID du magasin Uber (utilisez « Découvrir »)', 'Uber store UUID (use “Discover”)'),
    doordash: t('merchant_supplied_id convenu avec DoorDash', 'merchant_supplied_id agreed with DoorDash'),
    skip: t('posLocationId enregistré chez JET Connect', 'posLocationId registered with JET Connect'),
    tgtg: t('Identifiant du magasin TGTG', 'TGTG store id'),
  };

  /** X, backdrop, Esc or Cancel: nothing is sent, what was typed stays for next time. */
  function close() {
    if (draft.dirty) toast.info(t('Gardé — rouvrez pour terminer', 'Kept — reopen to finish'));
    onClose();
  }

  function changeKitchen(locationCode: string) {
    const next = { ...form, locationCode };
    if (sourceLocation && form.channel === 'uber_eats') {
      next.cloverMerchantId = locationCode === sourceLocation ? initial.cloverMerchantId : '';
      next.destinationCloverLocation = undefined;
    }
    setForm(next);
  }

  async function save() {
    if (!(await checkPrice({ brandName: form.brandName, channel: form.channel, merchantId: cloverMerchantId, storeId: form.id }))) return;
    setSaving(true);
    const payload = {
      id: initial.id, channel: form.channel, channelStoreId: form.channelStoreId, brandName: form.brandName,
      locationCode: form.locationCode, cloverMerchantId, autoAccept: form.autoAccept, doNotTouch: form.doNotTouch,
      platformStoreId: form.platformStoreId, menuLocked: fixedLock ? undefined : form.menuLocked, menuLockedReason: form.menuLockedReason,
    };
    try { await api('/api/foodhub/stores', { method: 'POST', json: payload }); draft.clear(); toast.success(t('Magasin branché', 'Store connected')); onSaved(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }

  return (
    <Modal title={form.id ? t('Modifier le branchement', 'Edit the connection') : t('Brancher un magasin', 'Connect a store')} onClose={close}
      footer={<><Button variant="ghost" size="lg" onClick={close}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={saving} disabled={!form.channelStoreId.trim() || !form.brandName || !form.locationCode || (movingUber && !cloverMerchantId.trim())} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <FormDraftNote restored={draft.restored} onDiscard={draft.discard} />
      <div className="space-y-4">
        <Field label={t('Plateforme', 'Platform')}><Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} disabled={Boolean(form.id)}>{[['uber_eats', 'Uber Eats'], ['doordash', 'DoorDash'], ['skip', 'SkipTheDishes'], ['tgtg', 'Too Good To Go']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label={t('Identifiant du magasin', 'Store id')} hint={ID_HINT[form.channel]}><Input value={form.channelStoreId} onChange={(e) => setForm({ ...form, channelStoreId: e.target.value })} className="font-mono" /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('Marque', 'Brand')}><Select value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })}><option value="">{t('— choisir —', '— choose —')}</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Field>
          <Field label={t('Cuisine', 'Kitchen')}><Select value={form.locationCode} onChange={(e) => changeKitchen(e.target.value)}><option value="">{t('— choisir —', '— choose —')}</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Field>
        </div>
        <Field label={movingUber ? t('Marchand Clover de destination (requis)', 'Destination Clover merchant (required)') : t('Marchand Clover (optionnel)', 'Clover merchant (optional)')}
          hint={movingUber ? t('Vérifiez la caisse de cette cuisine dans le tableau de bord Clover et saisissez son identifiant marchand.', 'Check this kitchen’s register in the Clover dashboard and enter its merchant ID.') : t('Vide = la caisse Clover par défaut. Les ruptures venues de Clover suivent ce marchand ; une cuisine n’en reçoit que si tous ses magasins suivent le même marchand. Sinon le code de lettres et de chiffres dans l’adresse du tableau de bord Clover (clover.com/home/m/…), pas le numéro de marchand du terminal de paiement.', 'Empty = the default Clover register. 86s coming from Clover follow this merchant; a location only gets them when all its stores follow the same merchant. Otherwise the code of letters and digits in the Clover dashboard address (clover.com/home/m/…), not the payment terminal’s merchant number.')}>
          <Input value={cloverMerchantId} required={movingUber} onChange={(e) => setForm({ ...form, cloverMerchantId: e.target.value, destinationCloverLocation: form.locationCode })} className="font-mono" />
        </Field>
        <Hint id="mapping.autoaccept"><Switch checked={form.autoAccept} onChange={(v) => setForm({ ...form, autoAccept: v })} label={t('Accepter automatiquement', 'Accept automatically')} description={t('Seulement si Clover a bien reçu la commande. La cuisine doit quand même appuyer sur « Vu ».', 'Only when Clover received the order. The kitchen still taps “Seen”.')} /></Hint>
        <Field label={t('Numéro du magasin chez la plateforme (optionnel)', 'Platform store number (optional)')} hint={t('Ex. le numéro de magasin DoorDash (différent du merchant_supplied_id). Sert à reconnaître le magasin, p. ex. pour le verrou du menu.', 'E.g. the DoorDash store number (not the merchant_supplied_id). Used to recognise the store, e.g. for the menu lock.')}><Input value={form.platformStoreId ?? ''} onChange={(e) => setForm({ ...form, platformStoreId: e.target.value })} className="font-mono" inputMode="numeric" /></Field>
        {fixedLock
          ? <Banner tone="warn"><strong className="inline-flex items-center gap-1"><Lock className="size-4" />{t('Menu verrouillé en permanence', 'Menu locked for good')}</strong> — {t('Food Hub ne change jamais le menu de ce magasin (publication, rupture, retour en stock). Les commandes et les pauses fonctionnent normalement.', 'Food Hub never changes this store’s menu (publish, 86, back in stock). Orders and pauses work as usual.')} <span className="text-ink-3">{t(lock?.reasonFr ?? lock?.reason ?? '', lock?.reason ?? '')}</span></Banner>
          : <>
            <Switch checked={Boolean(form.menuLocked)} onChange={(v) => setForm({ ...form, menuLocked: v })} label={t('Ne jamais changer le menu de ce magasin', 'Never change this store’s menu')} description={t('Aucune publication, aucune rupture (86) et aucun retour en stock n’est envoyé — ni par l’équipe, ni par Clover, ni par une minuterie. Les commandes et les pauses fonctionnent normalement.', 'No publish, no 86 and no back-in-stock is ever sent — not by staff, Clover or a timer. Orders and pauses work as usual.')} />
            {form.menuLocked && <Field label={t('Pourquoi (optionnel)', 'Why (optional)')}><Input value={form.menuLockedReason ?? ''} onChange={(e) => setForm({ ...form, menuLockedReason: e.target.value })} maxLength={200} /></Field>}
          </>}
        <Switch checked={Boolean(form.doNotTouch)} onChange={(v) => setForm({ ...form, doNotTouch: v })} label={t('Ne pas toucher au menu de ce magasin', 'Do not touch this store’s menu')} description={t('Food Hub ne lui envoie jamais de menu, d’heures de fériés ni de rupture (ex. : encore chez UrbanPiper, menu spécial). Les commandes et la pause continuent.', 'Food Hub never sends it a menu, holiday hours or an 86 (e.g. still on UrbanPiper, a special menu). Orders and pause keep working.')} />
        <ExtraBrandPriceNotice brandName={form.brandName} channel={form.channel} merchantId={cloverMerchantId} storeId={form.id} />
        {form.channel === 'tgtg' && <Banner tone="info">{t('Too Good To Go n’a pas d’API publique : TAKATAK reçoit seulement ce que TGTG envoie.', 'Too Good To Go has no public API: TAKATAK only receives what TGTG sends.')}</Banner>}
      </div>
    </Modal>
  );
}
