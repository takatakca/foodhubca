'use client';

// Revenu Québec invoice (Takatak MEV) on an order: one badge for the lists, one panel for the order drawer.
// Plain words, French first. Everything shown comes from QCMEV as it rendered it; Food Hub never makes an invoice.
import { useState } from 'react';
import { Copy, ExternalLink, Printer, ReceiptText, RotateCcw } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { T } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { printableDoc, printedAt } from '@/lib/foodhub/mev/printable';
import type { MevRecord } from '@/lib/foodhub/mev/types';
import { api } from '@/lib/ui/api';

const TONE: Record<MevRecord['status'], Tone> = { accepted: 'go', pending: 'wait', offline: 'info', rejected: 'stop', needs_human: 'stop', credited: 'neutral', skipped: 'neutral', shadow: 'neutral' };

export function mevLabel(t: T, s: MevRecord['status']): string {
  return ({
    accepted: t('Facture émise', 'Invoice issued'), pending: t('Facture en attente', 'Invoice pending'), offline: t('Facture hors ligne', 'Invoice offline'),
    rejected: t('Facture refusée', 'Invoice rejected'), needs_human: t('Facture à vérifier', 'Invoice needs a person'), credited: t('Facture créditée', 'Invoice credited'),
    skipped: t('Pas de facture', 'No invoice'), shadow: t('Facture (essai à blanc)', 'Invoice (shadow test)'),
  } as Record<string, string>)[s] ?? s;
}

/** What the reason means, in plain words. A blocked sale's reason is "<code>: <detail>". */
function reasonText(t: T, raw?: string): string | null {
  if (!raw) return null;
  const [r, ...rest] = raw.split(': ');
  const detail = rest.join(': ');
  const review: Record<string, string> = {
    amounts_mismatch: t('Les montants de la plateforme ne s’additionnent pas : aucune facture n’est inventée. Corrigez la commande (articles, prix) ; elle part dès que les montants concordent.', 'The platform’s amounts do not add up: no invoice is made up. Fix the order (items, prices); it goes out as soon as the amounts agree.'),
    description_missing: t('Un article sans nom : la facture exige une description de chaque article. Corrigez la commande.', 'An item without a name: the invoice needs a description of every item. Fix the order.'),
    no_lines: t('Commande sans article : rien à facturer tant qu’elle n’a pas d’article.', 'Order without items: nothing to invoice until it has items.'),
  };
  if (review[r]) return detail ? `${review[r]} (${detail})` : review[r];
  const known: Record<string, string> = {
    tender_unknown: t('On ne sait pas encore comment le client a payé : choisissez-le ci-dessous.', 'We do not know yet how the customer paid: pick it below.'),
    qcmev_unreachable: t('Takatak MEV ne répond pas : Food Hub réessaie tout seul.', 'Takatak MEV does not answer: Food Hub tries again by itself.'),
    location_not_ready: t('Cette cuisine n’est pas prête dans Takatak MEV (appareil, certificat ou utilisateur).', 'This kitchen is not ready in Takatak MEV (device, certificate or user).'),
    queued: t('Takatak MEV l’a reçue et la signe dans un instant.', 'Takatak MEV has it and signs it in a moment.'),
    depends: t('Attend la facture d’origine.', 'Waiting for the original invoice.'),
    not_certified: t('Takatak MEV n’est pas dans le bon environnement (production certifiée exigée).', 'Takatak MEV is not in the right environment (certified production required).'),
    offline_pending: t('Signée hors ligne : elle part à Revenu Québec dès le retour de la connexion.', 'Signed offline: it goes to Revenu Québec as soon as the connection is back.'),
    log_order: t('Journal des sacs Too Good To Go (ancienne règle) : pas envoyé.', 'Too Good To Go bag log (old rule): not sent.'),
    dry_run: t('Commande d’essai : pas de facture.', 'Test order: no invoice.'),
  };
  return known[r] ?? raw;
}

export function MevBadge({ mev, className }: { mev?: MevRecord | null; className?: string }) {
  const { t } = useI18n();
  if (!mev || mev.status === 'skipped') return null;
  return <Badge tone={TONE[mev.status]} size="sm" className={className} icon={<ReceiptText className="size-3" />} title={mev.noTrans ? `${t('Facture', 'Invoice')} ${mev.noTrans}` : undefined}>{mevLabel(t, mev.status)}</Badge>;
}

