'use client';

// Commission plans — what each platform keeps, per platform and per store.
// One document that saves by itself (no Save button): every change is kept on this screen at once and sent shortly
// after; each save re-checks the orders against the new plans. ⌘Z / ↶ undoes; a removed store comes back with "Undo".
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { DraftRestoredBanner, SaveChip } from '@/components/ui/save-chip';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { Hint } from '@/components/help/hint';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { CH_NAME, MoneyHead } from '../money-ui';
import { api } from '@/lib/ui/api';
import { cn } from '@/lib/ui/cn';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';

/** A number field as typed: '' = emptied while typing (never saved as 0 by accident — validate() holds the save). */
type Num = number | '';
type Plan = { plan: string; deliveryPct: Num; pickupPct: Num; fixedFee: Num; taxOnFeesPct: Num; payoutLagDays: Num };
type Fees = { channels: Record<string, Plan>; stores: Record<string, Partial<Plan>>; confirmed: Record<string, boolean>; tolerance: Num };
type Loaded = Fees & { updatedAt?: string };
type Preset = { plan: string; deliveryPct: number; pickupPct: number; note?: string; noteFr?: string };
type Store = { id: string; channel: string; brandName: string; locationCode: string; channelStoreId: string };
type NumKey = 'deliveryPct' | 'pickupPct' | 'fixedFee' | 'taxOnFeesPct' | 'payoutLagDays';

/** The part of the saved plans this screen edits (updatedAt is the server's). */
const editableOf = (f: Loaded): Fees => ({ channels: f.channels ?? {}, stores: f.stores ?? {}, confirmed: f.confirmed ?? {}, tolerance: f.tolerance });
/** Empty, not a number, outside [min, max], or not whole when it must be. Same limits as the server (recon/fees). */
const bad = (v: Num | undefined, min: number, max: number, whole = false) => v === '' || v === undefined || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v));
const num = (v: string): Num => (v === '' ? '' : Number(v));
const opt = (v: Num | undefined) => (v === '' ? undefined : v);

