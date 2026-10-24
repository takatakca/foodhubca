'use client';

import { use, useEffect, useRef, useState } from 'react';
import { MevTicketBlock } from '@/components/live/mev-ticket';
import type { DirectOrder } from '@/lib/foodhub/delivery/types';
import { api, money } from '@/lib/ui/api';

const SOURCE: Record<string, string> = { phone: 'TÉLÉPHONE', phone_ai: 'TÉLÉPHONE (IA)', clover: 'CLOVER', website: 'SITE WEB', manual: 'COMMANDE', clover_online: 'SITE WEB (CLOVER)' };

// 80 mm ticket of an own order (phone, website, storefront…), with its Revenu Québec invoice from Takatak MEV.
// Opens the print dialog by itself (?autoprint=0 to just look); ?copy=DUP prints the merchant copy, ?copy=RPR the reprint.
export default function DirectTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<DirectOrder | null>(null);
  const [error, setError] = useState('');
  const printed = useRef(false);
  const [copy] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('copy')));
  useEffect(() => { api<{ order: DirectOrder }>(`/api/foodhub/delivery/${id}`).then((d) => setOrder(d.order)).catch((e) => setError(String(e.message || e))); }, [id]);
  useEffect(() => {
    if (!order || printed.current) return;
    printed.current = true;
    if (new URLSearchParams(window.location.search).get('autoprint') !== '0') setTimeout(() => window.print(), 300);
  }, [order]);
  if (error) return <p style={{ padding: 16 }}>{error}</p>;
  if (!order) return <p style={{ padding: 16 }}>…</p>;
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <div style={{ padding: 16, background: 'white', minHeight: '100dvh' }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => window.print()} style={{ padding: '8px 14px', background: '#151514', color: 'white', borderRadius: 8, fontWeight: 700 }}>Imprimer / Print</button>
        <button type="button" onClick={() => window.close()} style={{ padding: '8px 14px', border: '1px solid #ccc', borderRadius: 8 }}>Fermer / Close</button>
      </div>
      <div className="ticket">
        <div className="t-center t-big">{SOURCE[order.source] ?? 'COMMANDE'}</div>
        <div className="t-center t-huge">{order.number}</div>
        <div className="t-center">{order.brandName}</div>
        <div className="t-rule" />
        <div className="t-row"><span>{order.fulfillment === 'pickup' ? 'POUR EMPORTER' : 'LIVRAISON'}</span><span>{time(order.placedAt)}</span></div>
        {order.readyAt && <div className="t-row"><span>PRÊTE À</span><strong>{time(order.readyAt)}</strong></div>}
        {order.customer.name && <div className="t-row"><span>Client</span><span>{order.customer.name.split(' ')[0]}</span></div>}
        {order.status === 'cancelled' && <div className="t-center t-big">*** ANNULÉE ***</div>}
        <div className="t-rule" />
        {order.lines.map((l, i) => (
          <div key={i} className="t-line">
            <div className="t-row"><strong>{l.quantity} × {l.name}</strong><span>{money(l.total)}</span></div>
            {l.modifiers.map((m, j) => <div key={j} className="t-mod">+ {m.quantity > 1 ? `${m.quantity}× ` : ''}{m.name}</div>)}
            {l.notes && <div className="t-mod">» {l.notes}</div>}
          </div>
        ))}
        {order.notes && <><div className="t-rule" /><div><strong>NOTE :</strong> {order.notes}</div></>}
        <div className="t-rule" />
        <div className="t-row"><span>Sous-total</span><span>{money(order.subtotal)}</span></div>
        {order.deliveryFee ? <div className="t-row"><span>Livraison</span><span>{money(order.deliveryFee)}</span></div> : null}
        <div className="t-row"><span>Taxes</span><span>{money(order.tax)}</span></div>
        {order.tip ? <div className="t-row"><span>Pourboire</span><span>{money(order.tip)}</span></div> : null}
        <div className="t-row t-big"><strong>TOTAL</strong><strong>{money(order.total)}</strong></div>
        <MevTicketBlock mev={order.mev} copy={copy} />
        <div className="t-rule" />
        <div className="t-center" style={{ fontSize: 11 }}>{order.posOrderId ? `Clover ${order.posOrderId}` : 'Pas dans Clover'} · TAKATAK</div>
      </div>
    </div>
  );
}
