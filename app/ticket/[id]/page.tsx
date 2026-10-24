'use client';

import { use, useEffect, useRef, useState } from 'react';
import { api, money } from '@/lib/ui/api';
import { orderSourceLabel, type StoredOrder } from '@/lib/foodhub/types';
import { MevTicketBlock, mevHandles, useMevPrint } from '@/components/live/mev-ticket';

const LABEL: Record<string, string> = { uber_eats: 'UBER EATS', doordash: 'DOORDASH', skip: 'SKIPTHEDISHES', tgtg: 'TOO GOOD TO GO' };

// 80 mm kitchen / bag ticket. Opens the print dialog by itself; works with any receipt printer the browser sees.
// When Takatak MEV issues the order's invoice, the ticket carries no amount of its own: the only amounts on the paper
// are the SEV's invoice (printed once; a later ticket points to « Réimprimer (RPR) »). ?autoprint=0 = preview only.
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [error, setError] = useState('');
  const printed = useRef(false);
  // ?copy=DUP (merchant copy) or RPR (reprint): the Revenu Québec invoice copy QCMEV rendered for it.
  // (Read once on the client; nothing is drawn before the order arrives, so the server render never differs.)
  const [copy] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('copy')));
  const [preview] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autoprint') === '0');
  useEffect(() => { api<{ order: StoredOrder }>(`/api/foodhub/orders/${id}`).then((d) => setOrder(d.order)).catch((e) => setError(String(e.message || e))); }, [id]);
  const mev = order ? order.timeline?.mev ?? null : undefined;
  const print = useMevPrint('stored', id, mev, copy, preview);
  useEffect(() => {
    if (!order || printed.current || print.state === 'loading') return;
    printed.current = true;
    if (!preview) setTimeout(() => window.print(), 300);
  }, [order, print.state, preview]);
  if (error) return <p style={{ padding: 16 }}>{error}</p>;
  if (!order) return <p style={{ padding: 16 }}>…</p>;
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
  // Read from a Too Good To Go e-mail: one big label per bag follows the ticket (lib/foodhub/tgtg-email/ingest.ts).
  const raw = order.raw as { source?: string; tgtg?: { code?: string; firstName?: string | null; quantity?: number; pickupLabel?: string | null } } | null;
  const tgtg = raw?.source === 'tgtg_email' ? raw.tgtg ?? null : null;
  const bagCount = tgtg ? Math.min(20, Math.max(1, Number(tgtg.quantity) || 1)) : 0;
  // Takatak MEV issues this order's invoice: no other amount on the paper (one set of amounts, the SEV's).
  const sev = mevHandles(order.timeline?.mev);
  return (
    <div style={{ padding: 16, background: 'white', minHeight: '100dvh' }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => window.print()} style={{ padding: '8px 14px', background: '#151514', color: 'white', borderRadius: 8, fontWeight: 700 }}>Imprimer / Print</button>
        <button type="button" onClick={() => window.close()} style={{ padding: '8px 14px', border: '1px solid #ccc', borderRadius: 8 }}>Fermer / Close</button>
      </div>
      <div className="ticket">
        <div className="t-center t-big">{LABEL[order.channel] ?? order.channel}</div>
        {orderSourceLabel(order.orderSource) && <div className="t-center">{orderSourceLabel(order.orderSource)!.toUpperCase()}</div>}
        <div className="t-center t-huge">#{order.displayId || order.externalOrderId.slice(0, 8)}</div>
        <div className="t-center">{order.brandName ?? ''}</div>
        <div className="t-rule" />
        <div className="t-row"><span>{order.fulfillment === 'pickup' ? 'POUR EMPORTER' : 'LIVRAISON'}</span><span>{time(order.placedAt || order.createdAt)}</span></div>
        {order.timeline?.readyTarget && <div className="t-row"><span>PRÊTE À</span><strong>{time(order.timeline.readyTarget)}</strong></div>}
        {order.customerName && <div className="t-row"><span>Client</span><span>{order.customerName}</span></div>}
        {order.status === 'cancelled' && <div className="t-center t-big">*** ANNULÉE ***</div>}
        <div className="t-rule" />
        {order.lines.map((l, i) => (
          <div key={i} className="t-line">
            <div className="t-row"><strong>{l.quantity} × {l.name}</strong>{!sev && <span>{money(l.total)}</span>}</div>
            {l.modifiers.map((m, j) => <div key={j} className="t-mod">+ {m.quantity > 1 ? `${m.quantity}× ` : ''}{m.name}</div>)}
            {l.notes && <div className="t-mod">» {l.notes}</div>}
          </div>
        ))}
        {order.notes && <><div className="t-rule" /><div><strong>NOTE :</strong> {order.notes}</div></>}
        {!sev && (
          <>
            <div className="t-rule" />
            <div className="t-row"><span>Sous-total</span><span>{money(order.subtotal)}</span></div>
            {order.discount ? <div className="t-row"><span>Rabais</span><span>−{money(order.discount)}</span></div> : null}
            <div className="t-row"><span>Taxes</span><span>{money(order.tax)}</span></div>
            {order.deliveryFee ? <div className="t-row"><span>Livraison</span><span>{money(order.deliveryFee)}</span></div> : null}
            {order.tip ? <div className="t-row"><span>Pourboire</span><span>{money(order.tip)}</span></div> : null}
            <div className="t-row t-big"><strong>TOTAL</strong><strong>{money(order.total)}</strong></div>
            <div className="t-rule" />
          </>
        )}
        <MevTicketBlock mev={order.timeline?.mev} copy={copy} print={print} />
        <div className="t-rule" />
        <div className="t-center" style={{ fontSize: 11 }}>{order.posOrderId ? `Clover ${order.posOrderId}` : 'Pas dans Clover'} · TAKATAK</div>
        {tgtg && order.status !== 'cancelled' && bagCount > 0 && Array.from({ length: bagCount }, (_, i) => (
          <div key={i} className="t-bag">
            <div className="t-big">TOO GOOD TO GO</div>
            <div className="t-bag-name">{(tgtg.firstName || order.customerName || 'CLIENT').toUpperCase()}</div>
            <div className="t-big">{bagCount > 1 ? `SAC / BAG ${i + 1} / ${bagCount}` : 'SAC / BAG'}</div>
            <div className="t-rule" />
            <div>RAMASSAGE / PICKUP</div>
            <div className="t-bag-when">{tgtg.pickupLabel || '—'}</div>
            <div className="t-rule" />
            <div>CODE TGTG</div>
            <div className="t-bag-code">{tgtg.code || order.displayId}</div>
            {order.brandName && <div style={{ fontSize: 11, marginTop: 4 }}>{order.brandName}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