export default function FeesPage() {
  const { t, loc } = useI18n();
  const { viewer, can, locName } = useViewer();
  const toast = useToast();
  const edit = can('finance:edit');
  const [fees, setFees] = useState<Fees | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [presets, setPresets] = useState<Record<string, Preset[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notesFr, setNotesFr] = useState<Record<string, string>>({});
  const [stores, setStores] = useState<Store[]>([]);
  const [err, setErr] = useState('');
  const [addFor, setAddFor] = useState('');

  const storeLabel = (id: string) => { const s = stores.find((x) => x.id === id); return s ? `${s.brandName} · ${shortLoc(locName(s.locationCode))}` : id; };
  const storeChannel = (id: string) => stores.find((x) => x.id === id)?.channel ?? '';

  // What is wrong with one platform's plan: shown under the field and in the save chip; the save waits until it is fixed.
  const planErrors = (p: Plan): Partial<Record<NumKey, string>> => {
    const e: Partial<Record<NumKey, string>> = {};
    if (bad(p.deliveryPct, 0, 100)) e.deliveryPct = t('Commission livraison entre 0 et 100 %', 'Delivery commission must be 0–100%');
    if (bad(p.pickupPct, 0, 100)) e.pickupPct = t('Commission à emporter entre 0 et 100 %', 'Pickup commission must be 0–100%');
    if (bad(p.fixedFee, 0, Infinity)) e.fixedFee = t('Frais fixes de 0 $ ou plus', 'Fixed fee must be $0 or more');
    if (bad(p.taxOnFeesPct, 0, 30)) e.taxOnFeesPct = t('Taxes sur frais entre 0 et 30 %', 'Tax on fees must be 0–30%');
    if (bad(p.payoutLagDays, 1, 200, true)) e.payoutLagDays = t('Jours : nombre entier de 1 à 200', 'Days: a whole number from 1 to 200');
    return e;
  };
  const storeRateBad = (v: Num | undefined) => v !== undefined && bad(v, 0, 100);
  const validate = (f: Fees) => [
    ...Object.entries(f.channels).flatMap(([ch, p]) => Object.values(planErrors(p)).map((m) => `${CH_NAME[ch] ?? ch} — ${m}`)),
    ...Object.entries(f.stores).filter(([, o]) => storeRateBad(o.deliveryPct) || storeRateBad(o.pickupPct)).map(([id]) => `${storeLabel(id)} — ${t('taux entre 0 et 100 %', 'rates must be 0–100%')}`),
    ...(bad(f.tolerance, 0, 5) ? [t('Tolérance entre 0 et 5 $', 'Tolerance must be $0 to $5')] : []),
  ];

  // Autosave: no Save button. Every save re-checks 90 days of orders (it can open and close dispute cases), so this screen
  // waits for a 2 s pause and never forces a save in the middle of typing (the usual 5 s cap would send a half-typed
  // rate such as "2" on the way to "25"). The local draft still keeps every keystroke.
  const autosave = useAutosave<Fees>({
    formKey: 'fees', user: viewer.username, value: fees, enabled: edit, validate, debounceMs: 2000, maxWaitMs: 30_000,
    save: async (f) => {
      const r = await api<{ fees: Loaded; cases: { opened: number; closed: number } | null }>('/api/foodhub/recon/fees', { method: 'PUT', json: { fees: f } });
      setUpdatedAt(r.fees.updatedAt ?? new Date().toISOString());
      if (r.cases && (r.cases.opened || r.cases.closed)) toast.info(t('Commandes revérifiées', 'Orders re-checked'), `${r.cases.opened} ${t('nouveau(x) problème(s)', 'new problem(s)')}, ${r.cases.closed} ${t('fermé(s)', 'closed')}`);
    },
    onRestore: (draft) => setFees(draft),
  });
  const undo = useUndo<Fees>(fees, (f) => setFees(f), { enabled: edit });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;

  const load = useCallback(() => api<{ fees: Loaded; presets: Record<string, Preset[]>; notes: Record<string, string>; notesFr?: Record<string, string>; stores: Store[] }>('/api/foodhub/recon/fees')
    .then((d) => {
      const f = editableOf(d.fees);
      setFees(f); setUpdatedAt(d.fees.updatedAt ?? null); setPresets(d.presets); setNotes(d.notes); setNotesFr(d.notesFr ?? {}); setStores(d.stores); setErr('');
      markLoaded(f); resetUndo();
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [markLoaded, resetUndo]);
  useEffect(() => { load(); }, [load]);
  // A removed store's "Undo" only works while this screen is open: leaving the screen closes that toast instead of
  // leaving a button that would silently do nothing (the removal was already sent on the way out).
  const undoToasts = useRef<number[]>([]);
  useEffect(() => { const ids = undoToasts.current; return () => { for (const id of ids.splice(0)) toast.dismiss(id); }; }, [toast]);

  const head = (right?: React.ReactNode) => <MoneyHead title={t('Plans de commission', 'Commission plans')} intro={t('Les paiements attendus sont calculés avec ces plans. Ils partent des grilles canadiennes publiées (Uber Eats et DoorDash) ; SkipTheDishes et Too Good To Go ne publient pas les leurs, entrez donc les taux de vos ententes. Cochez « conforme à mon contrat » une fois vérifié — d’ici là, les écarts sont signalés comme non confirmés.', 'Expected payouts are calculated from these plans. They start from the platforms’ published Canadian rate cards (Uber Eats and DoorDash); SkipTheDishes and Too Good To Go do not publish theirs, so enter the rates from your agreements. Tick “matches my contract” once checked — until then differences are flagged as unconfirmed.')} right={right} />;
  if (!fees) return <div>{head()}{err ? <Banner tone="stop">{err}</Banner> : <div className="h-96 animate-pulse rounded-lg bg-sunken" />}</div>;

  const patch = (fn: (f: Fees) => Fees) => setFees((f) => (f ? fn(f) : f));
  const setPlan = (ch: string, p: Partial<Plan>) => patch((f) => ({ ...f, channels: { ...f.channels, [ch]: { ...f.channels[ch], ...p } } }));
  const setStore = (id: string, p: Partial<Plan>) => patch((f) => ({ ...f, stores: { ...f.stores, [id]: { ...(f.stores[id] ?? {}), ...p } } }));

  /** Removal applied at once, with 6 s to take it back (no "are you sure?" question). */
  function removeStore(id: string) {
    const row = fees?.stores[id];
    const at = Object.keys(fees?.stores ?? {}).indexOf(id);
    patch((f) => { const s = { ...f.stores }; delete s[id]; return { ...f, stores: s }; });
    if (row) undoToasts.current.push(toast.undo(t(`${storeLabel(id)} suit de nouveau le plan de la plateforme`, `${storeLabel(id)} follows the platform plan again`), () => patch((f) => {
      if (f.stores[id]) return f;
      const rows = Object.entries(f.stores);
      rows.splice(Math.max(0, at), 0, [id, row]);
      return { ...f, stores: Object.fromEntries(rows) };
    })));
  }

  return (
    <div className="pb-20">
      {head(edit ? <SaveChip autosave={autosave} undo={undo} /> : undefined)}
      {autosave.draftRestored && <DraftRestoredBanner onDiscard={autosave.discardDraft} />}
      {autosave.problems.length > 0 && <Banner tone="warn" className="mb-4">{autosave.problems.slice(0, 4).join(' · ')}</Banner>}
      {autosave.status === 'error' && autosave.error && <Banner tone="stop" className="mb-4">{autosave.error}</Banner>}
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Object.entries(fees.channels).map(([ch, p]) => {
          const preset = presets[ch]?.find((x) => x.plan === p.plan);
          const pe = edit ? planErrors(p) : {};
          return (
            <Card key={ch} className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5"><PlatformTag channel={ch} /><span className="text-xs text-ink-3">{p.plan}</span></div>
                <Hint id="fees.confirm"><Switch size="sm" checked={!!fees.confirmed[ch]} disabled={!edit} onChange={(v) => patch((f) => ({ ...f, confirmed: { ...f.confirmed, [ch]: v } }))} label={t('Conforme à mon contrat', 'Matches my contract')} /></Hint>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label={t('Plan', 'Plan')} className="col-span-2 sm:col-span-3">
                  <Hint id="fees.plan"><Select value={preset ? p.plan : '__custom'} disabled={!edit} onChange={(e) => {
                    const pr = presets[ch]?.find((x) => x.plan === e.target.value);
                    setPlan(ch, pr ? { plan: pr.plan, deliveryPct: pr.deliveryPct, pickupPct: pr.pickupPct } : { plan: 'Custom' });
                  }}>
                    {(presets[ch] ?? []).map((x) => <option key={x.plan} value={x.plan}>{x.plan} — {x.deliveryPct} % / {x.pickupPct} %</option>)}
                    <option value="__custom">{t('Personnalisé (mon contrat)', 'Custom (my contract)')}</option>
                  </Select></Hint>
                </Field>
                <Field label={t('Commission livraison %', 'Delivery commission %')} error={pe.deliveryPct}><Input type="number" inputMode="decimal" min={0} max={100} step={0.1} value={p.deliveryPct} disabled={!edit} onChange={(e) => setPlan(ch, { deliveryPct: num(e.target.value) })} /></Field>
                <Field label={t('Commission à emporter %', 'Pickup commission %')} error={pe.pickupPct}><Input type="number" inputMode="decimal" min={0} max={100} step={0.1} value={p.pickupPct} disabled={!edit} onChange={(e) => setPlan(ch, { pickupPct: num(e.target.value) })} /></Field>
                <Field label={t('Frais fixes / commande ($)', 'Fixed fee per order ($)')} error={pe.fixedFee}><Input type="number" inputMode="decimal" min={0} step={0.01} value={p.fixedFee} disabled={!edit} onChange={(e) => setPlan(ch, { fixedFee: num(e.target.value) })} /></Field>
                <Field label={t('Taxes sur frais %', 'Tax charged on fees %')} error={pe.taxOnFeesPct}><Input type="number" inputMode="decimal" min={0} max={30} step={0.001} value={p.taxOnFeesPct} disabled={!edit} onChange={(e) => setPlan(ch, { taxOnFeesPct: num(e.target.value) })} /></Field>
                <Field label={t('Absente après (jours)', 'Flag missing after (days)')} error={pe.payoutLagDays}><Input type="number" inputMode="numeric" min={1} max={200} step={1} value={p.payoutLagDays} disabled={!edit} onChange={(e) => setPlan(ch, { payoutLagDays: num(e.target.value) })} /></Field>
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
                <Td><Input inputSize="sm" className="w-32" maxLength={40} value={o.plan ?? ''} disabled={!edit} onChange={(e) => setStore(id, { plan: e.target.value })} placeholder="ex. Plus" /></Td>
                <Td><Input inputSize="sm" className={cn('w-24', edit && storeRateBad(o.deliveryPct) && 'border-stop')} aria-invalid={edit && storeRateBad(o.deliveryPct)} type="number" inputMode="decimal" min={0} max={100} step={0.1} value={o.deliveryPct ?? ''} disabled={!edit} onChange={(e) => setStore(id, { deliveryPct: e.target.value === '' ? undefined : Number(e.target.value) })} /></Td>
                <Td><Input inputSize="sm" className={cn('w-24', edit && storeRateBad(o.pickupPct) && 'border-stop')} aria-invalid={edit && storeRateBad(o.pickupPct)} type="number" inputMode="decimal" min={0} max={100} step={0.1} value={o.pickupPct ?? ''} disabled={!edit} onChange={(e) => setStore(id, { pickupPct: e.target.value === '' ? undefined : Number(e.target.value) })} /></Td>
                <Td align="right">{edit && <Button size="xs" variant="ghost" onClick={() => removeStore(id)} icon={<Trash2 className="size-3.5" />}>{t('Retirer', 'Remove')}</Button>}</Td>
              </Tr>
            ))}
            {Object.keys(fees.stores).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-3">{t('Chaque magasin utilise le plan de sa plateforme.', 'Every store uses its platform plan.')}</td></tr>}
          </tbody>
        </Table>
        {edit && (
          <Hint id="fees.stores"><div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
            <Select selectSize="sm" className="max-w-md" value={addFor} onChange={(e) => setAddFor(e.target.value)} aria-label={t('Magasin', 'Store')}>
              <option value="">{t('Ajouter un magasin…', 'Add a store…')}</option>
              {stores.filter((s) => !fees.stores[s.id]).sort((a, b) => `${a.channel}${storeLabel(a.id)}`.localeCompare(`${b.channel}${storeLabel(b.id)}`)).map((s) => <option key={s.id} value={s.id}>{CH_NAME[s.channel] ?? s.channel} · {storeLabel(s.id)}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={!addFor} icon={<Plus className="size-4" />} onClick={() => { const base = fees.channels[storeChannel(addFor)]; setStore(addFor, { plan: base?.plan, deliveryPct: opt(base?.deliveryPct), pickupPct: opt(base?.pickupPct) }); setAddFor(''); }}>{t('Ajouter', 'Add')}</Button>
          </div></Hint>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-base font-extrabold">{t('Tolérance', 'Matching tolerance')}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {t('Un paiement à moins de', 'A payout within')}
          <Hint id="fees.tolerance"><Input inputSize="sm" className={cn('w-24', edit && bad(fees.tolerance, 0, 5) && 'border-stop')} aria-invalid={edit && bad(fees.tolerance, 0, 5)} aria-label={t('Tolérance ($)', 'Tolerance ($)')} type="number" inputMode="decimal" min={0} max={5} step={0.01} value={fees.tolerance} disabled={!edit} onChange={(e) => { const v = num(e.target.value); patch((f) => ({ ...f, tolerance: v })); }} /></Hint>
          {t('$ du montant attendu compte comme « payée comme prévu » (arrondis des taxes et frais).', '$ of the expected amount counts as “paid as expected” (rounding of taxes and fees).')}
        </div>
        <p className="mt-2 text-xs text-ink-3">{t('Les litiges ne sont ouverts que pour 1,00 $ ou plus.', 'Dispute cases are only opened for $1.00 or more.')}{updatedAt ? ` ${t('Dernier enregistrement', 'Last saved')} ${new Date(updatedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</p>
      </Card>
    </div>
  );
}
