import { redirect } from 'next/navigation';

// RC9: the internal ledger is built from imported payout statements (Payouts & Reconciliation → Internal ledger).
export default function LedgerPage() {
  redirect('/finance/ledger');
}
