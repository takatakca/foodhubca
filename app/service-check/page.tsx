import { getPlatformStores } from '@/lib/data/store-data';
import { runVerification } from '@/lib/backend/verification-engine';

export const dynamic = 'force-dynamic';

export default async function ServiceCheckPage() {
  const result = await getPlatformStores();
  const verification = runVerification(result.stores);
  return (
    <div className="grid">
      <h1>3-Service Check</h1>
      {result.warning && <div className="card"><span className="badge badge-yellow">Data source</span> <span className="small">{result.warning}</span></div>}
      <p className="small">Every brand/location must have DoorDash, Uber Eats, and SkipTheDishes. Uber/Skip rows populate from APIs after credential onboarding.</p>
      <table><thead><tr><th>Brand</th><th>Location</th><th>Service</th><th>Status</th><th>Fix</th></tr></thead><tbody>
        {verification.serviceChecks.map((r, i) => <tr key={i}><td>{r.brand_name}</td><td>{r.location_code}</td><td>{r.service}</td><td>{r.status}</td><td>{r.needs_fix ? <span className="badge badge-red">Needs fix</span> : <span className="badge badge-green">OK/monitor</span>}</td></tr>)}
      </tbody></table>
    </div>
  );
}
