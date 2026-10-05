'use client';

// Too Good To Go — daily Surprise Bag log.
// TGTG has no public store API: bags are set in the TGTG Store app. Logging the day here puts TGTG
// in sales, analytics, reports and payout reconciliation — without double counting when real TGTG
// orders already arrive by webhook.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { StatTile, fmtInt } from '@/components/charts/charts';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { MoneyHead, cad } from '../money-ui';
import { api, ApiError, dayOf, downloadCsv, ymd } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type BagDay = { id: string; date: string; locationCode: string; bagsOffered: number; bagsSold: number; pricePerBag: number; note?: string; by: string; at: string; orderId: string | null; feedOrders: number };
const PRICE_KEY = 'takatak.tgtg.price';

export default function TgtgPage() {
  const { t, loc } = useI18n();
  const { can, locations, locName } = useViewer();
  const toast = useToast();
  const [days, setDays] = useState<BagDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ date: ymd(new Date()), locationCode: '', bagsOffered: '', bagsSold: '', pricePerBag: '', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const from = new Date(); from.setDate(from.getDate() - 60);
    return api<{ days: BagDay[] }>(`/api/foodhub/tgtg?from=${ymd(from)}`).then((d) => { setDays(d.days); setLoaded(true); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setForm((f) => ({ ...f, locationCode: f.locationCode || locations[0]?.code || '' })); }, [locations]);
  useEffect(() => { try { const p = window.localStorage.getItem(PRICE_KEY); if (p) setForm((f) => ({ ...f, pricePerBag: f.pricePerBag || p })); } catch { /* private mode */ } }, []);

  // Editing an existing day: load it into the form.
  useEffect(() => {
    const d = days.find((x) => x.date === form.date && x.locationCode === form.locationCode);
    if (d) setForm((f) => ({ ...f, bagsOffered: String(d.bagsOffered), bagsSold: String(d.bagsSold), pricePerBag: String(d.pricePerBag), note: d.note ?? '' }));
    else setForm((f) => ({ ...f, bagsOffered: '', bagsSold: '', note: '' }));
  }, [form.date, form.locationCode, days]);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ day: BagDay }>('/api/foodhub/tgtg', { method: 'POST', json: { ...form, bagsOffered: Number(form.bagsOffered || 0), bagsSold: Number(form.bagsSold), pricePerBag: Number(form.pricePerBag || 0) } });
      try { window.localStorage.setItem(PRICE_KEY, form.pricePerBag); } catch { /* ignore */ }
      if (r.day.feedOrders) toast.info(t('Journée enregistrée', 'Day saved'), t(`${r.day.feedOrders} commande(s) Too Good To Go sont déjà arrivées par webhook ce jour-là : le journal est gardé mais pas compté deux fois.`, `${r.day.feedOrders} Too Good To Go order(s) already arrived by webhook that day, so the log is kept but not counted twice.`));
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

      {can('orders:act') && (
        <Card className="mb-5 p-5">
          <div className="mb-4 flex items-center gap-2"><ShoppingBag className="size-5 text-[#00615f]" /><h2 className="text-base font-extrabold">{t('Entrer une journée', 'Log a day')}</h2></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Date"><Input type="date" value={form.date} max={ymd(new Date())} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={t('Succursale', 'Location')}>
              <Select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}>
                {locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}
              </Select>
            </Field>
            <Field label={t('Sacs offerts', 'Bags offered')}><Input type="number" inputMode="numeric" min={0} step={1} value={form.bagsOffered} onChange={(e) => setForm({ ...form, bagsOffered: e.target.value })} /></Field>
            <Field label={t('Sacs vendus (ramassés)', 'Bags sold (picked up)')}><Input type="number" inputMode="numeric" min={0} step={1} value={form.bagsSold} onChange={(e) => setForm({ ...form, bagsSold: e.target.value })} /></Field>
            <Field label={t('Prix client / sac ($)', 'Customer price / bag ($)')}><Input type="number" inputMode="decimal" min={0} step={0.01} value={form.pricePerBag} onChange={(e) => setForm({ ...form, pricePerBag: e.target.value })} /></Field>
            <Field label={t('Note', 'Note')}><Input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t('optionnel', 'optional')} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button loading={busy} disabled={!form.locationCode || form.bagsSold === ''} onClick={save}>{t('Enregistrer la journée', 'Save day')}</Button>
            {total !== null && Number.isFinite(total) && <span className="text-sm text-ink-2">= <strong className="text-ink">{cad(total, loc)}</strong> {t('en ventes Too Good To Go', 'in Too Good To Go sales')}</span>}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t('60 derniers jours', 'Last 60 days')} right={<Button size="sm" variant="outline" disabled={!days.length} icon={<Download className="size-4" />} onClick={() => downloadCsv('tgtg-sacs', [
          [t('Date', 'Date'), t('Succursale', 'Location'), t('Offerts', 'Offered'), t('Vendus', 'Sold'), t('Prix', 'Price'), t('Ventes', 'Sales'), t('Compté dans les ventes', 'Counted as sales'), t('Note', 'Note'), t('Par', 'By')],
          ...days.map((d) => [d.date, d.locationCode, d.bagsOffered, d.bagsSold, d.pricePerBag.toFixed(2), (d.bagsSold * d.pricePerBag).toFixed(2), d.feedOrders ? t('non — commandes reçues par webhook', 'no — orders came by webhook') : d.bagsSold ? t('oui', 'yes') : t('non', 'no'), d.note ?? '', d.by]),
        ])}>CSV</Button>} />
        <Table>
          <thead><tr><Th>Date</Th><Th>{t('Succursale', 'Location')}</Th><Th align="right">{t('Offerts', 'Offered')}</Th><Th align="right">{t('Vendus', 'Sold')}</Th><Th align="right">{t('Prix', 'Price')}</Th><Th align="right">{t('Ventes', 'Sales')}</Th><Th>{t('Compté', 'Counted')}</Th><Th>{t('Note', 'Note')}</Th><Th>{t('Par', 'By')}</Th></tr></thead>
          <tbody>
            {days.map((d) => (
              <Tr key={d.id} className="cursor-pointer" onClick={() => setForm((f) => ({ ...f, date: d.date, locationCode: d.locationCode }))}>
                <Td className="whitespace-nowrap">{dayOf(d.date, loc)}</Td><Td className="text-ink-2">{shortLoc(locName(d.locationCode))}</Td>
                <Td align="right">{d.bagsOffered}</Td><Td align="right" className="font-bold">{d.bagsSold}</Td><Td align="right">{cad(d.pricePerBag, loc)}</Td><Td align="right">{cad(d.bagsSold * d.pricePerBag, loc)}</Td>
                <Td>{d.feedOrders ? <Badge tone="info">{t('Reçues par webhook', 'Came by webhook')}</Badge> : d.bagsSold ? <Badge tone="go">✓ {t('Dans les ventes', 'In sales')}</Badge> : <span className="text-xs text-ink-3">{t('rien vendu', 'nothing sold')}</span>}</Td>
                <Td className="text-ink-3">{d.note ?? ''}</Td><Td className="text-ink-3">{d.by}</Td>
              </Tr>
            ))}
            {days.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-3">{loaded ? t('Aucune journée entrée.', 'No day logged yet.') : t('Chargement…', 'Loading…')}</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
