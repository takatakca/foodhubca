import { IngestEvent } from '@/lib/types';

export type AiFinding = {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  title: string;
  detail: string;
  suggestedAction: string;
  sourceExternalId?: string;
};

const str = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const DEACTIVATED = new Set(['deactivated', 'inactive', 'disabled']);

/**
 * Locked status rules on the fields platforms actually use, not on the JSON text:
 *  - name "(I)" / activation_status or status = deactivated|inactive|disabled → deactivated
 *  - name "(Z)" / open_status or status = closed → active but closed
 * (So `{"deactivated": false}` or a Clover order `state: "closed"` no longer trips a finding.)
 */
export function analyzeIncomingEvent(event: IngestEvent): AiFinding[] {
  const findings: AiFinding[] = [];
  const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<string, any>;
  const name = str(payload.name ?? payload.store_name);
  const status = str(payload.status);
  const activation = str(payload.activation_status);
  const openStatus = str(payload.open_status);

  if (name.includes('(i)') || DEACTIVATED.has(activation) || DEACTIVATED.has(status)) {
    findings.push({
      severity: 'high',
      type: 'store_deactivated',
      title: `${event.platform} store appears deactivated`,
      detail: `Incoming ${event.entityType} ${event.externalId} contains deactivation indicators.`,
      suggestedAction: 'Create/reactivate platform store fix task and verify the Food Hub store mapping.',
      sourceExternalId: event.externalId
    });
  }

  if (name.includes('(z)') || openStatus === 'closed' || status === 'closed') {
    findings.push({
      severity: 'medium',
      type: 'store_active_closed',
      title: `${event.platform} store appears active but closed`,
      detail: `Incoming ${event.entityType} ${event.externalId} contains closed indicators.`,
      suggestedAction: 'Check opening hours/menu availability; do not classify as deactivated.',
      sourceExternalId: event.externalId
    });
  }

  const total = Number(payload.total ?? payload.total_amount ?? payload.payout ?? payload.amount);
  if (Number.isFinite(total) && total < 0) {
    findings.push({
      severity: 'high',
      type: 'negative_money_event',
      title: `Negative money event detected on ${event.platform}`,
      detail: `Amount is ${total}. This may be refund, chargeback, fee, or adjustment.`,
      suggestedAction: 'Route to reconciliation exception review.',
      sourceExternalId: event.externalId
    });
  }

  return findings;
}
