import { IngestEvent } from '@/lib/types';

export type AiFinding = {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  title: string;
  detail: string;
  suggestedAction: string;
  sourceExternalId?: string;
};

export function analyzeIncomingEvent(event: IngestEvent): AiFinding[] {
  const findings: AiFinding[] = [];
  const payload = event.payload as Record<string, any>;
  const text = JSON.stringify(payload).toLowerCase();

  if (text.includes('deactivated') || text.includes('(i)')) {
    findings.push({
      severity: 'high',
      type: 'store_deactivated',
      title: `${event.platform} store appears deactivated`,
      detail: `Incoming ${event.entityType} ${event.externalId} contains deactivation indicators.`,
      suggestedAction: 'Create/reactivate platform store fix task and verify the Food Hub store mapping.',
      sourceExternalId: event.externalId
    });
  }

  if (text.includes('(z)') || text.includes('closed')) {
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
