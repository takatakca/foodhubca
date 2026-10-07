import { createClient } from '@supabase/supabase-js';

// The Supabase URL is read at RUN time, never at build time. Next.js replaces `process.env.NEXT_PUBLIC_…` with the
// value it had during `next build`, so a Docker/Coolify image built without it (or with an old one) would ignore the
// value the host gives at run time and silently fall back to memory mode. Reading through a computed key keeps it a
// real run-time lookup. SUPABASE_URL is accepted as a server-only alias.
const URL_KEYS = ['SUPABASE_URL', ['NEXT', 'PUBLIC', 'SUPABASE', 'URL'].join('_')];

export function supabaseUrl(): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  for (const k of URL_KEYS) if (env[k]) return env[k];
  return undefined;
}

export function hasSupabaseEnv() {
  return Boolean(supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabaseAdmin() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase server environment variables. Configure NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Backward-compatible service client alias used by backend services.
export function createServiceClient() {
  return supabaseAdmin();
}
