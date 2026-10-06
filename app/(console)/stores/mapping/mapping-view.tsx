'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link2, Pencil, Plus, Radar, Trash2 } from 'lucide-react';
import { Badge, PlatformMark, PlatformTag, platformOf } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { FormDraftNote } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { stateOf, stateText } from '../stores-view';
import { api, ApiError } from '@/lib/ui/api';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';
import type { ChannelStore } from '@/lib/foodhub/types';

type Form = { id?: string; channel: string; channelStoreId: string; brandName: string; locationCode: string; cloverMerchantId: string; autoAccept: boolean };
/** The link form being shown: its draft id (one per store, per discovered Uber store, or 'new') and starting values. */
type OpenForm = { draftId: string; initial: Form };
type Pick = { storeId: string; name: string; address?: string; brandName: string; locationCode: string; include: boolean };
type Known = { channel: string; storeId: string; name: string; address: string | null; suggestedBrand: string | null; suggestedLocation: string | null; confirmedByPlatform: boolean; mapped: { id: string; brandName: string; locationCode: string } | null };

export function MappingView() {
  const { t } = useI18n();
  const { locations, brands, locName } = useViewer();
  const params = useSearchParams();
  const toast = useToast();
  const [stores, setStores] = useState<ChannelStore[] | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  /** Stores disconnected less than 6 s ago: hidden, and only removed on the server once "Undo" is no longer offered. */
  const [leaving, setLeaving] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [connectId, setConnectId] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [known, setKnown] = useState<Array<Known & { brandName: string; locationCode: string }>>([]);

  const load = useCallback(() => {
    api<{ stores: Known[] }>('/api/foodhub/stores/known').then((d) => setKnown(d.stores.map((k) => ({ ...k, brandName: k.suggestedBrand ?? '', locationCode: k.suggestedLocation ?? '' })))).catch(() => undefined);
    return api<{ stores: ChannelStore[] }>('/api/foodhub/stores').then((d) => setStores(d.stores)).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const err = params.get('uber_error');
    if (err) toast.error('Uber Eats', err);
    const id = params.get('uber_connect');
    if (!id) return;
    setConnectId(id);
    api<{ stores: Array<{ id: string; name: string; address?: string; suggestedBrand?: string; suggestedLocation?: string }>; error: string | null; active: boolean }>(`/api/foodhub/uber-connect/session?id=${id}`)
      .then((d) => { if (d.error) toast.error(d.error); setPicks(d.stores.map((x) => ({ storeId: x.id, name: x.name, address: x.address, brandName: x.suggestedBrand || '', locationCode: x.suggestedLocation || '', include: Boolean(x.suggestedBrand && x.suggestedLocation) }))); })
      .catch((e) => toast.error(e.message));
  }, [params, toast]);

  const blank = (): Form => ({ channel: 'uber_eats', channelStoreId: '', brandName: brands[0] ?? '', locationCode: locations[0]?.code ?? '', cloverMerchantId: '', autoAccept: true });

  /**
   * Disconnect without an "are you sure?": the row goes away at once with 6 s to take it back, and the store is only
   * removed on the server when that window closes (until then its orders keep flowing as before).
   */
  function remove(s: ChannelStore) {
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
  async function activate() {
    const chosen = picks.filter((p) => p.include);
    if (chosen.some((p) => !p.brandName || !p.locationCode)) { toast.warn(t('Choisissez une marque et une succursale pour chaque magasin coché.', 'Pick a brand and a location for every selected store.')); return; }
    setBusy('activate');
    try {
      const d = await api<{ results: Array<{ storeId: string; ok: boolean; message: string }> }>('/api/foodhub/uber-connect/activate', { method: 'POST', json: { id: connectId, stores: chosen } });
      setResults(Object.fromEntries(d.results.map((r) => [r.storeId, r])));
      toast.success(t(`${d.results.filter((r) => r.ok).length}/${d.results.length} magasin(s) Uber activé(s)`, `${d.results.filter((r) => r.ok).length}/${d.results.length} Uber store(s) activated`));
      window.history.replaceState(null, '', '/stores/mapping');
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function linkKnown(k: Known & { brandName: string; locationCode: string }) {
    if (!k.brandName || !k.locationCode) { toast.warn(t('Choisissez la marque et la succursale.', 'Pick the brand and the location.')); return; }
    setBusy(`known-${k.storeId}`);
    try { await api('/api/foodhub/stores', { method: 'POST', json: { channel: k.channel, channelStoreId: k.storeId, brandName: k.brandName, locationCode: k.locationCode, autoAccept: true } }); toast.success(t(`${k.name} relié`, `${k.name} linked`)); load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const unlinked = known.filter((k) => !k.mapped);
  const shown = (stores ?? []).filter((s) => !leaving.includes(s.id));

  return (
    <div>
      <PageHeader title={t('Magasins', 'Stores')} subtitle={t('Reliez chaque magasin de chaque plateforme à une marque, une succursale et un marchand Clover.', 'Link every platform store to a brand, a location and a Clover merchant.')}
        right={<><Hint id="mapping.uber"><a href="/api/foodhub/uber-connect/start" className={buttonClass('brand', 'md')}><Link2 className="size-4" />{t('Brancher Uber Eats', 'Connect Uber Eats')}</a></Hint><Hint id="mapping.add"><Button variant="primary" onClick={() => setForm({ draftId: formDraftId('store-link'), initial: blank() })} icon={<Plus className="size-4" />}>{t('Ajouter un magasin', 'Add a store')}</Button></Hint></>} />
      <StoresTabs />

      {connectId && picks.length > 0 && (
        <Card className="mb-5 border-uber/40">
          <CardHeader icon={<PlatformMark channel="uber_eats" size="sm" />} title={t(`Magasins de votre compte Uber Eats (${picks.length})`, `Stores on your Uber Eats account (${picks.length})`)} subtitle={t('Marque et succursale pré-remplies d’après le nom et l’adresse Uber — vérifiez, puis activez.', 'Brand and location pre-filled from the Uber name and address — check, then activate.')}
            right={<Hint id="mapping.activate"><Button variant="brand" loading={busy === 'activate'} disabled={!picks.some((p) => p.include)} onClick={activate}>{t('Activer et relier', 'Activate & link')}</Button></Hint>} />
          <Table>
            <thead><tr><Th /><Th>{t('Magasin Uber', 'Uber store')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Succursale', 'Location')}</Th><Th /></tr></thead>
            <tbody>{picks.map((p, i) => {
              const upd = (patch: Partial<Pick>) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const r = results[p.storeId];
              return (
                <Tr key={p.storeId}>
                  <Td><input type="checkbox" className="size-4" checked={p.include} onChange={(e) => upd({ include: e.target.checked })} /></Td>
                  <Td><div className="font-semibold">{p.name}</div><div className="text-xs text-ink-3">{p.address}</div></Td>
                  <Td><Select selectSize="sm" value={p.brandName} onChange={(e) => upd({ brandName: e.target.value })}><option value="">—</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Td>
                  <Td><Select selectSize="sm" value={p.locationCode} onChange={(e) => upd({ locationCode: e.target.value })}><option value="">—</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Td>
                  <Td>{r && <Badge tone={r.ok ? 'go' : 'stop'} title={r.message}>{r.ok ? t('activé', 'activated') : t('échec', 'failed')}</Badge>}</Td>
                </Tr>
              );
            })}</tbody>
          </Table>
        </Card>
      )}

      {unlinked.length > 0 && (
        <Card className="mb-5">
          <CardHeader icon={<PlatformMark channel="uber_eats" size="sm" />} title={t(`Vos magasins Uber Eats à relier (${unlinked.length}/${known.length})`, `Your Uber Eats stores to link (${unlinked.length}/${known.length})`)}
            subtitle={t('Les UUID que vous avez donnés. Choisissez la succursale de chacun et reliez-le. Dès que les clés Uber sont en place, l’adresse Uber confirme la succursale, et « Brancher Uber Eats » active chaque magasin chez Uber.', 'The UUIDs you gave. Pick each one’s location and link it. Once the Uber keys are in, Uber’s address confirms the location, and “Connect Uber Eats” activates each store at Uber.')} />
          <Table>
            <thead><tr><Th>{t('Magasin Uber', 'Uber store')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Succursale', 'Location')}</Th><Th /></tr></thead>
            <tbody>{unlinked.map((k) => {
              const upd = (patch: Partial<Known & { brandName: string; locationCode: string }>) => setKnown((all) => all.map((x) => (x.storeId === k.storeId ? { ...x, ...patch } : x)));
              return (
                <Tr key={k.storeId}>
                  <Td><div className="font-semibold">{k.name}</div><div className="font-mono text-[11px] text-ink-3">{k.storeId}</div>{k.address ? <div className="text-xs text-go-2">✓ {k.address}</div> : <div className="text-xs text-ink-3">{t('adresse confirmée par Uber quand les clés seront en place', 'address confirmed by Uber once the keys are in')}</div>}</Td>
                  <Td><Select selectSize="sm" value={k.brandName} onChange={(e) => upd({ brandName: e.target.value })}><option value="">—</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Td>
                  <Td><Select selectSize="sm" value={k.locationCode} onChange={(e) => upd({ locationCode: e.target.value })}><option value="">{t('— choisir —', '— choose —')}</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Td>
                  <Td align="right"><Button size="sm" loading={busy === `known-${k.storeId}`} disabled={!k.brandName || !k.locationCode} onClick={() => linkKnown(k)}>{t('Relier', 'Link')}</Button></Td>
                </Tr>
              );
            })}</tbody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader title={t(`Magasins branchés (${shown.length})`, `Connected stores (${shown.length})`)} right={<Button variant="outline" size="sm" loading={busy === 'discover'} onClick={discover} icon={<Radar className="size-4" />}>{t('Découvrir les magasins Uber', 'Discover Uber stores')}</Button>} />
        {discovered.length > 0 && (
          <div className="mx-5 mb-4 rounded-lg border border-line bg-raised">
            {discovered.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{d.name}</div><div className="truncate font-mono text-xs text-ink-3">{d.id}</div></div>
                <Button size="sm" variant="outline" onClick={() => setForm({ draftId: formDraftId('store-link', `uber-${d.id}`), initial: { ...blank(), channel: 'uber_eats', channelStoreId: d.id } })}>{t('Utiliser', 'Use')}</Button>
              </div>
            ))}
          </div>
        )}
        {stores && shown.length === 0 ? <EmptyState icon={<Link2 className="size-6" />} title={t('Aucun magasin branché', 'No store connected')} body={t('Ajoutez l’identifiant de chaque magasin, ou branchez Uber Eats en un clic.', 'Add each store’s id, or connect Uber Eats in one click.')} /> : (
          <Table>
            <thead><tr><Th>{t('Marque', 'Brand')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Succursale', 'Location')}</Th><Th>{t('Identifiant', 'Store id')}</Th><Th>Clover</Th><Th>{t('Auto', 'Auto')}</Th><Th>{t('Statut', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {shown.map((s) => {
                const st = stateOf(s);
                return (
                  <Tr key={s.id}>
                    <Td className="font-semibold">{s.brandName}</Td>
                    <Td><PlatformTag channel={s.channel} /></Td>
                    <Td className="text-ink-2">{shortLoc(locName(s.locationCode))}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs" title={s.channelStoreId}>{s.channelStoreId}</Td>
                    <Td className="font-mono text-xs text-ink-3">{s.cloverMerchantId || t('par défaut', 'default')}</Td>
                    <Td>{s.autoAccept ? '✓' : '—'}</Td>
                    <Td><Badge tone={st.tone}>{stateText(t, st.state)}</Badge></Td>
                    <Td className="whitespace-nowrap text-right">
                      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" onClick={() => setForm({ draftId: formDraftId('store-link', s.id), initial: { id: s.id, channel: s.channel, channelStoreId: s.channelStoreId, brandName: s.brandName, locationCode: s.locationCode, cloverMerchantId: s.cloverMerchantId ?? '', autoAccept: s.autoAccept } })} aria-label={t('Modifier', 'Edit')}><Pencil className="size-4" /></button>
                      <Hint id="mapping.disconnect"><button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-stop" onClick={() => remove(s)} aria-label={t('Débrancher', 'Disconnect')}><Trash2 className="size-4" /></button></Hint>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {form && <StoreLinkForm key={form.draftId} draftId={form.draftId} initial={form.initial} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

/**
 * Connect a store / edit a connection. What is typed is kept on this tablet (closing by mistake, a reload or a crash
 * loses nothing) and only sent by the form's own button; a successful save forgets the draft.
 */
function StoreLinkForm({ draftId, initial, onClose, onSaved }: { draftId: string; initial: Form; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { viewer, locations, brands } = useViewer();
  const toast = useToast();
  const draft = useFormDraft<Form>(draftId, viewer.username, initial);
  const form = draft.value;
  const setForm = draft.set;
  const [saving, setSaving] = useState(false);

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
  async function save() {
    setSaving(true);
    try { await api('/api/foodhub/stores', { method: 'POST', json: form }); draft.clear(); toast.success(t('Magasin branché', 'Store connected')); onSaved(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }

  return (
    <Modal title={form.id ? t('Modifier le branchement', 'Edit the connection') : t('Brancher un magasin', 'Connect a store')} onClose={close}
      footer={<><Button variant="ghost" size="lg" onClick={close}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={saving} disabled={!form.channelStoreId.trim() || !form.brandName || !form.locationCode} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <FormDraftNote restored={draft.restored} onDiscard={draft.discard} />
      <div className="space-y-4">
        <Field label={t('Plateforme', 'Platform')}><Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} disabled={Boolean(form.id)}>{[['uber_eats', 'Uber Eats'], ['doordash', 'DoorDash'], ['skip', 'SkipTheDishes'], ['tgtg', 'Too Good To Go']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label={t('Identifiant du magasin', 'Store id')} hint={ID_HINT[form.channel]}><Input value={form.channelStoreId} onChange={(e) => setForm({ ...form, channelStoreId: e.target.value })} className="font-mono" /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('Marque', 'Brand')}><Select value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })}>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Field>
          <Field label={t('Succursale', 'Location')}><Select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Field>
        </div>
        <Field label={t('Marchand Clover (optionnel)', 'Clover merchant (optional)')} hint={t('Vide = marchand par défaut (CLOVER_MERCHANT_ID).', 'Empty = default merchant (CLOVER_MERCHANT_ID).')}><Input value={form.cloverMerchantId} onChange={(e) => setForm({ ...form, cloverMerchantId: e.target.value })} className="font-mono" /></Field>
        <Hint id="mapping.autoaccept"><Switch checked={form.autoAccept} onChange={(v) => setForm({ ...form, autoAccept: v })} label={t('Accepter automatiquement', 'Accept automatically')} description={t('Seulement si Clover a bien reçu la commande. La cuisine doit quand même appuyer sur « Vu ».', 'Only when Clover received the order. The kitchen still taps “Seen”.')} /></Hint>
        {form.channel === 'tgtg' && <Banner tone="info">{t('Too Good To Go n’a pas d’API publique : TAKATAK reçoit seulement ce que TGTG envoie.', 'Too Good To Go has no public API: TAKATAK only receives what TGTG sends.')}</Banner>}
      </div>
    </Modal>
  );
}
