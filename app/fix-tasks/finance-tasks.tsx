'use client';

// RC9: open payout problems (missing orders, short payments, error charges) as fix tasks.
// Hidden for users who only see some locations (finance covers every location's money).
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Case = { id: string; type: string; channel: string; ref: string; orderId: string | null; brandName: string | null; amount: number; status: string; openedAt: string };
const TYPE: Record<string, string> = { short_paid: 'paid less than expected', missing: 'missing from payout', error_charge: 'error charge', refunded: 'refund / chargeback', unknown_order: 'paid order not in Food Hub', deposit_gap: 'deposit differs from statement' };
const CH: Record<string, string> = { uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', tgtg: 'Too Good To Go' };

export default function FinanceTasks() {
  const [cases, setCases] = useState<Case[] | null>(null);
  useEffect(() => {
    fetch('/api/foodhub/recon/cases?status=open,disputed', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setCases(d?.cases ?? null)).catch(() => setCases(null));
  }, []);
  if (!cases) return null;
  const money = (n: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);
  return (
    <section className="card">
      <div className="fh-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Payout problems ({cases.length} · {money(cases.filter((c) => c.type !== 'unknown_order').reduce((s, c) => s + c.amount, 0))} to recover)</h2>
        <Link href="/finance/disputes">Open Disputes →</Link>
      </div>
      {cases.length === 0 ? <p className="small" style={{ margin: 0 }}>No open payout problem.</p> : (
        <table>
          <thead><tr><th>Priority</th><th>Platform</th><th>Order</th><th>Task</th></tr></thead>
          <tbody>
            {cases.slice(0, 25).map((c) => (
              <tr key={c.id}>
                <td><span className={`badge ${c.amount >= 25 && c.type !== 'unknown_order' ? 'badge-red' : 'badge-yellow'}`}>{c.amount >= 25 && c.type !== 'unknown_order' ? 'High' : 'Review'}</span></td>
                <td>{CH[c.channel] ?? c.channel}</td>
                <td>{c.orderId ? <Link href={`/foodhub/orders/${c.orderId}`}>#{c.ref}</Link> : c.ref}{c.brandName ? <span className="small"> · {c.brandName}</span> : null}</td>
                <td>{c.type === 'unknown_order' ? `Check the store mapping: ${TYPE[c.type]} (${money(c.amount)} paid)` : `${c.status === 'disputed' ? 'Follow up the dispute' : 'Dispute'}: ${TYPE[c.type] ?? c.type} — ${money(c.amount)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
