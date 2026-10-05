'use client';

// Commission plans — what each platform keeps, per platform and per store.
import { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { CH_NAME, MoneyHead } from '../money-ui';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Plan = { plan: string; deliveryPct: number; pickupPct: number; fixedFee: number; taxOnFeesPct: number; payoutLagDays: number };
type Fees = { channels: Record<string, Plan>; stores: Record<string, Partial<Plan>>; confirmed: Record<string, boolean>; tolerance: number; updatedAt?: string };
type Preset = { plan: string; deliveryPct: number; pickupPct: number; note?: string; noteFr?: string };
type Store = { id: string; channel: string; brandName: string; locationCode: string; channelStoreId: string };

export default function FeesPage() {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const edit = can('finance:edit');
  const [fees, setFees] = useState<Fees | null>(null);
  const [presets, setPresets] = useState<Record<string, Preset[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notesFr, setNotesFr] = useState<Record<string, string>>({});
  const [stores, setStores] = useState<Store[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addFor, setAddFor] = useState('');

  const load = useCallback(() => api<{ fees: Fees; presets: Record<string, Preset[]>; notes: Record<string, string>; notesFr?: Record<string, string>; stores: Store[] }>('/api/foodhub/recon/fees')
    .then((d) => { setFees(d.fees); setPresets(d.presets); setNotes(d.notes); setNotesFr(d.notesFr ?? {}); setStores(d.stores); setErr(''); setDirty(false); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);

  const head = (right?: React.ReactNode) => <MoneyHead title={t('Plans de commission', 'Commission plans')} intro={t('Les paiements attendus sont calculés avec ces plans. Ils partent des grilles canadiennes publiées (Uber Eats et DoorDash) ; SkipTheDishes et Too Good To Go ne publient pas les leurs, entrez donc les taux de vos ententes. Cochez « conforme à mon contrat » une fois vérifié — d’ici là, les écarts sont signalés comme non confirmés.', 'Expected payouts are calculated from these plans. They start from the platforms’ published Canadian rate cards (Uber Eats and DoorDash); SkipTheDishes and Too Good To Go do not publish theirs, so enter the rates from your agreements. Tick “matches my contract” once checked — until then differences are flagged as unconfirmed.')} right={right} />;
  if (!fees) return <div>{head()}{err ? <Banner tone="stop">{err}</Banner> : <div className="h-96 animate-pulse rounded-lg bg-sunken" />}</div>;

  const change = (f: Fees) => { setFees(f); setDirty(true); };
  const setPlan = (ch: string, p: Partial<Plan>) => change({ ...fees, channels: { ...fees.channels, [ch]: { ...fees.channels[ch], ...p } } });
  const setStore = (id: string, p: Partial<Plan> | null) => { const s = { ...fees.stores }; if (p) s[id] = { ...(s[id] ?? {}), ...p }; else delete s[id]; change({ ...fees, stores: s }); };
  const storeLabel = (id: string) => { const s = stores.find((x) => x.id === id); return s ? `${s.brandName} · ${shortLoc(locName(s.locationCode))}` : id; };
  const storeChannel = (id: string) => stores.find((x) => x.id === id)?.channel ?? '';
  const num = (v: string) => (v === '' ? 0 : Number(v));

  async function save() {
    if (!fees) return;
    setBusy(true);
    try {
      const r = await api<{ fees: Fees; cases: { opened: number; closed: number } | null }>('/api/foodhub/recon/fees', { method: 'PUT', json: { fees } });
      setFees(r.fees); setDirty(false);
      toast.success(t('Plans enregistrés — commandes revérifiées', 'Plans saved — orders re-checked'), r.cases ? `${r.cases.opened} ${t('nouveau(x) problème(s)', 'new problem(s)')}, ${r.cases.closed} ${t('fermé(s)', 'closed')}` : undefined);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="pb-20">
      {head(edit ? <Button loading={busy} disabled={!dirty} onClick={save} icon={<Save className="size-4" />}>{t('Enregistrer', 'Save plans')}</Button> : undefined)}
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Object.entries(fees.channels).map(([ch, p]) => {
          const preset = presets[ch]?.find((x) => x.plan === p.plan);
          return (
            <Card key={ch} className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5"><PlatformTag channel={ch} /><span className="text-xs text-ink-3">{p.plan}</span></div>
                <Switch size="sm" checked={!!fees.confirmed[ch]} disabled={!edit} onChange={(v) => change({ ...fees, confirmed: { ...fees.confirmed, [ch]: v } })} label={t('Conforme à mon contrat', 'Matches my contract')} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label={t('Plan', 'Plan')} className="col-span-2 sm:col-span-3">
                  <Select value={preset ? p.plan : '__custom'} disabled={!edit} onChange={(e) => {
                    const pr = presets[ch]?.find((x) => x.plan === e.target.value);
                    setPlan(ch, pr ? { plan: pr.plan, deliveryPct: pr.deliveryPct, pickupPct: pr.pickupPct } : { plan: 'Custom' });
                  }}>
                    {(presets[ch] ?? []).map((x) => <option key={x.plan} value={x.plan}>{x.plan} — {x.deliveryPct} % / {x.pickupPct} %</option>)}
                    <option value="__custom">{t('Personnalisé (mon contrat)', 'Custom (my contract)')}</option>
                  </Select>
                </Field>
                <Field label={t('Commission livraison %', 'Delivery commission %')}><Input type="number" min={0} max={100} step={0.1} value={p.deliveryPct} disabled={!edit} onChange={(e) => setPlan(ch, { deliveryPct: num(e.target.value) })} /></Field>
                <Field label={t('Commission à emporter %', 'Pickup commission %')}><Input type="number" min={0} max={100} step={0.1} value={p.pickupPct} disabled={!edit} onChange={(e) => setPlan(ch, { pickupPct: num(e.target.value) })} /></Field>
                <Field label={t('Frais fixes / commande ($)', 'Fixed fee per order ($)')}><Input type="number" min={0} step={0.01} value={p.fixedFee} disabled={!edit} onChange={(e) => setPlan(ch, { fixedFee: num(e.target.value) })} /></Field>
                <Field label={t('Taxes sur frais %', 'Tax charged on fees %')}><Input type="number" min={0} max={30} step={0.001} value={p.taxOnFeesPct} disabled={!edit} onChange={(e) => setPlan(ch, { taxOnFeesPct: num(e.target.value) })} /></Field>
                <Field label={t('Absente après (jours)', 'Flag missing after (days)')}><Input type="number" min={1} max={200} step={1} value={p.payoutLagDays} disabled={!edit} onChange={(e) => setPlan(ch, { payoutLagDays: num(e.target.value) })} /></Field>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-3">{t(notesFr[ch] ?? notes[ch], notes[ch])}{preset?.note ? ` ${t(preset.noteFr ?? preset.note, preset.note)}.` : ''} {t('Au Québec, les taxes sur frais = TPS 5 % + TVQ 9,975 % = 14,975 %, récupérables (CTI/RTI).', 'Tax on fees in Quebec is GST 5% + QST 9.975% = 14.975%, recoverable as input tax credits.')}</p>
            </Card>
          );
        })}
      </div>

      <Card className="mb-5">
        <CardHeader title={t('Magasins avec un autre taux', 'Stores with a different rate')} subtitle={t('Certaines marques ou succursales peuvent avoir un autre plan (période promo, autre contrat). Ces taux remplacent le plan de la plateforme pour ce magasin seulement.', 'Some brands or locations can be on another plan (a promotion period, a different contract). Rates here replace the platform plan for that store only.')} />
        <Table>
          <thead><tr><Th>{t('Magasin', 'Store')}</Th><Th>{t('Nom du plan', 'Plan name')}</Th><Th>{t('Livraison %', 'Delivery %')}</Th><Th>{t('À emporter %', 'Pickup %')}</Th><Th /></tr></thead>
          <tbody>
            {Object.entries(fees.stores).map(([id, o]) => (
              <Tr key={id}>
                <Td><div className="flex items-center gap-2"><PlatformTag channel={storeChannel(id)} /><span className="text-ink-2">{storeLabel(id)}</span></div></Td>
                <Td><Input inputSize="sm" className="w-32" value={o.plan ?? ''} disabled={!edit} onChange={(e) => setStore(id, { plan: e.target.value })} placeholder="ex. Plus" /></Td>
                <Td><Input inputSize="sm" className="w-24" type="number" min={0} max={100} step={0.1} value={o.deliveryPct ?? ''} disabled={!edit} onChange={(e) => setStore(id, { deliveryPct: e.target.value === '' ? undefined : Number(e.target.value) })} /></Td>
                <Td><Input inputSize="sm" className="w-24" type="number" min={0} max={100} step={0.1} value={o.pickupPct ?? ''} disabled={!edit} onChange={(e) => setStore(id, { pickupPct: e.target.value === '' ? undefined : Number(e.target.value) })} /></Td>
                <Td align="right">{edit && <Button size="xs" variant="ghost" onClick={() => setStore(id, null)} icon={<Trash2 className="size-3.5" />}>{t('Retirer', 'Remove')}</Button>}</Td>
              </Tr>
            ))}
            {Object.keys(fees.stores).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-3">{t('Chaque magasin utilise le plan de sa plateforme.', 'Every store uses its platform plan.')}</td></tr>}
          </tbody>
        </Table>
        {edit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
            <Select selectSize="sm" className="max-w-md" value={addFor} onChange={(e) => setAddFor(e.target.value)} aria-label={t('Magasin', 'Store')}>
              <option value="">{t('Ajouter un magasin…', 'Add a store…')}</option>
              {stores.filter((s) => !fees.stores[s.id]).sort((a, b) => `${a.channel}${storeLabel(a.id)}`.localeCompare(`${b.channel}${storeLabel(b.id)}`)).map((s) => <option key={s.id} value={s.id}>{CH_NAME[s.channel] ?? s.channel} · {storeLabel(s.id)}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={!addFor} icon={<Plus className="size-4" />} onClick={() => { const base = fees.channels[storeChannel(addFor)]; setStore(addFor, { plan: base?.plan, deliveryPct: base?.deliveryPct, pickupPct: base?.pickupPct }); setAddFor(''); }}>{t('Ajouter', 'Add')}</Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-base font-extrabold">{t('Tolérance', 'Matching tolerance')}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {t('Un paiement à moins de', 'A payout within')}
          <Input inputSize="sm" className="w-24" type="number" min={0} max={5} step={0.01} value={fees.tolerance} disabled={!edit} onChange={(e) => change({ ...fees, tolerance: num(e.target.value) })} />
          {t('$ du montant attendu compte comme « payée comme prévu » (arrondis des taxes et frais).', '$ of the expected amount counts as “paid as expected” (rounding of taxes and fees).')}
        </div>
        <p className="mt-2 text-xs text-ink-3">{t('Les litiges ne sont ouverts que pour 1,00 $ ou plus.', 'Dispute cases are only opened for $1.00 or more.')}{fees.updatedAt ? ` ${t('Dernier enregistrement', 'Last saved')} ${new Date(fees.updatedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</p>
      </Card>

      {edit && dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center px-4 lg:bottom-6">
          <div className="flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-pop">
            {t('Modifications non enregistrées', 'Unsaved changes')}
            <Button size="sm" variant="brand" loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button>
            <button type="button" className="text-xs font-semibold text-canvas/70 hover:text-canvas" onClick={load}>{t('Annuler', 'Discard')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
