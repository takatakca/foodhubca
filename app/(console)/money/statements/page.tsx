'use client';

// Statements — import the payout reports each platform gives you (CSV or Excel), or let Uber send its own.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudDownload, FileSpreadsheet, Trash2, UploadCloud } from 'lucide-react';
import { Badge, PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { CH_NAME, MoneyHead, cad } from '../money-ui';
import { api, ApiError, dayOf, toBase64, ymd } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { cn } from '@/lib/ui/cn';

type Imp = { id: string; channel: string; fileName: string; format: string; rows: number; lines: number; newLines: number; skipped: number; totalNet: number; periodFrom: string | null; periodTo: string | null; importedBy: string; importedAt: string; source: string };
type Mapping = Record<string, number | number[] | undefined>;
type Ask = { needsMapping: true; headers: string[]; sample: string[][]; mapping: Mapping; format: string; channel: string | null; message: string };
type UberReq = { id: string; workflowId: string | null; from: string; to: string; status: 'requested' | 'imported' | 'failed'; message: string; requestedBy: string; at: string };

const formatLabel = (t: T, f: string) => ({ uber_payment_details: t('Uber Eats — Détails des paiements', 'Uber Eats Payment details'), doordash_transactions: t('DoorDash — transactions', 'DoorDash transactions'), generic: t('Vos colonnes', 'Your columns') } as Record<string, string>)[f] ?? f;
const fieldLabel = (t: T, k: string, fallback: string) => ({
  orderRef: t('No de commande', 'Order id / number'), orderRef2: t('2e no de commande (optionnel)', 'Second order id (optional)'), storeRef: t('Magasin', 'Store'), orderDate: t('Date de la commande', 'Order date'), payoutDate: t('Date du paiement', 'Payout date'), payoutRef: t('No de paiement / relevé', 'Payout / statement id'),
  kind: t('Type / statut', 'Type / status'), description: t('Description', 'Description'), sales: t('Ventes nourriture (avant taxes)', 'Food sales (before tax)'), tax: t('Taxes sur la nourriture', 'Tax on food'), commission: t('Commission / frais de plateforme', 'Commission / platform fee'), commissionTax: t('Taxes sur commission', 'Tax on commission'),
  promotions: t('Promotions payées par vous', 'Promotions you paid'), adjustments: t('Ajustements / frais d’erreur', 'Adjustments / error charges'), otherFees: t('Autres frais (pubs, tablette…)', 'Other fees (ads, tablet…)'), net: t('Paiement net (ce que vous recevez)', 'Net payout (what you receive)'),
} as Record<string, string>)[k] ?? fallback;
const REQUIRED = ['orderRef', 'net'];

export default function StatementsPage() {
  const { t, loc } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const edit = can('finance:edit');
  const [imports, setImports] = useState<Imp[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<UberReq[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [ask, setAsk] = useState<{ file: File; base64: string; data: Ask } | null>(null);
  const [removing, setRemoving] = useState<Imp | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uber, setUber] = useState(() => { const to = new Date(); const from = new Date(to); from.setDate(to.getDate() - 7); return { from: ymd(from), to: ymd(to) }; });

  const load = useCallback(async () => {
    try {
      const [i, u] = await Promise.all([
        api<{ imports: Imp[]; fields: Record<string, string> }>('/api/foodhub/recon/imports'),
        api<{ requests: UberReq[] }>('/api/foodhub/recon/uber-report'),
      ]);
      setImports(i.imports.sort((a, b) => b.importedAt.localeCompare(a.importedAt))); setFields(i.fields); setRequests(u.requests.sort((a, b) => b.at.localeCompare(a.at))); setErr(''); setLoaded(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function send(file: File, base64: string, extra: { channel?: string; mapping?: Mapping } = {}) {
    setBusy(true);
    try {
      const r = await api<{ imported: boolean; import?: Imp; cases?: { opened: number; closed: number } } & Partial<Ask>>('/api/foodhub/recon/imports', { method: 'POST', json: { fileName: file.name, contentBase64: base64, channel: extra.channel ?? (channel || undefined), mapping: extra.mapping } });
      if (!r.imported) { setAsk({ file, base64, data: r as Ask }); return; }
      setAsk(null);
      const i = r.import!;
      toast.success(`${CH_NAME[i.channel] ?? i.channel} — ${i.lines} ${t('ligne(s) lue(s)', 'line(s) read')}, ${i.newLines} ${t('nouvelle(s)', 'new')}`,
        `${cad(i.totalNet, loc)} net${i.periodFrom ? ` · ${dayOf(i.periodFrom, loc)} → ${dayOf(i.periodTo, loc)}` : ''}${r.cases ? ` · ${r.cases.opened} ${t('nouveau(x) problème(s)', 'new problem(s)')}, ${r.cases.closed} ${t('réglé(s)', 'fixed')}` : ''}`);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast.error(t('Fichier trop gros (max 15 Mo).', 'File too large (max 15 MB).')); return; }
    if (!/\.(csv|txt|tsv|xlsx)$/i.test(file.name)) { toast.error(t('Choisissez un fichier CSV ou Excel (.xlsx). Pour un relevé PDF, exportez la version CSV dans le portail de la plateforme.', 'Choose a CSV or Excel (.xlsx) file. For a PDF statement, export the CSV version from the platform portal.')); return; }
    await send(file, await toBase64(file));
  }

  async function remove(i: Imp) {
    setRemoving(null);
    try { await api(`/api/foodhub/recon/imports?id=${encodeURIComponent(i.id)}`, { method: 'DELETE' }); toast.success(t('Relevé retiré', 'Statement removed'), i.fileName); await load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function requestUber() {
    setBusy(true);
    try {
      const r = await api<{ request: UberReq }>('/api/foodhub/recon/uber-report', { method: 'POST', json: uber });
      toast.success(t('Demande envoyée à Uber Eats', 'Request sent to Uber Eats'), `${uber.from} → ${uber.to}. ${t('Le rapport est importé tout seul quand Uber l’envoie (souvent en quelques minutes).', 'The report is imported automatically when Uber sends it (usually within minutes).')} ${r.request.message}`);
      await load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const where: Array<[string, string]> = [
    ['uber_eats', t('Uber Eats Manager → Paiements → téléchargez le rapport « Détails des paiements » (CSV). Food Hub reconnaît ses colonnes, y compris TPS et TVQ. Ou utilisez « Demander à Uber » et il arrive tout seul.', 'Uber Eats Manager → Payments → download the “Payment details” report (CSV). Food Hub recognises its columns, including GST and QST. Or use “Request from Uber” and it arrives by itself.')],
    ['doordash', t('Merchant Portal DoorDash → Finances → exportez les transactions (ou détails des paiements) en CSV. Reconnu automatiquement.', 'DoorDash Merchant Portal → Financials → export the transactions (or payout details) as CSV. Recognised automatically.')],
    ['skip', t('Portail restaurant Skip → relevés / rapports de paiement → export CSV ou Excel. La première fois, confirmez quelle colonne est le no de commande et laquelle est le net — Food Hub s’en souvient.', 'Skip Restaurant Portal → statements / payment reports → export as CSV or Excel. The first time, confirm which column is the order number and which is the net — Food Hub remembers it.')],
    ['tgtg', t('Application ou portail Too Good To Go → paiements / factures → export. Confirmez les colonnes une fois. Les sacs du jour vont dans Argent → Too Good To Go.', 'Too Good To Go Store app or portal → payouts / invoices → export. Confirm the columns once. Daily bags go in Money → Too Good To Go.')],
  ];

  return (
    <div>
      <MoneyHead title={t('Relevés', 'Statements')} intro={t('Importez les relevés de paiement de chaque plateforme. Une même ligne importée deux fois n’est comptée qu’une fois : les fichiers qui se chevauchent ne posent aucun problème. Chaque import revérifie vos commandes et ouvre ou ferme les litiges.', 'Import the payout statements each platform gives you. The same line imported twice is only counted once, so overlapping files are safe. Every import re-checks your orders and opens or closes dispute cases.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold">{t('Importer un relevé', 'Import a statement')}</h2>
            <Select selectSize="sm" className="w-48" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!edit} aria-label={t('Plateforme', 'Platform')}>
              <option value="">{t('Détecter automatiquement', 'Detect automatically')}</option>
              {Object.entries(CH_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </div>
          {!edit && <Banner tone="info" className="mb-3">{t('Votre rôle peut voir les relevés mais pas les importer.', 'Your role can view statements but not import them.')}</Banner>}
          <label
            onDragOver={(e) => { if (!edit) return; e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (edit && !busy) pick(e.dataTransfer.files?.[0]); }}
            className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors', drag ? 'border-brand bg-brand/5' : 'border-line-2 bg-raised hover:border-ink-4', (!edit || busy) && 'pointer-events-none opacity-60')}>
            <UploadCloud className={cn('size-9', busy ? 'animate-pulse text-brand' : 'text-ink-3')} />
            <span className="text-[15px] font-bold text-ink">{busy ? t('Lecture du fichier…', 'Reading the file…') : t('Glissez le fichier ici ou cliquez', 'Drop the file here or click')}</span>
            <span className="text-xs text-ink-3">{t('CSV ou Excel (.xlsx), max 15 Mo', 'CSV or Excel (.xlsx), up to 15 MB')}</span>
            <input ref={fileRef} type="file" className="sr-only" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!edit || busy} onChange={(e) => pick(e.target.files?.[0])} aria-label={t('Fichier du relevé', 'Statement file')} />
          </label>
          <p className="mt-3 text-xs text-ink-3">{t('« Détails des paiements » Uber Eats et les exports de transactions DoorDash sont reconnus automatiquement ; tout autre fichier vous demande une fois quelle colonne est laquelle.', 'Uber Eats “Payment details” and DoorDash transaction exports are recognised automatically; any other file asks you once which column is which.')}</p>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2"><PlatformTag channel="uber_eats" /><h2 className="text-base font-extrabold">{t('Demander à Uber Eats', 'Request from Uber Eats')}</h2></div>
          <p className="mb-3 text-[13px] text-ink-2">{t('L’API Reporting d’Uber prépare le rapport « Détails des paiements » de tous vos magasins Uber Eats et l’envoie à Food Hub, qui l’importe tout seul. Il faut la permission', 'Uber’s Reporting API builds the Payment details report for all your Uber Eats stores and sends it to Food Hub, which imports it by itself. Needs the')} <code className="rounded bg-sunken px-1 text-xs">eats.report</code>{t('.', ' scope.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('Du', 'From')}><Input inputSize="sm" type="date" value={uber.from} onChange={(e) => setUber({ ...uber, from: e.target.value })} disabled={!edit} /></Field>
            <Field label={t('Au', 'To')}><Input inputSize="sm" type="date" value={uber.to} onChange={(e) => setUber({ ...uber, to: e.target.value })} disabled={!edit} /></Field>
            <Button size="sm" disabled={!edit} loading={busy} onClick={requestUber} icon={<CloudDownload className="size-4" />}>{t('Demander', 'Request')}</Button>
          </div>
          {requests.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-md border border-line">
              {requests.slice(0, 5).map((r) => (
                <li key={r.id} className="px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.from} → {r.to}</span>
                    <Badge tone={r.status === 'imported' ? 'go' : r.status === 'failed' ? 'stop' : 'wait'}>{r.status === 'imported' ? t('✓ Importé', '✓ Imported') : r.status === 'failed' ? t('✕ Échec', '✕ Failed') : t('◷ En attente d’Uber', '◷ Waiting for Uber')}</Badge>
                  </div>
                  <div className="text-xs text-ink-3">{new Date(r.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })} · {r.requestedBy}{r.message ? ` · ${r.message}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader title={`${t('Relevés importés', 'Imported statements')} (${imports.length})`} icon={<FileSpreadsheet className="size-5" />} />
        <Table>
          <thead><tr><Th>{t('Importé', 'Imported')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Fichier', 'File')}</Th><Th>{t('Format', 'Format')}</Th><Th>{t('Période', 'Period')}</Th><Th align="right">{t('Lignes', 'Lines')}</Th><Th align="right">Net</Th><Th>{t('Source', 'Source')}</Th><Th /></tr></thead>
          <tbody>
            {imports.map((i) => (
              <Tr key={i.id}>
                <Td className="whitespace-nowrap text-ink-3">{new Date(i.importedAt).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })}<div className="text-[11px]">{i.importedBy}</div></Td>
                <Td><PlatformTag channel={i.channel} /></Td>
                <Td className="max-w-64 break-words">{i.fileName}</Td>
                <Td className="text-ink-2">{formatLabel(t, i.format)}</Td>
                <Td className="whitespace-nowrap text-ink-2">{i.periodFrom ? `${dayOf(i.periodFrom, loc)} → ${dayOf(i.periodTo, loc)}` : '—'}</Td>
                <Td align="right">{i.lines}{i.newLines !== i.lines ? <div className="text-[11px] text-ink-3">{i.newLines} {t('nouvelles', 'new')}</div> : null}{i.skipped ? <div className="text-[11px] text-ink-3">{i.skipped} {t('ignorées', 'skipped')}</div> : null}</Td>
                <Td align="right" className="font-semibold">{cad(i.totalNet, loc)}</Td>
                <Td className="text-ink-3">{i.source === 'uber_reporting_api' ? 'API Uber' : t('Téléversé', 'Upload')}</Td>
                <Td align="right">{edit && <Button size="xs" variant="ghost" onClick={() => setRemoving(i)} icon={<Trash2 className="size-3.5" />}>{t('Retirer', 'Remove')}</Button>}</Td>
              </Tr>
            ))}
            {imports.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-3">{loaded ? t('Aucun relevé importé pour l’instant.', 'No statement imported yet.') : t('Chargement…', 'Loading…')}</td></tr>}
          </tbody>
        </Table>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-base font-extrabold">{t('Où télécharger chaque relevé', 'Where to download each statement')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {where.map(([ch, d]) => <div key={ch} className="rounded-lg border border-line bg-raised p-3.5"><PlatformTag channel={ch} /><p className="mt-2 text-[13px] leading-relaxed text-ink-2">{d}</p></div>)}
        </div>
        <p className="mt-3 text-xs text-ink-3">{t('Les noms de menus changent de temps en temps — cherchez « paiements », « versements », « relevés » ou « finances », et choisissez l’export CSV / Excel avec une ligne par commande.', 'Menu names in the platform portals change from time to time — look for “payments”, “payouts”, “statements” or “financials”, and choose the CSV / Excel export with one line per order.')}</p>
      </Card>

      {ask && <MappingDialog ask={ask.data} fileName={ask.file.name} fields={fields} defaultChannel={channel} busy={busy} onClose={() => setAsk(null)} onSubmit={(ch, m) => send(ask.file, ask.base64, { channel: ch, mapping: m })} />}
      {removing && (
        <Modal size="sm" title={t('Retirer ce relevé ?', 'Remove this statement?')} onClose={() => setRemoving(null)}
          footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>{t('Annuler', 'Cancel')}</Button><Button variant="danger" onClick={() => remove(removing)}>{t('Retirer', 'Remove')}</Button></>}>
          <p className="text-sm text-ink-2"><strong className="text-ink">{removing.fileName}</strong> — {removing.lines} {t('ligne(s). Les commandes seront revérifiées sans lui.', 'line(s). Orders will be re-checked without it.')}</p>
        </Modal>
      )}
    </div>
  );
}

function MappingDialog({ ask, fileName, fields, defaultChannel, busy, onClose, onSubmit }: { ask: Ask; fileName: string; fields: Record<string, string>; defaultChannel: string; busy: boolean; onClose: () => void; onSubmit: (channel: string, m: Mapping) => void }) {
  const { t } = useI18n();
  const [ch, setCh] = useState(ask.channel ?? defaultChannel ?? '');
  const [map, setMap] = useState<Mapping>(ask.mapping ?? {});
  const first = (v: number | number[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const netOk = first(map.net) !== undefined || first(map.sales) !== undefined;
  const ready = Boolean(ch) && first(map.orderRef) !== undefined && netOk;
  return (
    <Modal size="xl" title={t('Confirmez les colonnes', 'Confirm the columns')} subtitle={`${fileName} — ${t('Food Hub se souvient de votre réponse pour les fichiers avec les mêmes colonnes.', 'Food Hub remembers your answer for files with the same columns.')}`} onClose={onClose}
      footer={<>{!ready && <span className="mr-auto text-xs text-ink-3">{t('Choisissez la plateforme, la colonne commande et la colonne paiement net.', 'Choose the platform, the order column and the net payout column.')}</span>}<Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button disabled={!ready} loading={busy} onClick={() => onSubmit(ch, map)}>{t('Importer', 'Import')}</Button></>}>
      <p className="mb-3 text-[13px] text-ink-2">{ask.message}</p>
      <div className="scrollbar-thin mb-4 max-h-48 overflow-auto rounded-md border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-raised"><tr>{ask.headers.map((h, i) => <th key={i} className="border-b border-line px-2 py-1.5 text-left font-semibold whitespace-nowrap text-ink-3">{h || `${t('Colonne', 'Column')} ${i + 1}`}</th>)}</tr></thead>
          <tbody>{ask.sample.map((r, i) => <tr key={i}>{ask.headers.map((_, j) => <td key={j} className="border-b border-line px-2 py-1 whitespace-nowrap">{r[j] ?? ''}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <Field label={`${t('Plateforme', 'Platform')} *`} className="mb-4 max-w-xs">
        <Select value={ch} onChange={(e) => setCh(e.target.value)}>
          <option value="">{t('Choisir…', 'Choose…')}</option>
          {Object.entries(CH_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        {Object.entries(fields).map(([k, label]) => (
          <Field key={k} label={`${fieldLabel(t, k, label)}${REQUIRED.includes(k) ? ' *' : ''}`}>
            <Select selectSize="sm" value={first(map[k]) ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? undefined : Number(e.target.value) })}>
              <option value="">{t('— pas dans ce fichier —', '— not in this file —')}</option>
              {ask.headers.map((h, i) => <option key={i} value={i}>{h || `${t('Colonne', 'Column')} ${i + 1}`}</option>)}
            </Select>
          </Field>
        ))}
      </div>
    </Modal>
  );
}
