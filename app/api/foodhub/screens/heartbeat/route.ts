import { fail, ok, readJson } from '@/lib/foodhub/http';
import { agentAuthorized, agentToken, heartbeatSchema, recordHeartbeat } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';

// Screen relay agent heartbeat (every 20 s): each screen's state (ok / login / crashed / blank), page title and host.
// Public route (see proxy.ts) — Authorization: Bearer FOODHUB_SCREENS_AGENT_TOKEN is the credential.
// The answer carries the "reload" commands asked from the console.
export async function POST(req: Request) {
  if (!agentToken()) return fail('Screen relay is off: FOODHUB_SCREENS_AGENT_TOKEN is not set (24+ characters).', 503);
  if (!agentAuthorized(req)) return fail('Unauthorized', 401);
  const parsed = heartbeatSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail('Invalid heartbeat', 400, { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
  const r = await recordHeartbeat(parsed.data);
  return ok({ ...r, serverTime: new Date().toISOString() });
}
