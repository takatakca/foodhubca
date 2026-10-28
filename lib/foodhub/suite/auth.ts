// Calls from a TAKATAK Suite app to Food Hub (/api/suite/v1/*): X-Takatak-App names the app, X-Takatak-Signature signs
// the body (POST) or the path + query (GET) with that app's own secret. A disconnected app is refused.
import { suiteApp, type SuiteAppConfig } from './apps';
import { APP_HEADER, SIGNATURE_HEADER, verifySuite } from './sign';

export function authenticateApp(req: Request, payload: string): { app: SuiteAppConfig } | { error: string; status: number } {
  const key = (req.headers.get(APP_HEADER) ?? '').trim().toLowerCase();
  const app = key ? suiteApp(key) : null;
  if (!app) return { error: 'Unknown app', status: 401 };
  if (!app.connected || !app.secret) return { error: `${app.name} is not connected on this Food Hub`, status: 403 };
  if (!verifySuite(app.secret, req.headers.get(SIGNATURE_HEADER), payload)) return { error: 'Bad or expired signature', status: 401 };
  return { app };
}

/** What a GET signs: the path with its query string, exactly as sent. */
export function signedPath(req: Request): string {
  const u = new URL(req.url);
  return `${u.pathname}${u.search}`;
}
