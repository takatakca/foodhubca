'use client';

// Too Good To Go — daily Surprise Bag log.
// TGTG has no public store API: bags are set in the TGTG Store app. Logging the day here puts TGTG
// in sales, analytics, reports and payout reconciliation — without double counting when real TGTG
// orders already arrive by webhook.
// A kitchen on Takatak MEV (Revenu Québec invoices): the day's count is a report, never a sale. Each bag gets its own
// invoice when the customer takes it: « Sac remis » records that one sale and prints its invoice right away.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, ReceiptText, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { FormDraftNote } from '@/components/ui/save-chip';
import { Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { StatTile, fmtInt } from '@/components/charts/charts';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { Hint } from '@/components/help/hint';
import { MoneyHead, cad } from '../money-ui';
import { api, ApiError, dayOf, downloadCsv, ymd } from '@/lib/ui/api';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';
import { MevBadge } from '@/components/live/mev-panel';
import { printedAt } from '@/lib/foodhub/mev/printable';
import type { MevRecord } from '@/lib/foodhub/mev/types';

type BagDay = { id: string; date: string; locationCode: string; bagsOffered: number; bagsSold: number; pricePerBag: number; note?: string; by: string; at: string; orderId: string | null; feedOrders: number; mev?: { invoicedBags: number; missingBags: number } | null };
type BagPickup = { id: string; locationCode: string; at: string; quantity: number; total: number; code?: string; mev: MevRecord | null; existing?: 'email' | 'pickup' };
/** Takatak MEV issued the receipt: there is a paper invoice to print. */
const issued = (m: MevRecord | null | undefined) => m?.status === 'accepted' || m?.status === 'offline';
const PRICE_KEY = 'takatak.tgtg.price';
type DayFields = { bagsOffered: string; bagsSold: string; pricePerBag: string; note: string };
/**
 * What the person typed for the chosen day (null = untouched). Only changes are kept in the draft, so a field nobody
 * touched follows the saved day (or the usual price) even if someone saved that day in the meantime.
 */
type DayChanges = { [K in keyof DayFields]: string | null };
const NO_DAY_CHANGE: DayChanges = { bagsOffered: null, bagsSold: null, pricePerBag: null, note: null };
const DAY_KEYS = Object.keys(NO_DAY_CHANGE) as Array<keyof DayFields>;

export default function TgtgPage() {
  const { t, loc } = useI18n();
  const { viewer, can, locations, locName } = useViewer();
  const toast = useToast();
  const [days, setDays] = useState<BagDay[]>([]);
  const [mevOn, setMevOn] = useState<Record<string, boolean>>({});
  const [pickups, setPickups] = useState<BagPickup[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Which day is in the form (date + location); what is typed for it is a draft kept on this device until "Save day".
  const [pick, setPick] = useState({ date: ymd(new Date()), locationCode: locations[0]?.code ?? '' });
  const [lastPrice, setLastPrice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const codes = locations.map((l) => l.code).join(',');
  const load = useCallback(() => {
    const from = new Date(); from.setDate(from.getDate() - 60);
    return api<{ days: BagDay[]; mev?: Record<string, boolean>; pickups?: BagPickup[] }>(`/api/foodhub/tgtg?from=${ymd(from)}&locations=${encodeURIComponent(codes)}`)
      .then((d) => { setDays(d.days); setMevOn(d.mev ?? {}); setPickups(d.pickups ?? []); setLoaded(true); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [codes]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPick((p) => (p.locationCode || !locations[0] ? p : { ...p, locationCode: locations[0].code })); }, [locations]);
  useEffect(() => { try { const p = window.localStorage.getItem(PRICE_KEY); if (p) setLastPrice(p); } catch { /* private mode */ } }, []);

  // The chosen day as saved (an existing day is edited in place), with the person's changes on top.
  const saved = days.find((x) => x.date === pick.date && x.locationCode === pick.locationCode);
  // A day not logged yet starts at the usual price: the last one saved on this tablet, else this location's latest day.
  const usualPrice = lastPrice || String(days.find((x) => x.locationCode === pick.locationCode && x.pricePerBag > 0)?.pricePerBag ?? '');
  const cur: DayFields = saved
    ? { bagsOffered: String(saved.bagsOffered), bagsSold: String(saved.bagsSold), pricePerBag: String(saved.pricePerBag), note: saved.note ?? '' }
    : { bagsOffered: '', bagsSold: '', pricePerBag: usualPrice, note: '' };
  const d = useFormDraft<DayChanges>(formDraftId('tgtg', `${pick.locationCode}.${pick.date}`), viewer.username, NO_DAY_CHANGE, { enabled: can('orders:act') });
  const form = { ...pick, bagsOffered: d.value.bagsOffered ?? cur.bagsOffered, bagsSold: d.value.bagsSold ?? cur.bagsSold, pricePerBag: d.value.pricePerBag ?? cur.pricePerBag, note: d.value.note ?? cur.note };
  const dirty = DAY_KEYS.some((k) => form[k] !== cur[k]);
  const put = (k: keyof DayFields, x: string) => d.set((p) => ({ ...p, [k]: x === cur[k] ? null : x }));
  /** Another day or location: what was typed for this one stays on this device for when you come back to it. */
  function choose(next: Partial<typeof pick>) {
    if (busy || ((next.date ?? pick.date) === pick.date && (next.locationCode ?? pick.locationCode) === pick.locationCode)) return;
    if (dirty) toast.info(t('Gardé — revenez à cette journée pour terminer', 'Kept — go back to that day to finish'));
    setPick((p) => ({ ...p, ...next }));
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ day: BagDay }>('/api/foodhub/tgtg', { method: 'POST', json: { ...form, bagsOffered: Number(form.bagsOffered || 0), bagsSold: Number(form.bagsSold), pricePerBag: Number(form.pricePerBag || 0) } });
      // Saved: the form now shows the day exactly as stored (the server rounds), and the draft is forgotten.
      setDays((ds) => [r.day, ...ds.filter((x) => x.id !== r.day.id)]);
      d.set(NO_DAY_CHANGE);
      d.clear();
      try { window.localStorage.setItem(PRICE_KEY, form.pricePerBag); } catch { /* ignore */ }
      setLastPrice(form.pricePerBag);
      if (r.day.mev?.missingBags) toast.warn(t(`${r.day.mev.missingBags} sac(s) sans facture`, `${r.day.mev.missingBags} bag(s) without an invoice`), t('Journée enregistrée pour les rapports. Ces sacs n’ont pas eu leur facture : le compte de la journée n’est pas envoyé à Revenu Québec. À chaque ramassage, touchez « Sac remis ».', 'Day saved for the reports. These bags did not get their invoice: the day’s count is not sent to Revenu Québec. At each pickup, tap “Bag handed over”.'), { durationMs: 12000 });
      else if (r.day.feedOrders) toast.info(t('Journée enregistrée', 'Day saved'), t(`${r.day.feedOrders} commande(s) Too Good To Go sont déjà arrivées par webhook ce jour-là : le journal est gardé mais pas compté deux fois.`, `${r.day.feedOrders} Too Good To Go order(s) already arrived by webhook that day, so the log is kept but not counted twice.`));
      else toast.success(t('Journée enregistrée', 'Day saved'), `${r.day.bagsSold} × ${cad(r.day.pricePerBag, loc)} = ${cad(r.day.bagsSold * r.day.pricePerBag, loc)} · ${shortLoc(locName(r.day.locationCode))}`);
      await load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const last7 = useMemo(() => { const from = new Date(); from.setDate(from.getDate() - 6); const f = ymd(from); return days.filter((d) => d.date >= f); }, [days]);
  const sold = last7.reduce((s, d) => s + d.bagsSold, 0);
  const offered = last7.reduce((s, d) => s + d.bagsOffered, 0);
  const sales = last7.filter((d) => !d.feedOrders).reduce((s, d) => s + d.bagsSold * d.pricePerBag, 0);
  const total = form.bagsSold !== '' && form.pricePerBag !== '' ? Number(form.bagsSold) * Number(form.pricePerBag) : null;

  return (
    <div>
      <MoneyHead title="Too Good To Go" intro={t('Too Good To Go n’a pas d’API magasin publique — les quantités se règlent dans l’app TGTG Store. Entrez les sacs du jour ici (10 secondes à la fermeture) et ils comptent dans les ventes, les analyses, les rapports et la vérification des paiements. Si des commandes TGTG arrivent déjà par une intégration, rien n’est compté deux fois.', 'Too Good To Go has no public store API — bag quantities are set in the TGTG Store app. Enter each day’s bags here (10 seconds at closing) and they count in sales, analytics, reports and payout checks. If TGTG orders already arrive through an integration, nothing is counted twice.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile hero label={t('Sacs vendus — 7 derniers jours', 'Bags sold — last 7 days')} value={fmtInt(sold)} note={offered ? `${Math.round((sold / offered) * 100)} % ${t('de', 'of')} ${fmtInt(offered)} ${t('offerts', 'offered')}` : t('aucune journée entrée', 'no day logged yet')} />
        <StatTile label={t('Ventes TGTG — 7 derniers jours', 'TGTG sales — last 7 days')} value={cad(sales, loc)} note={t('prix client, avant les frais TGTG', 'customer price, before TGTG’s fee')} />
        <StatTile label={t('Sacs invendus — 7 derniers jours', 'Unsold bags — last 7 days')} value={fmtInt(Math.max(0, offered - sold))} note={t('nourriture non sauvée', 'food that was not rescued')} />
      </div>

      {mevOn[pick.locationCode] && (
        <Banner tone="warn" className="mb-4">
          <strong>{t('Factures Revenu Québec (Takatak MEV) :', 'Revenu Québec invoices (Takatak MEV):')}</strong>{' '}
          {t('chaque sac doit avoir sa propre facture, remise au client quand il prend son sac. Le compte de la journée ne fait aucune facture et n’est pas envoyé à Revenu Québec : il sert aux rapports. À chaque ramassage, touchez « Sac remis » (ou branchez les courriels Too Good To Go dans Réglages → Canaux).', 'each bag needs its own invoice, handed to the customer when they take their bag. The day’s count makes no invoice and is not sent to Revenu Québec: it is for the reports. At each pickup, tap “Bag handed over” (or connect the Too Good To Go e-mails in Settings → Channels).')}
        </Banner>
      )}

      {can('orders:act') && mevOn[pick.locationCode] && (
        <PickupCard locationCode={pick.locationCode} locationLabel={shortLoc(locName(pick.locationCode))} usualPrice={usualPrice} pickups={pickups.filter((p) => p.locationCode === pick.locationCode)} onDone={load} />
      )}

      {can('orders:act') && (
        <Card className="mb-5 p-5">
          <div className="mb-4 flex items-center gap-2"><ShoppingBag className="size-5 text-[#00615f]" /><h2 className="text-base font-extrabold">{t('Entrer une journée', 'Log a day')}</h2></div>
          <FormDraftNote restored={d.restored && dirty} onDiscard={d.discard} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Hint id="tgtg.day"><Field label="Date"><Input type="date" value={form.date} max={ymd(new Date())} disabled={busy} onChange={(e) => choose({ date: e.target.value })} /></Field></Hint>
            <Field label={t('Succursale', 'Location')}>
              <Select value={form.locationCode} disabled={busy} onChange={(e) => choose({ locationCode: e.target.value })}>
                {locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}
              </Select>
            </Field>
            <Field label={t('Sacs offerts', 'Bags offered')}><Input type="number" inputMode="numeric" min={0} step={1} value={form.bagsOffered} disabled={busy} onChange={(e) => put('bagsOffered', e.target.value)} /></Field>
            <Hint id="tgtg.sold"><Field label={t('Sacs vendus (ramassés)', 'Bags sold (picked up)')}><Input type="number" inputMode="numeric" min={0} step={1} value={form.bagsSold} disabled={busy} onChange={(e) => put('bagsSold', e.target.value)} /></Field></Hint>
            <Field label={t('Prix client / sac ($)', 'Customer price / bag ($)')}><Input type="number" inputMode="decimal" min={0} step={0.01} value={form.pricePerBag} disabled={busy} onChange={(e) => put('pricePerBag', e.target.value)} /></Field>
            <Field label={t('Note', 'Note')}><Input value={form.note} maxLength={200} disabled={busy} onChange={(e) => put('note', e.target.value)} placeholder={t('optionnel', 'optional')} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Hint id="tgtg.save"><Button size="lg" loading={busy} disabled={!form.locationCode || form.bagsSold === ''} onClick={save}>{t('Enregistrer la journée', 'Save day')}</Button></Hint>
            {total !== null && Number.isFinite(total) && <span className="text-sm text-ink-2">= <strong className="text-ink">{cad(total, loc)}</strong> {t('en ventes Too Good To Go', 'in Too Good To Go sales')}</span>}
          </div>
        </Card>
      )}

      <Hint id="tgtg.history"><Card>
        <CardHeader title={t('60 derniers jours', 'Last 60 days')} right={<Button size="sm" variant="outline" disabled={!days.length} icon={<Download className="size-4" />} onClick={() => downloadCsv('tgtg-sacs', [
          [t('Date', 'Date'), t('Succursale', 'Location'), t('Offerts', 'Offered'), t('Vendus', 'Sold'), t('Prix', 'Price'), t('Ventes', 'Sales'), t('Compté dans les ventes', 'Counted as sales'), t('Sacs avec facture (MEV)', 'Bags with an invoice (MEV)'), t('Sacs sans facture (MEV)', 'Bags without an invoice (MEV)'), t('Note', 'Note'), t('Par', 'By')],
          ...days.map((d) => [d.date, d.locationCode, d.bagsOffered, d.bagsSold, d.pricePerBag.toFixed(2), (d.bagsSold * d.pricePerBag).toFixed(2), d.feedOrders ? t('non — commandes reçues par webhook', 'no — orders came by webhook') : d.bagsSold ? t('oui', 'yes') : t('non', 'no'), d.mev ? d.mev.invoicedBags : '', d.mev ? d.mev.missingBags : '', d.note ?? '', d.by]),
        ])}>CSV</Button>} />
        <Table>
          <thead><tr><Th>Date</Th><Th>{t('Succursale', 'Location')}</Th><Th align="right">{t('Offerts', 'Offered')}</Th><Th align="right">{t('Vendus', 'Sold')}</Th><Th align="right">{t('Prix', 'Price')}</Th><Th align="right">{t('Ventes', 'Sales')}</Th><Th>{t('Compté', 'Counted')}</Th><Th>{t('Facture', 'Invoice')}</Th><Th>{t('Note', 'Note')}</Th><Th>{t('Par', 'By')}</Th></tr></thead>
          <tbody>
            {days.map((d) => (
              <Tr key={d.id} className="cursor-pointer" onClick={() => choose({ date: d.date, locationCode: d.locationCode })}>
                <Td className="whitespace-nowrap">{dayOf(d.date, loc)}</Td><Td className="text-ink-2">{shortLoc(locName(d.locationCode))}</Td>
                <Td align="right">{d.bagsOffered}</Td><Td align="right" className="font-bold">{d.bagsSold}</Td><Td align="right">{cad(d.pricePerBag, loc)}</Td><Td align="right">{cad(d.bagsSold * d.pricePerBag, loc)}</Td>
                <Td>{d.feedOrders ? <Badge tone="info">{t('Reçues par webhook', 'Came by webhook')}</Badge> : d.bagsSold ? <Badge tone="go">✓ {t('Dans les ventes', 'In sales')}</Badge> : <span className="text-xs text-ink-3">{t('rien vendu', 'nothing sold')}</span>}</Td>
                <Td>{!d.mev ? <span className="text-xs text-ink-3">—</span> : d.mev.missingBags ? <Badge tone="stop">{t(`${d.mev.missingBags} sans facture`, `${d.mev.missingBags} without invoice`)}</Badge> : d.bagsSold ? <Badge tone="go">✓ {d.mev.invoicedBags}/{d.bagsSold}</Badge> : <span className="text-xs text-ink-3">—</span>}</Td>
                <Td className="text-ink-3">{d.note ?? ''}</Td><Td className="text-ink-3">{d.by}</Td>
              </Tr>
            ))}
            {days.length === 0 && (!loaded ? <TableSkeleton columns={10} label={t('Chargement…', 'Loading…')} /> : <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-ink-3">{t('Aucune journée entrée.', 'No day logged yet.')}</td></tr>)}
          </tbody>
        </Table>
      </Card></Hint>
    </div>
  );
}

/**
 * « Sac remis » (Takatak MEV kitchens): a Too Good To Go customer takes their bag → one sale, recorded by Takatak MEV now,
 * and its invoice prints at once for the customer's hand. With the reservation code, a reservation already read from a
 * TGTG e-mail prints that order's invoice instead (never a second sale).
 */
function PickupCard({ locationCode, locationLabel, usualPrice, pickups, onDone }: { locationCode: string; locationLabel: string; usualPrice: string; pickups: BagPickup[]; onDone: () => unknown }) {
  const { t, loc } = useI18n();
  const toast = useToast();
  const [price, setPrice] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shownPrice = price ?? usualPrice;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });

  async function handOver() {
    setBusy(true); setErr('');
    // Opened during the tap (a window opened after the answer would be blocked); it shows the ticket only when Takatak
    // MEV issued the invoice, so no paper without an invoice is printed for the customer.
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api<{ pickup: BagPickup }>('/api/foodhub/tgtg', { method: 'POST', json: { action: 'pickup', locationCode, pricePerBag: Number(shownPrice || 0), quantity: Number(qty || 1), code: code.trim() || undefined, firstName: firstName.trim() || undefined } });
      const p = r.pickup;
      if (issued(p.mev) && !printedAt(p.mev, p.mev?.saleKey)) { if (w) w.location.href = `/ticket/${encodeURIComponent(p.id)}`; } else w?.close();
      if (p.existing === 'email') toast.info(t('Réservation déjà reçue par courriel', 'Reservation already received by e-mail'), issued(p.mev) ? t('C’est cette commande qui fait la vente : sa facture s’imprime (une seule fois).', 'That order is the sale: its invoice prints (once).') : t('C’est cette commande qui fait la vente, mais sa facture n’est pas encore émise : ouvrez-la dans Commandes et gardez le sac.', 'That order is the sale, but its invoice is not issued yet: open it in Orders and keep the bag.'));
      else if (p.existing === 'pickup') toast.info(t('Ce code est déjà remis', 'This code was already handed over'), t('Même vente, pas de deuxième facture.', 'Same sale, no second invoice.'));
      else if (issued(p.mev)) toast.success(t('Facture émise', 'Invoice issued'), t('Remettez la facture au client avec son sac.', 'Hand the invoice to the customer with their bag.'));
      else if (p.mev?.status === 'shadow') toast.info(t('Essai à blanc', 'Shadow test'), t('Vente vérifiée, aucune facture (mode essai).', 'Sale checked, no invoice (test mode).'));
      else toast.error(t('Facture pas encore émise', 'Invoice not issued yet'), t('Gardez le sac : Takatak MEV n’a pas encore répondu. Imprimez la facture ci-dessous dès qu’elle sort.', 'Keep the bag: Takatak MEV has not answered yet. Print the invoice below as soon as it is out.'), { durationMs: 15000 });
      setCode(''); setFirstName(''); setQty('1');
      await onDone();
    } catch (e) {
      w?.close();
      if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Card className="mb-5 p-5">
      <div className="mb-1 flex items-center gap-2"><ReceiptText className="size-5 text-[#00615f]" /><h2 className="text-base font-extrabold">{t('Sac remis — facture au client', 'Bag handed over — invoice to the customer')}</h2></div>
      <p className="mb-4 text-sm text-ink-2">{t(`À chaque client qui prend son sac à ${locationLabel} : une vente, sa facture s’imprime tout de suite.`, `For each customer who takes their bag at ${locationLabel}: one sale, its invoice prints right away.`)}</p>
      {err && <Banner tone="stop" className="mb-3">{err}</Banner>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t('Prix client / sac ($)', 'Customer price / bag ($)')}><Input type="number" inputMode="decimal" min={0} step={0.01} value={shownPrice} disabled={busy} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={t('Sacs pour ce client', 'Bags for this customer')}><Input type="number" inputMode="numeric" min={1} max={20} step={1} value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label={t('Code de réservation', 'Reservation code')}><Input value={code} maxLength={32} disabled={busy} onChange={(e) => setCode(e.target.value)} placeholder={t('optionnel', 'optional')} /></Field>
        <Field label={t('Prénom', 'First name')}><Input value={firstName} maxLength={40} disabled={busy} onChange={(e) => setFirstName(e.target.value)} placeholder={t('optionnel', 'optional')} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg" loading={busy} disabled={!locationCode || !(Number(shownPrice) > 0) || !(Number(qty) >= 1)} icon={<Printer className="size-4" />} onClick={handOver}>{t('Sac remis : imprimer la facture', 'Bag handed over: print the invoice')}</Button>
        {Number(shownPrice) > 0 && Number(qty) >= 1 && <span className="text-sm text-ink-2">= <strong className="text-ink">{cad(Number(shownPrice) * Number(qty), loc)}</strong> {t('taxes incluses', 'taxes included')}</span>}
      </div>
      {pickups.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-md border border-line">
          {pickups.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="num w-14 text-ink-2">{time(p.at)}</span>
              <span className="font-bold">{p.quantity} × {t('sac', 'bag')}</span>
              <span className="num text-ink-2">{cad(p.total, loc)}</span>
              {p.code && <span className="text-ink-3">{p.code}</span>}
              <MevBadge mev={p.mev} />
              {issued(p.mev) && !printedAt(p.mev, p.mev?.saleKey) && <a className="font-semibold text-[#00615f] underline" href={`/ticket/${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer">{t('Imprimer la facture', 'Print the invoice')}</a>}
              {issued(p.mev) && printedAt(p.mev, p.mev?.saleKey) && <span className="text-xs text-ink-3">{t('facture imprimée', 'invoice printed')}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
