import { seedStats } from '@/lib/data/local-seed';
import { requirePage } from '@/lib/foodhub/auth';

export const dynamic = 'force-dynamic';

export default async function QaPage() {
  await requirePage('admin', '/qa');
  const s = seedStats();
  return <div className="grid"><h1>QA</h1><div className="card"><pre>{JSON.stringify(s, null, 2)}</pre></div><div className="card">Run <code>npm run qa:seed</code> and <code>npm run qa:env</code> locally after setup.</div></div>;
}
