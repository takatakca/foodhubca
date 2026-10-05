import { NextResponse } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { createServiceClient, hasSupabaseEnv } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const GET = withPerm('analytics:view', async () => {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      findings: [],
      message: 'Supabase is not configured yet. AI ingestion findings are stored in Supabase; add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run the SQL install files.',
    }, { status: 200 });
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('ai_ingestion_findings')
    .select('*')
    .eq('review_status', 'open')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, configured: true, findings: data ?? [] });
});