export function MevPanel({ model, id, mev, onChange }: { model: 'stored' | 'direct'; id: string; mev: MevRecord; onChange?: () => void }) {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const act = can('orders:act');

  async function run(action: string, extra: Record<string, unknown> = {}, done?: string) {
    setBusy(action);
    try {
      await api(`/api/foodhub/mev/orders/${encodeURIComponent(id)}`, { method: 'POST', json: { model, action, ...extra } });
      if (done) toast.success(done);
      onChange?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  const issued = mev.status === 'accepted' || mev.status === 'offline' || mev.status === 'shadow';
  const ticket = model === 'direct' ? `/ticket/direct/${id}` : `/ticket/${id}`;
  const lastCopy = [...(mev.prints ?? [])].reverse().find((p) => p.text80mm?.length);
  // Printed once (Revenu Québec, « Modes d'impression »): the original, then each reprint / merchant copy, once each.
  const original = printableDoc(mev, 'FAC');
  const originalPrinted = printedAt(mev, original?.key);
  const copies = (['RPR', 'DUP'] as const).map((mode) => ({ mode, doc: printableDoc(mev, mode) })).filter((c) => c.doc && !printedAt(mev, c.doc.key));
  const when = (iso: string) => new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <section className="rounded-md border border-line bg-surface p-4 shadow-card" aria-label={t('Facture (MEV)', 'Invoice (MEV)')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body flex items-center gap-2 font-bold text-ink"><ReceiptText className="size-4" aria-hidden />{t('Facture (MEV)', 'Invoice (MEV)')}</h3>
        <Badge tone={TONE[mev.status]}>{mevLabel(t, mev.status)}</Badge>
        {mev.noTrans && <span className="num text-small text-ink-2">{t('n°', 'no.')} {mev.noTrans}</span>}
      </div>
      {reasonText(t, mev.reason) && <p className="text-small mt-2 text-ink-3">{reasonText(t, mev.reason)}</p>}
      {(mev.creditNotes?.length ?? 0) > 0 && <p className="text-small mt-2 text-ink-3">{t('Notes de crédit', 'Credit notes')} : {mev.creditNotes!.map((c) => `${c.noTrans ?? '…'} (${mevLabel(t, c.status)})`).join(', ')}</p>}
      {mev.text80mm?.length ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
          <pre className="max-h-72 min-w-0 flex-1 overflow-auto rounded-sm bg-sunken p-3 font-mono text-[12px] leading-snug whitespace-pre-wrap text-ink">{mev.text80mm.join('\n')}</pre>
          {/* eslint-disable-next-line @next/next/no-img-element -- QCMEV's QR as a data URL (an SVG in an <img> cannot run anything) */}
          {mev.qrImage && <img src={mev.qrImage} alt={t('Code QR de la transaction', 'Transaction QR code')} className="size-36 shrink-0 self-center bg-white p-1" />}
        </div>
      ) : null}
      {originalPrinted && <p className="text-small mt-2 text-ink-3">{t('Facture originale imprimée le', 'Original invoice printed on')} {when(originalPrinted)}. {t('Une autre copie : « Réimprimer (RPR) ».', 'Another copy: “Reprint (RPR)”.')}</p>}
      {lastCopy && <details className="mt-2"><summary className="text-small cursor-pointer text-ink-3">{lastCopy.mode === 'DUP' ? t('Dernière copie du commerçant', 'Last merchant copy') : t('Dernière réimpression', 'Last reprint')}</summary><pre className="mt-2 overflow-auto rounded-sm bg-sunken p-3 font-mono text-[12px] whitespace-pre-wrap">{lastCopy.text80mm!.join('\n')}</pre></details>}
      <div className="mt-3 flex flex-wrap gap-2">
        {issued && original && !originalPrinted && <a className={buttonClass('ghost', 'md')} href={ticket} target="_blank" rel="noreferrer"><Printer className="size-4" aria-hidden />{t('Imprimer la facture (une fois)', 'Print the invoice (once)')}</a>}
        {copies.map((c) => <a key={c.mode} className={buttonClass('ghost', 'md')} href={`${ticket}?copy=${c.mode}`} target="_blank" rel="noreferrer"><Printer className="size-4" aria-hidden />{c.mode === 'RPR' ? t('Imprimer la reproduction', 'Print the reproduction') : t('Imprimer la copie du commerçant', 'Print the merchant copy')}</a>)}
        {act && issued && mev.status !== 'shadow' && <Button variant="outline" loading={busy === 'reprint'} onClick={() => run('reprint', {}, t('Réimpression demandée', 'Reprint requested'))} icon={<RotateCcw className="size-4" />}>{t('Réimprimer (RPR)', 'Reprint (RPR)')}</Button>}
        {act && issued && mev.status !== 'shadow' && <Button variant="outline" loading={busy === 'merchant_copy'} onClick={() => run('merchant_copy', {}, t('Copie du commerçant demandée', 'Merchant copy requested'))} icon={<Copy className="size-4" />}>{t('Copie du commerçant (DUP)', 'Merchant copy (DUP)')}</Button>}
        {mev.token && issued && (mev.format === 'ELE' || mev.format === 'PEL') && <a className={buttonClass('ghost', 'md')} href={`/r/${mev.token}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />{t('Facture électronique', 'Electronic invoice')}</a>}
        {act && (mev.status === 'needs_human' || mev.status === 'rejected') && <Button variant="soft" loading={busy === 'replay'} onClick={() => run('replay', {}, t('Renvoyée', 'Sent again'))} icon={<RotateCcw className="size-4" />}>{t('Renvoyer', 'Send again')}</Button>}
      </div>
      {act && model === 'direct' && mev.reason === 'tender_unknown' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-small font-semibold text-ink-2">{t('Payée par :', 'Paid by:')}</span>
          {([['ARG', t('Comptant', 'Cash')], ['DEB', t('Débit', 'Debit')], ['CRE', t('Crédit', 'Credit')], ['CPR', t('Carte-cadeau', 'Gift card')], ['MIX', t('Plusieurs', 'Several')]] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant="outline" loading={busy === `tender:${k}`} onClick={() => { setBusy(`tender:${k}`); void run('tender', { tender: k }, t('Mode de paiement noté', 'Payment method noted')); }}>{label}</Button>
          ))}
        </div>
      )}
    </section>
  );
}
