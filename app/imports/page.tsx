import { redirect } from 'next/navigation';

// RC9: statement imports live in Payouts & Reconciliation.
export default function ImportsPage() {
  redirect('/finance/imports');
}
