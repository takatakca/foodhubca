import { fail, ok } from '@/lib/foodhub/http';
import { authenticateApp, signedPath } from '@/lib/foodhub/suite/auth';

export const dynamic = 'force-dynamic';

// Setup check for a suite app: proves its name, secret and clock are right. Public route (proxy.ts), signed per app.
export async function GET(req: Request) {
  const a = authenticateApp(req, signedPath(req));
  if ('error' in a) return fail(a.error, a.status);
  return ok({ app: a.app.key, name: a.app.name, events: a.app.subscribed, serverTime: new Date().toISOString() });
}
