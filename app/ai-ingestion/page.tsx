import { redirect } from 'next/navigation';

// 1.4.0: AI findings surface as tasks (Control Tower → Fix Tasks).
export default function AiIngestionPage() {
  redirect('/fix-tasks');
}
