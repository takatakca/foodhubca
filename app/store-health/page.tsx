import { getPlatformStores } from '@/lib/data/store-data';

export const dynamic = 'force-dynamic';

export default async function StoreHealthPage() {
  const result = await getPlatformStores();
  const stores = result.stores;
  const active = stores.filter(s => s.activation_status === 'active');
  const deactivated = stores.filter(s => s.activation_status === 'deactivated');
  return (
    <div className="grid">
      <h1>Store Health</h1>
      {result.warning && <div className="card"><span className="badge badge-yellow">Data source</span> <span className="small">{result.warning}</span></div>}
      {result.source === 'supabase' && <p className="small"><span className="badge badge-green">Live database</span> Showing platform_stores from Supabase.</p>}
      <div className="card"><strong>Rules:</strong> (Z) = active but closed. (I) or grey circle = deactivated.</div>
      <h2>Active Stores ({active.length})</h2>
      <table><thead><tr><th>Brand</th><th>Store</th><th>Location</th><th>Open Status</th><th>Platform</th></tr></thead><tbody>
        {active.map((s, i) => <tr key={i}><td>{s.brand_name}</td><td>{s.store_name}</td><td>{s.location_code}</td><td><span className="badge badge-yellow">{s.open_status}</span></td><td>{s.platform}</td></tr>)}
      </tbody></table>
      <h2>Deactivated Stores ({deactivated.length})</h2>
      <table><thead><tr><th>Brand</th><th>Store</th><th>Location</th><th>Action</th></tr></thead><tbody>
        {deactivated.map((s, i) => <tr key={i}><td>{s.brand_name}</td><td>{s.store_name}</td><td>{s.location_code}</td><td><span className="badge badge-red">Reactivate / verify mapping</span></td></tr>)}
      </tbody></table>
    </div>
  );
}
