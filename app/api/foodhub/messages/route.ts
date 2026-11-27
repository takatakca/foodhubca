import { chunk } from '@/lib/foodhub/adapters/common';
import { inScope, withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { getDevice } from '@/lib/foodhub/identity/devices';
import { channelsStatus, listOutbox, type OutboxEntry } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { INCIDENTS } from '@/lib/foodhub/watch/engine';
import type { Incident } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

const MESSAGE_LIMIT = 300;
const INCIDENT_BATCH = 50;
const INCIDENT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function messageScope(actor: AuthUser): Promise<Set<string> | null> {
  if (!actor.deviceId) return actor.locations.length ? new Set(actor.locations) : null;
  const device = await getDevice(actor.deviceId);
  return new Set(device && !device.revoked && device.locationCode && inScope(actor, device.locationCode) ? [device.locationCode] : []);
}

async function historyForKitchens(rows: OutboxEntry[], locations: ReadonlySet<string>): Promise<OutboxEntry[]> {
  const linkedIds = rows.map(({ incidentId }) => incidentId)
    .filter((id): id is string => typeof id === 'string' && INCIDENT_ID.test(id));
  const ids = [...new Set(linkedIds)];
  const repo = getRepo();
  const incidents = (await Promise.all(chunk(ids, INCIDENT_BATCH).map((batch) =>
    repo.listDocs<Pick<Incident, 'locationCode'>>(INCIDENTS, { ids: batch, limit: batch.length }),
  ))).flat();
  const allowed = new Set(incidents.filter(({ data }) => data?.locationCode && locations.has(data.locationCode)).map(({ id }) => id));
  // The incident captures the kitchen at the time of the alert. Legacy messages without that evidence are account-wide.
  return rows.filter(({ incidentId }) => incidentId && allowed.has(incidentId));
}

// Everything the system sent (SMS, calls, emails, chat), recipients masked. Sign-in codes are never stored.
const history = withPerm('stores:map', async (_req, _ctx, actor) => {
  const scope = await messageScope(actor);
  const rows = scope?.size === 0 ? [] : await listOutbox(MESSAGE_LIMIT);
  const messages = scope ? await historyForKitchens(rows, scope).catch(() => null) : rows;
  if (!messages) return fail('Historique des messages temporairement indisponible. / Message history is temporarily unavailable.', 503);
  return ok({ messages, channels: channelsStatus() });
});

export async function GET(req: Request, ctx: unknown) {
  const response = await history(req, ctx);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
