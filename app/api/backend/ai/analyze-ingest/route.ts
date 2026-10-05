import { analyzeIncomingEvent } from '@/lib/backend/ingestion-supervisor';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import type { IngestEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Rule-based review of one incoming platform record (diagnostic endpoint, nothing is stored).
export const POST = withPerm('admin', async (req) => {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('Body must be valid JSON.'); }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!b.platform || !b.entityType) return fail('platform and entityType are required.');
  const event: IngestEvent = {
    platform: String(b.platform) as IngestEvent['platform'],
    entityType: String(b.entityType),
    externalId: String(b.externalId ?? ''),
    payload: (b.payload && typeof b.payload === 'object' ? b.payload : {}) as Record<string, unknown>,
  };
  return ok({ findings: analyzeIncomingEvent(event) });
});
