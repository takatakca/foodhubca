'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link2, Pencil, Plus, Radar, ShieldCheck, Trash2 } from 'lucide-react';
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

type Form = { id?: string; channel: string; channelStoreId: string; brandName: string; locationCode: string; cloverMerchantId: string; autoAccept: boolean; doNotTouch: boolean };
/** The link form being shown: its draft id (one per store, per discovered Uber store, or 'new') and starting values. */
type OpenForm = { draftId: string; initial: Form };
type OrderManager = 'foodhub' | 'pending' | 'other' | 'unknown';
type Pick = { storeId: string; name: string; address?: string; brandName: string; locationCode: string; cloverMerchantId: string; orderManager?: OrderManager; include: boolean };
type CloverMerchant = { id: string; name: string | null; isDefault: boolean };
type UberResult = { ok: boolean; message: string; orderManager?: OrderManager | null };
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
  const [results, setResults] = useState<Record<string, UberResult>>({});
  const [cloverMerchants, setCloverMerchants] = useState<CloverMerchant[]>([]);
  const [checks, setChecks] = useState<Record<string, UberResult & { integrationEnabled?: boolean | null }>>({});
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
    api<{ stores: Array<{ id: string; name: string; address?: string; suggestedBrand?: string; suggestedLocation?: string; suggestedClover?: string; orderManager?: OrderManager }>; error: string | null; active: boolean; cloverMerchants?: CloverMerchant[] }>(`/api/foodhub/uber-connect/session?id=${id}`)
      .then((d) => {
        if (d.error) toast.error(d.error);
        setCloverMerchants(d.cloverMerchants ?? []);
        setPicks(d.stores.map((x) => ({ storeId: x.id, name: x.name, address: x.address, brandName: x.suggestedBrand || '', locationCode: x.suggestedLocation || '', cloverMerchantId: x.suggestedClover || '', orderManager: x.orderManager, include: Boolean(x.suggestedBrand && x.suggestedLocation) })));
      })
      .catch((e) => toast.error(e.message));
  }, [params, toast]);

  const blank = (): Form => ({ channel: 'uber_eats', channelStoreId: '', brandName: brands[0] ?? '', locationCode: locations[0]?.code ?? '', cloverMerchantId: '', autoAccept: true, doNotTouch: false });

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
      const d = await api<{ results: Array<{ storeId: string } & UberResult> }>('/api/foodhub/uber-connect/activate', { method: 'POST', json: { id: connectId, stores: chosen.map((p) => ({ storeId: p.storeId, brandName: p.brandName, locationCode: p.locationCode, cloverMerchantId: p.cloverMerchantId || undefined })) } });
      setResults(Object.fromEntries(d.results.map((r) => [r.storeId, r])));
      const okN = d.results.filter((r) => r.ok).length;
      const elsewhere = d.results.filter((r) => r.orderManager === 'other').length;
      if (okN === d.results.length && !elsewhere) toast.success(t(`${okN}/${d.results.length} magasin(s) Uber activé(s)`, `${okN}/${d.results.length} Uber store(s) activated`));
      else toast.warn(t(`${okN}/${d.results.length} activé(s)${elsewhere ? ` — ${elsewhere} encore chez UrbanPiper` : ''}`, `${okN}/${d.results.length} activated${elsewhere ? ` — ${elsewhere} still on UrbanPiper` : ''}`), t('Le détail est sous chaque magasin.', 'Details are under each store.'));
      window.history.replaceState(null, '', '/stores/mapping');
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  /** "Check with Uber": who receives each store's orders now; enable = also switch the order webhooks on where off. */
  async function checkUber(enable = false) {
    setBusy(enable ? 'enable' : 'check');
    try {
      const d = await api<{ rows: Array<{ storeId: string; integrationEnabled: boolean | null } & UberResult> }>('/api/foodhub/uber-connect/check', { method: 'POST', json: { enable } });
      setChecks(Object.fromEntries(d.rows.map((r) => [r.storeId, r])));
      const mine = d.rows.filter((r) => r.orderManager === 'foodhub').length;
      toast.info(t(`${mine}/${d.rows.length} magasin(s) Uber envoient leurs commandes à Food Hub`, `${mine}/${d.rows.length} Uber store(s) send their orders to Food Hub`));
      load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
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
          <CardHeader icon={<PlatformMark channel="uber_eats" size="sm" />} title={t(`Magasins de votre compte Uber Eats (${picks.length})`, `Stores on your Uber Eats account (${picks.length})`)} subtitle={t('Marque, succursale et caisse Clover pré-remplies d’après le nom et l’adresse Uber — vérifiez, puis activez. Un magasin encore chez UrbanPiper peut être activé : ses commandes passent à Food Hub quand UrbanPiper le libère.', 'Brand, location and Clover register pre-filled from the Uber name and address — check, then activate. A store still on UrbanPiper can be activated: its orders move to Food Hub once UrbanPiper lets it go.')}
            right={<Hint id="mapping.activate"><Button variant="brand" loading={busy === 'activate'} disabled={!picks.some((p) => p.include)} onClick={activate}>{t('Activer et relier', 'Activate & link')}</Button></Hint>} />
          <Table>
            <thead><tr><Th /><Th>{t('Magasin Uber', 'Uber store')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Succursale', 'Location')}</Th><Th>Clover</Th><Th>{t('Commandes vont à', 'Orders go to')}</Th><Th /></tr></thead>
            <tbody>{picks.map((p, i) => {
              const upd = (patch: Partial<Pick>) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const r = results[p.storeId];
              return (<Fragment key={p.storeId}>
                <Tr>
                  <Td><input type="checkbox" className="size-4" checked={p.include} onChange={(e) => upd({ include: e.target.checked })} /></Td>
                  <Td><div className="font-semibold">{p.name}</div><div className="text-xs text-ink-3">{p.address}</div></Td>
                  <Td><Select selectSize="sm" value={p.brandName} onChange={(e) => upd({ brandName: e.target.value })}><option value="">—</option>{brands.map((b) => <option key={b}>{b}</option>)}</Select></Td>
                  <Td><Select selectSize="sm" value={p.locationCode} onChange={(e) => upd({ locationCode: e.target.value })}><option value="">—</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Td>
                  <Td><Select selectSize="sm" value={p.cloverMerchantId} onChange={(e) => upd({ cloverMerchantId: e.target.value })} aria-label="Clover"><option value="">{t('par défaut', 'default')}</option>{cloverMerchants.map((m) => <option key={m.id} value={m.id}>{m.name ? `${m.name} · ${m.id}` : m.id}{m.isDefault ? t(' (défaut)', ' (default)') : ''}</option>)}</Select></Td>
                  <Td><ManagerBadge value={r?.orderManager ?? p.orderManager} /></Td>
                  <Td>{r && <Badge tone={r.ok ? (r.orderManager === 'other' ? 'wait' : 'go') : 'stop'} title={r.message}>{r.ok ? t('activé', 'activated') : t('échec', 'failed')}</Badge>}</Td>
                </Tr>
                {r && <tr><td colSpan={7} className={`px-4 pb-3 text-xs ${r.ok ? 'text-ink-2' : 'text-stop-2'}`}>{r.message}</td></tr>}
              </Fragment>);
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
        <CardHeader title={t(`Magasins branchés (${shown.length})`, `Connected stores (${shown.length})`)} right={<>
          <Button variant="outline" size="sm" loading={busy === 'check'} onClick={() => checkUber(false)} icon={<ShieldCheck className="size-4" />}>{t('Vérifier chez Uber', 'Check with Uber')}</Button>
          {Object.values(checks).some((c) => c.integrationEnabled === false) && <Button variant="brand" size="sm" loading={busy === 'enable'} onClick={() => checkUber(true)}>{t('Activer les commandes Uber', 'Switch Uber orders on')}</Button>}
          <Button variant="outline" size="sm" loading={busy === 'discover'} onClick={discover} icon={<Radar className="size-4" />}>{t('Découvrir les magasins Uber', 'Discover Uber stores')}</Button>
        </>} />
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
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={st.tone}>{stateText(t, st.state)}</Badge>
                        {s.channel === 'uber_eats' && <ManagerBadge value={(checks[s.id]?.orderManager ?? (s.meta?.uberPos as { orderManager?: OrderManager } | undefined)?.orderManager) || undefined} title={checks[s.id]?.message} />}
                        {s.meta?.doNotTouch === true && <Badge tone="neutral" title={t('Food Hub n’envoie ni menu ni rupture à ce magasin.', 'Food Hub sends this store no menu and no 86.')}>{t('ne pas toucher', 'do not touch')}</Badge>}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" onClick={() => setForm({ draftId: formDraftId('store-link', s.id), initial: { id: s.id, channel: s.channel, channelStoreId: s.channelStoreId, brandName: s.brandName, locationCode: s.locationCode, cloverMerchantId: s.cloverMerchantId ?? '', autoAccept: s.autoAccept, doNotTouch: s.meta?.doNotTouch === true } })} aria-label={t('Modifier', 'Edit')}><Pencil className="size-4" /></button>
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

/** Who receives an Uber store's orders (from Uber's pos_data): Food Hub, pending, or still another integration. */
function ManagerBadge({ value, title }: { value?: OrderManager | null; title?: string }) {
  const { t } = useI18n();
  if (!value || value === 'unknown') return title ? <Badge tone="neutral" title={title}>{t('non confirmé', 'not confirmed')}</Badge> : <span className="text-xs text-ink-3">—</span>;
  if (value === 'foodhub') return <Badge tone="go" title={title}>Food Hub ✓</Badge>;
  if (value === 'pending') return <Badge tone="wait" title={title}>{t('vers Food Hub (en cours)', 'moving to Food Hub')}</Badge>;
  return <Badge tone="stop" title={title ?? t('Une autre intégration (UrbanPiper) reçoit encore les commandes.', 'Another integration (UrbanPiper) still receives the orders.')}>{t('autre intégration (UrbanPiper)', 'other integration (UrbanPiper)')}</Badge>;
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
        <Switch checked={Boolean(form.doNotTouch)} onChange={(v) => setForm({ ...form, doNotTouch: v })} label={t('Ne pas toucher au menu de ce magasin', 'Do not touch this store’s menu')} description={t('Food Hub ne lui envoie jamais de menu, d’heures de fériés ni de rupture (ex. : encore chez UrbanPiper, menu spécial). Les commandes et la pause continuent.', 'Food Hub never sends it a menu, holiday hours or an 86 (e.g. still on UrbanPiper, a special menu). Orders and pause keep working.')} />
        {form.channel === 'tgtg' && <Banner tone="info">{t('Too Good To Go n’a pas d’API publique : TAKATAK reçoit seulement ce que TGTG envoie.', 'Too Good To Go has no public API: TAKATAK only receives what TGTG sends.')}</Banner>}
      </div>
    </Modal>
  );
}
