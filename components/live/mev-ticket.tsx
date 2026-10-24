'use client';

// The Revenu Québec invoice block of the 80 mm ticket: QCMEV's lines printed exactly as received, with its QR on the
// "[CODE QR]" line. Rules (Revenu Québec, « Modes d'impression »):
//   - one document is printed ONCE: the first ticket claims it (POST /api/foodhub/mev/orders/{id}/print); a later ticket
//     says it was printed and points to « Réimprimer (RPR) », which Takatak MEV issues and transmits;
//   - ?autoprint=0 is a preview: the invoice shows on screen and never prints (the print shows « APERÇU »);
//   - while the invoice is not issued, the ticket says so (never hand that paper to the customer).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MevRecord } from '@/lib/foodhub/mev/types';
import { copyOf, printableDoc, type PrintCopy } from '@/lib/foodhub/mev/printable';
import { api } from '@/lib/ui/api';

export type MevPrintState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'granted' }
  | { state: 'preview' }
  | { state: 'refused'; at?: string };

/** Is the order's invoice handled by Takatak MEV? Then the ticket shows no amount of its own (only the SEV's invoice). */
export function mevHandles(mev?: MevRecord | null): boolean {
  return !!mev && mev.status !== 'skipped' && mev.status !== 'shadow';
}

/** Claims the document for this ticket (once per document); a preview never claims. */
export function useMevPrint(model: 'stored' | 'direct', id: string, mev: MevRecord | null | undefined, copy: string | null, preview: boolean): MevPrintState {
  const want: PrintCopy = copyOf(copy);
  const doc = printableDoc(mev, want);
  const [st, setSt] = useState<MevPrintState>({ state: 'loading' });
  const asked = useRef<string | null>(null);
  const docKey = doc?.key ?? null;
  useEffect(() => {
    if (mev === undefined) return;
    if (!docKey) { setSt({ state: 'none' }); return; }
    if (preview) { setSt({ state: 'preview' }); return; }
    if (asked.current === docKey) return;
    asked.current = docKey;
    setSt({ state: 'loading' });
    api<{ granted: boolean; at?: string }>(`/api/foodhub/mev/orders/${encodeURIComponent(id)}/print`, { method: 'POST', json: { model, copy: want } })
      .then((r) => setSt(r.granted ? { state: 'granted' } : { state: 'refused', at: r.at }))
      .catch(() => setSt({ state: 'refused' }));
  }, [mev, docKey, preview, id, model, want]);
  // Printed once: after this ticket printed it, the same page cannot print the original again.
  useEffect(() => {
    if (st.state !== 'granted') return;
    const after = () => setSt({ state: 'refused', at: new Date().toISOString() });
    window.addEventListener('afterprint', after);
    return () => window.removeEventListener('afterprint', after);
  }, [st.state]);
  return st;
}

/** 42 columns always fit the paper: the font shrinks when a printer's monospace font is wider than expected. */
function useFit42(dep: unknown) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.fontSize = '';
    const pres = [...box.querySelectorAll('pre')];
    const widest = Math.max(0, ...pres.map((p) => p.scrollWidth));
    if (widest > box.clientWidth && box.clientWidth > 0) {
      const px = parseFloat(getComputedStyle(pres[0] ?? box).fontSize) || 9;
      box.style.fontSize = `${Math.floor((px * box.clientWidth * 0.98 * 100) / widest) / 100}px`;
    }
  }, [dep]);
  return ref;
}

function Lines({ lines, qrImage }: { lines: string[]; qrImage?: string }) {
  const at = lines.findIndex((l) => l.trim() === '[CODE QR]');
  const before = at >= 0 ? lines.slice(0, at) : lines;
  const after = at >= 0 ? lines.slice(at + 1) : [];
  const ref = useFit42(lines);
  return (
    <div ref={ref} className="t-mev-box">
      <pre className="t-mev">{before.join('\n')}</pre>
      {/* eslint-disable-next-line @next/next/no-img-element -- QCMEV's QR as a data URL (an SVG in an <img> cannot run anything) */}
      {at >= 0 && qrImage && <img src={qrImage} alt="Code QR de la transaction" className="t-mev-qr" />}
      {after.length > 0 && <pre className="t-mev">{after.join('\n')}</pre>}
    </div>
  );
}

export function MevTicketBlock({ mev, copy, print }: { mev?: MevRecord | null; copy?: string | null; print: MevPrintState }) {
  if (!mev || mev.status === 'skipped') return null;
  if (mev.status === 'shadow') return <div className="t-center" style={{ fontSize: 11 }}>MEV : essai à blanc (aucune facture)</div>;
  const want = copyOf(copy);
  const doc = printableDoc(mev, want);
  if (mev.status === 'credited' && want === 'FAC') {
    return <><div className="t-rule" /><div className="t-center t-big">FACTURE CRÉDITÉE</div><div className="t-center">NOTE DE CRÉDIT ÉMISE{mev.creditNotes?.at(-1)?.noTrans ? ` · N° ${mev.creditNotes.at(-1)!.noTrans}` : ''}</div></>;
  }
  if (!doc) {
    if (want !== 'FAC') return <><div className="t-rule" /><div className="t-center t-big">COPIE PAS ENCORE ÉMISE</div><div className="t-center">NE PAS REMETTRE AU CLIENT</div></>;
    if (mev.format === 'ELE') return <><div className="t-rule" /><div className="t-center">Facture électronique (aucune copie papier)</div></>;
    if (mev.format === 'NON') return <><div className="t-rule" /><div className="t-center">Vente transmise, non imprimée</div></>;
    return <><div className="t-rule" /><div className="t-center t-big">FACTURE À VENIR</div><div className="t-center">NE PAS REMETTRE AU CLIENT</div></>;
  }
  if (print.state === 'loading') return <><div className="t-rule" /><div className="t-center">Facture…</div></>;
  if (print.state === 'refused' || print.state === 'none') {
    const when = print.state === 'refused' && print.at ? new Date(print.at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : null;
    return (
      <>
        <div className="t-rule" />
        <div className="t-center t-big">{want === 'FAC' ? 'FACTURE DÉJÀ IMPRIMÉE' : 'COPIE DÉJÀ IMPRIMÉE'}</div>
        {when && <div className="t-center">le {when}</div>}
        <div className="t-center">Autre copie : « Réimprimer (RPR) » dans la commande</div>
      </>
    );
  }
  const qrImage = doc.qrImage;
  if (print.state === 'preview') {
    return (
      <>
        <div className="t-rule" />
        <div className="t-mev-preview"><Lines lines={doc.lines} qrImage={qrImage} /></div>
        <div className="t-mev-preview-print t-center t-big">APERÇU — PAS UNE FACTURE</div>
      </>
    );
  }
  return <><div className="t-rule" /><Lines lines={doc.lines} qrImage={qrImage} /></>;
}
