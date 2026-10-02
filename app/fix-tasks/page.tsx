import { getPlatformStores } from '@/lib/data/store-data';
import FinanceTasks from './finance-tasks';

export const dynamic = 'force-dynamic';

export default async function FixTasksPage() {
  const result = await getPlatformStores();
  const deactivated = result.stores.filter(s => s.activation_status === 'deactivated');
  const review = result.stores.filter(s => s.needs_review);
  return (
    <div className="grid">
      <h1>Fix Tasks</h1>
      {result.warning && <div className="card"><span className="badge badge-yellow">Data source</span> <span className="small">{result.warning}</span></div>}
      <FinanceTasks />
      <h2 style={{ fontSize: 17, margin: '8px 0 0' }}>Store tasks</h2>
      <p className="small">Generated from {result.source === 'supabase' ? 'the live database' : 'captured seed data'}; API discoveries update these automatically after sync.</p>
      <table><thead><tr><th>Priority</th><th>Brand</th><th>Store</th><th>Task</th></tr></thead><tbody>
        {deactivated.map((s, i) => <tr key={`d${i}`}><td><span className="badge badge-red">High</span></td><td>{s.brand_name}</td><td>{s.store_name}</td><td>Reactivate or verify deactivated {s.platform} store.</td></tr>)}
        {review.map((s, i) => <tr key={`r${i}`}><td><span className="badge badge-yellow">Review</span></td><td>{s.brand_name}</td><td>{s.store_name}</td><td>{s.review_note ?? 'Review mapping.'}</td></tr>)}
      </tbody></table>
    </div>
  );
}
