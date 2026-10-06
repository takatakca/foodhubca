'use client';

// Payouts & deposits — each platform payout from its statement, next to what reached the bank.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { FormDraftNote } from '@/components/ui/save-chip';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { StatTile, fmtInt } from '@/components/charts/charts';
import { useViewer } from '@/components/shell/viewer';
import { Hint } from '@/components/help/hint';
import { useOptionalHelp } from '@/components/help/help-provider';
import { CH_NAME, MoneyHead, cad, signed } from '../money-ui';
import { api, ApiError, dayOf, downloadCsv, ymd } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';

type Batch = {
  key: string; channel: string; payoutRef: string | null; payoutDate: string | null; lines: number; orders: number; sales: number; tax: number; commission: number; commissionTax: number;
  promotions: number; adjustments: number; otherFees: number; refunds: number; net: number; hasBreakdown: boolean; deposit: { amount: number; date: string; note?: string; by: string } | null; gap: number | null;
};

export default function PayoutsPage() {
  const { t, loc } = useI18n();
  const { can, locations } = useViewer();
  const toast = useToast();
  const { filters, set, query } = useFilters('last_month');
  const [rows, setRows] = useState<Batch[]>([]);
  const [err, setErr] = useState('');
  const [dep, setDep] = useState<Batch | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => api<{ payouts: Batch[] }>(`/api/foodhub/recon/payouts?${query}`).then((d) => { setRows(d.payouts); setErr(''); setLoaded(true); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [query]);
  useEffect(() => { load(); }, [load]);

  const tot = useMemo(() => ({
    net: rows.reduce((s, b) => s + b.net, 0),
    deposited: rows.reduce((s, b) => s + (b.deposit?.amount ?? 0), 0),
    waiting: rows.filter((b) => !b.deposit).length,
    gaps: rows.filter((b) => b.gap !== null && Math.abs(b.gap) >= 0.01),
    fees: rows.reduce((s, b) => s + b.commission + b.commissionTax, 0),
  }), [rows]);

  function exportCsv() {
    downloadCsv(`paiements-${filters.from}-${filters.to}`, [
      [t('Date du paiement', 'Payout date'), t('Plateforme', 'Platform'), t('No de paiement', 'Payout id'), t('Commandes', 'Orders'), t('Lignes', 'Lines'), t('Ventes nourriture', 'Food sales'), t('Taxes perçues', 'Tax collected'), t('Commission', 'Commission'), t('Taxes sur commission', 'Tax on commission'), t('Promotions', 'Promotions'), t('Ajustements', 'Adjustments'), t('Remboursements', 'Refunds'), t('Autres frais', 'Other fees'), t('Net (relevé)', 'Net (statement)'), t('Dépôt bancaire', 'Bank deposit'), t('Date du dépôt', 'Deposit date'), t('Écart', 'Gap')],
      ...rows.map((b) => [b.payoutDate ?? '', CH_NAME[b.channel] ?? b.channel, b.payoutRef ?? '', b.orders, b.lines, b.sales.toFixed(2), b.tax.toFixed(2), b.commission.toFixed(2), b.commissionTax.toFixed(2), b.promotions.toFixed(2), b.adjustments.toFixed(2), b.refunds.toFixed(2), b.otherFees.toFixed(2), b.net.toFixed(2), b.deposit?.amount.toFixed(2) ?? '', b.deposit?.date ?? '', b.gap?.toFixed(2) ?? '']),
    ]);
  }

  return (
    <div>
      <MoneyHead title={t('Paiements et dépôts', 'Payouts & deposits')} intro={t('Chaque paiement tel que le relevé de la plateforme le décrit — ventes, commission, taxes sur frais, promotions, remboursements — et le montant arrivé dans votre compte de banque. Entrez le dépôt de votre relevé bancaire pour boucler la boucle.', 'Each payout as the platform statement describes it — sales, commission, tax on fees, promotions, refunds — and the amount that actually reached your bank account. Enter the deposit from your bank statement to close the loop.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <FilterBar filters={filters} set={set} locations={locations} showLocations={false} showBrands={false} presets={['7d', '30d', 'month', 'last_month', 'custom']} extra={<Hint id="payouts.csv"><Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length} icon={<Download className="size-4" />}>CSV</Button></Hint>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile hero label={t('Payé (relevés)', 'Paid out (statements)')} value={cad(tot.net, loc)} note={`${fmtInt(rows.length)} ${t('paiement(s)', 'payout(s)')}`} />
        <StatTile label={t('Arrivé à la banque', 'Reached the bank')} value={cad(tot.deposited, loc)} note={`${tot.waiting} ${t('paiement(s) sans dépôt entré', 'payout(s) without a deposit entered')}`} />
        <Hint id="payouts.gaps"><StatTile label={t('Dépôts différents', 'Deposits that differ')} value={fmtInt(tot.gaps.length)} note={tot.gaps.length ? signed(tot.gaps.reduce((s, b) => s + (b.gap ?? 0), 0), loc) : t('aucun', 'none')} /></Hint>
        <StatTile label={t('Commission + taxes sur frais', 'Commission + tax on fees')} value={cad(tot.fees, loc)} note={t('les taxes sur frais sont récupérables (CTI / RTI)', 'tax on fees is recoverable (ITC / ITR)')} />
      </div>

      <Card>
        <Table>
          <thead><tr><Th>{t('Paiement', 'Payout')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th align="right">{t('Cmd', 'Orders')}</Th><Th align="right">{t('Ventes', 'Food sales')}</Th><Th align="right">{t('Taxes perçues', 'Tax collected')}</Th><Th align="right">{t('Commission + taxes', 'Commission + tax')}</Th><Th align="right">{t('Tout le reste', 'Everything else')}</Th><Th align="right">{t('Net payé', 'Net paid')}</Th><Th align="right">{t('Dépôt bancaire', 'Bank deposit')}</Th></tr></thead>
          <tbody>
            {rows.map((b) => {
              const fees = b.commission + b.commissionTax;
              const rest = Math.round((b.net - b.sales - b.tax + fees) * 100) / 100;
              const ref = b.payoutRef ?? (b.key.split('|')[1] ?? '');
              const gapBad = b.gap !== null && Math.abs(b.gap) >= 0.01;
              return (
                <Tr key={b.key}>
                  <Td className="whitespace-nowrap">{b.payoutDate ? dayOf(b.payoutDate, loc) : ref.startsWith('week-') ? `${t('Semaine du', 'Week of')} ${ref.slice(5)}` : '—'}{b.payoutRef && <div className="font-mono text-[11px] text-ink-3">{b.payoutRef}</div>}</Td>
                  <Td><PlatformTag channel={b.channel} />{!b.hasBreakdown && <div className="mt-0.5 text-[11px] text-ink-3">{t('net seulement', 'net only')}</div>}</Td>
                  <Td align="right">{b.orders}</Td>
                  <Td align="right">{b.hasBreakdown ? cad(b.sales, loc) : '—'}</Td>
                  <Td align="right">{b.hasBreakdown ? cad(b.tax, loc) : '—'}</Td>
                  <Td align="right" className="text-ink-2">{b.hasBreakdown ? (fees ? `−${cad(fees, loc)}` : cad(0, loc)) : '—'}</Td>
                  <Td align="right" className="text-ink-2" title={t('Promotions, ajustements, remboursements, frais d’erreur, pubs et autres frais', 'Promotions, adjustments, refunds, error charges, ads and other fees')}>{b.hasBreakdown ? signed(rest, loc) : '—'}</Td>
                  <Td align="right" className="font-extrabold">{cad(b.net, loc)}</Td>
                  <Td align="right">
                    {b.deposit ? (
                      <div className="flex flex-col items-end">
                        <span>{cad(b.deposit.amount, loc)}</span>
                        <span className="text-[11px] text-ink-3">{dayOf(b.deposit.date, loc)}</span>
                        {gapBad ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-stop"><XCircle className="size-3" />{signed(b.gap, loc)}</span> : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-go-2"><CheckCircle2 className="size-3" />{t('concorde', 'matches')}</span>}
                      </div>
                    ) : !can('finance:edit') && <span className="text-xs text-ink-3">{t('non entré', 'not entered')}</span>}
                    {can('finance:edit') && <Hint id="payouts.deposit"><Button size="md" variant={b.deposit ? 'ghost' : 'outline'} className="mt-1" onClick={() => setDep(b)}>{b.deposit ? t('Modifier', 'Edit') : t('Entrer le dépôt', 'Enter deposit')}</Button></Hint>}
                  </Td>
                </Tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-3">{loaded ? t('Aucun paiement dans cette période. Importez les relevés dans Relevés.', 'No payout in this period. Import the statements in Statements.') : t('Chargement…', 'Loading…')}</td></tr>}
          </tbody>
        </Table>
        <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-3">{t('Ventes + taxes − commission et ses taxes + tout le reste = net payé. « Tout le reste » = promotions, ajustements, remboursements, frais d’erreur, pubs et autres frais (le CSV les détaille). « Net seulement » veut dire que le relevé n’avait pas de détail — importez le rapport détaillé pour le répartir.', 'Food sales + tax − commission and its tax + everything else = net paid. “Everything else” is promotions, adjustments, refunds, error charges, ads and other fees (the CSV has each one). “Net only” means the statement had no breakdown — import the detailed report to split it.')}</p>
      </Card>

      {dep && <DepositDialog key={dep.key} b={dep} onClose={() => setDep(null)} onSaved={() => { toast.success(t('Dépôt enregistré', 'Deposit saved')); setDep(null); load(); }} />}
    </div>
  );
}

type DepFields = { amount: string; date: string; note: string };
/** What the person changed in the form (null = untouched: it follows the payout, even if it changed since). */
type DepChanges = { [K in keyof DepFields]: string | null };
const NO_DEP_CHANGE: DepChanges = { amount: null, date: null, note: null };
const DEP_KEYS = Object.keys(NO_DEP_CHANGE) as Array<keyof DepFields>;

function DepositDialog({ b, onClose, onSaved }: { b: Batch; onClose: () => void; onSaved: () => void }) {
  const { t, loc } = useI18n();
  const { viewer } = useViewer();
  const toast = useToast();
  const help = useOptionalHelp();
  // What is typed is kept on this device (one draft per payout) until "Save deposit" succeeds: closing by mistake, a
  // reload or the PIN being cancelled loses nothing. Only the changed fields are kept, so the rest follows the payout.
  const f = useFormDraft<DepChanges>(formDraftId('deposit', b.key), viewer.username, NO_DEP_CHANGE);
  const cur: DepFields = { amount: b.deposit ? String(b.deposit.amount) : b.net.toFixed(2), date: b.deposit?.date ?? b.payoutDate ?? ymd(new Date()), note: b.deposit?.note ?? '' };
  const v: DepFields = { amount: f.value.amount ?? cur.amount, date: f.value.date ?? cur.date, note: f.value.note ?? cur.note };
  const dirty = DEP_KEYS.some((k) => v[k] !== cur[k]);
  const put = (k: keyof DepFields, x: string) => f.set((p) => ({ ...p, [k]: x === cur[k] ? null : x }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const gap = Number(v.amount) - b.net;
  const ready = v.amount.trim() !== '' && Number.isFinite(Number(v.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(v.date);
  /** X, backdrop, Esc or Cancel: nothing is sent; what was typed waits for the next opening. */
  function close() {
    // Esc while TakTak explains "Save deposit" (blocking card, it covers everything else): close the card, keep the pop-up.
    if (help?.mark?.onContinue) return;
    if (dirty) toast.info(t('Gardé — rouvrez pour terminer', 'Kept — reopen to finish'));
    onClose();
  }
  async function save() {
    setBusy(true); setErr('');
    try { await api('/api/foodhub/recon/payouts', { method: 'POST', json: { key: b.key, amount: Number(v.amount), date: v.date, note: v.note } }); f.clear(); onSaved(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal size="sm" title={t('Dépôt bancaire', 'Bank deposit')} subtitle={`${CH_NAME[b.channel] ?? b.channel} · ${b.payoutRef ?? (b.payoutDate ? dayOf(b.payoutDate, loc) : '')}`} onClose={close}
      footer={<><Button variant="ghost" size="lg" onClick={close}>{t('Annuler', 'Cancel')}</Button><Hint id="payouts.save"><Button size="lg" loading={busy} disabled={!ready} onClick={save}>{t('Enregistrer le dépôt', 'Save deposit')}</Button></Hint></>}>
      <FormDraftNote restored={f.restored && dirty} onDiscard={f.discard} />
      <p className="mb-4 text-sm text-ink-2">{t('Le relevé dit', 'The statement says')} <strong className="text-ink">{cad(b.net, loc)}</strong>. {t('Entrez ce que votre relevé bancaire montre pour ce paiement.', 'Enter what your bank statement shows for this payout.')}</p>
      <div className="grid gap-3">
        <Hint id="payouts.amount"><Field label={t('Montant reçu ($)', 'Amount received ($)')}><Input type="number" step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => put('amount', e.target.value)} /></Field></Hint>
        <Field label={t('Date du dépôt', 'Deposit date')}><Input type="date" value={v.date} onChange={(e) => put('date', e.target.value)} /></Field>
        <Field label={t('Note', 'Note')}><Input value={v.note} onChange={(e) => put('note', e.target.value)} maxLength={200} placeholder={t('Référence bancaire…', 'Bank reference…')} /></Field>
        {v.amount.trim() !== '' && Number.isFinite(gap) && Math.abs(gap) >= 0.01 && <Banner tone="warn">{t('Diffère du relevé de', 'Differs from the statement by')} {signed(gap, loc)} — {t('l’écriture du grand livre affichera un avertissement.', 'the ledger entry will show a warning.')}</Banner>}
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}
