import { PlatformStore } from '@/lib/types';
import { runThreeServiceCheck } from './service-check';

export function runVerification(stores: PlatformStore[]) {
  const serviceChecks = runThreeServiceCheck(stores);
  const findings = serviceChecks.filter(r => r.needs_fix).map(r => ({
    severity: r.status === 'missing' ? 'high' : 'medium',
    type: r.status,
    title: `${r.service} issue for ${r.brand_name} / ${r.location_code}`,
    detail: r.note,
    suggestedAction: r.status === 'missing' ? 'Connect/map missing service.' : 'Reactivate platform store.'
  }));
  return {
    checkedAt: new Date().toISOString(),
    serviceChecks,
    findings,
    summary: {
      totalServiceChecks: serviceChecks.length,
      issues: findings.length,
      missing: serviceChecks.filter(s => s.status === 'missing').length,
      deactivated: serviceChecks.filter(s => s.status === 'present_deactivated').length,
      closed: serviceChecks.filter(s => s.status === 'present_closed').length
    }
  };
}
