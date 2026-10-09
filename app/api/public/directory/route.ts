import { NextResponse } from 'next/server';
import { allowedOrigin, buildPublicDirectory, getPublicDirectory } from '@/lib/foodhub/public-directory';

export const dynamic = 'force-dynamic';

// GET /api/public/directory: the restaurant directory feed for ON2GO.ca, QMAPS and partners (public facts only:
// brands, kitchens, hours, open now / open late, highlight dishes, order links). No sign-in (proxy.ts lets
// /api/public/ through). Cached 5 minutes in the server and by browsers / CDNs; CORS for on2go.ca, qmaps.ca and
// localhost (FOODHUB_PUBLIC_CORS_ORIGINS adds more). Reads never fail: without the database the seed answers.
function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

export async function GET(req: Request) {
  const body = await getPublicDirectory().catch((error) => {
    console.error('[foodhub] public directory fell back to the seed —', error instanceof Error ? error.message : error);
    return buildPublicDirectory();
  });
  return NextResponse.json(body, {
    headers: {
      ...corsHeaders(req),
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
