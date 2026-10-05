import { redirect } from 'next/navigation';

// 1.4.0: documents that exist today are payout statements (Payouts & Reconciliation → Statements).
export default function DocumentsPage() {
  redirect('/finance/imports');
}
