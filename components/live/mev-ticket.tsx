'use client';

// The Revenu Québec invoice block of the 80 mm ticket: QCMEV's lines printed exactly as received, with its QR where the
// receipt says "[CODE QR]". While the invoice is not issued, the ticket says so (never hand that paper to the customer).
import type { MevRecord } from '@/lib/foodhub/mev/types';

export function MevTicketBlock({ mev, copy }: { mev?: MevRecord | null; copy?: string | null }) {
  if (!mev || mev.status === 'skipped') return null;
  if (mev.status === 'shadow') return <div className="t-center" style={{ fontSize: 11 }}>MEV : essai à blanc (aucune facture)</div>;
  const want = copy === 'DUP' || copy === 'RPR' ? copy : null;
  const reprint = want ? [...(mev.prints ?? [])].reverse().find((p) => p.mode === want && p.text80mm?.length) : null;
  const lines = reprint?.text80mm ?? (mev.status === 'accepted' || mev.status === 'offline' ? mev.text80mm : undefined);
  if (mev.status === 'credited' && !reprint) {
    return <><div className="t-rule" /><div className="t-center t-big">FACTURE CRÉDITÉE</div><div className="t-center">NOTE DE CRÉDIT ÉMISE{mev.creditNotes?.at(-1)?.noTrans ? ` · N° ${mev.creditNotes.at(-1)!.noTrans}` : ''}</div></>;
  }
  if (!lines?.length) {
    return <><div className="t-rule" /><div className="t-center t-big">FACTURE À VENIR</div><div className="t-center">NE PAS REMETTRE AU CLIENT</div></>;
  }
  const at = lines.findIndex((l) => l.includes('[CODE QR]'));
  const before = at >= 0 ? lines.slice(0, at) : lines;
  const after = at >= 0 ? lines.slice(at + 1) : [];
  return (
    <>
      <div className="t-rule" />
      <pre className="t-mev" style={{ font: '12px/1.3 ui-monospace, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap', margin: 0 }}>{before.join('\n')}</pre>
      {/* eslint-disable-next-line @next/next/no-img-element -- QCMEV's QR as a data URL (an SVG in an <img> cannot run anything) */}
      {mev.qrImage && <img src={mev.qrImage} alt="Code QR de la transaction" style={{ display: 'block', width: '42mm', height: '42mm', margin: '4px auto', imageRendering: 'pixelated' }} />}
      {after.length > 0 && <pre className="t-mev" style={{ font: '12px/1.3 ui-monospace, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap', margin: 0 }}>{after.join('\n')}</pre>}
    </>
  );
}
