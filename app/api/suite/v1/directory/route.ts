import { fail, ok } from '@/lib/foodhub/http';
import { authenticateApp, signedPath } from '@/lib/foodhub/suite/auth';
import { merchantApps } from '@/lib/foodhub/suite/directory';

export const dynamic = 'force-dynamic';

// GET /api/suite/v1/directory?merchant=<Clover merchant ID> — which TAKATAK Suite apps this restaurant has, and the
// address of each (for the app switcher). Signed like every suite call (path + query).
export async function GET(req: Request) {
  const a = authenticateApp(req, signedPath(req));
  if ('error' in a) return fail(a.error, a.status);
  const merchantId = new URL(req.url).searchParams.get('merchant') ?? '';
  if (!/^[A-Z0-9]{8,20}$/.test(merchantId)) return fail('merchant must be a Clover merchant ID');
  return ok({ merchantId, apps: await merchantApps(merchantId) });
}
