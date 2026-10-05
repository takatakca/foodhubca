import Link from 'next/link';
import { requirePage } from '@/lib/foodhub/auth';
import { getPlatformStores } from '@/lib/data/store-data';
import { runVerification } from '@/lib/backend/verification-engine';

export const dynamic = 'force-dynamic';

export default async function VerificationPage() {
  await requirePage('analytics:view', '/verification');
  const result = await getPlatformStores();
  const verification = runVerification(result.stores);
  return (
    <div className="grid">
      <h1>AI Verification</h1>
      {result.warning && <div className="card"><span className="badge badge-yellow">Data source</span> <span className="small">{result.warning}</span></div>}
      <p className="small">Rule-based AI supervisor is active now. LLM analysis can be enabled later with a provider key. AI cannot approve or resolve issues.</p>
      <p className="small"><span className="badge badge-yellow">Seed snapshot</span> From your screenshots; live store status is on the <Link href="/">Command Center</Link>.</p>
      <div className="grid grid-4">
        <div className="card"><div className="small">Issues</div><div className="stat">{verification.summary.issues}</div></div>
        <div className="card"><div className="small">Missing Services</div><div className="stat">{verification.summary.missing}</div></div>
        <div className="card"><div className="small">Deactivated</div><div className="stat">{verification.summary.deactivated}</div></div>
        <div className="card"><div className="small">Closed</div><div className="stat">{verification.summary.closed}</div></div>
      </div>
      <table><thead><tr><th>Severity</th><th>Type</th><th>Issue</th><th>Suggested Action</th></tr></thead><tbody>
        {verification.findings.map((f, i) => <tr key={i}><td><span className="badge badge-red">{f.severity}</span></td><td>{f.type}</td><td>{f.title}<br/><span className="small">{f.detail}</span></td><td>{f.suggestedAction}</td></tr>)}
      </tbody></table>
    </div>
  );
}
