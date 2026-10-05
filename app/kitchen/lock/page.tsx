import { KitchenLock } from './lock-view';

export const dynamic = 'force-dynamic';

export default async function KitchenLockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return <KitchenLock next={q.next && q.next.startsWith('/') && !q.next.startsWith('//') ? q.next : '/kitchen'} />;
}
