import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function releaseSha(): string {
  return (
    process.env.FOODHUB_RELEASE_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.COOLIFY_COMMIT_SHA ||
    ''
  ).trim();
}

// Public release proof for deployment automation: commit SHA only, no settings or secrets.
export async function GET() {
  const sha = releaseSha();
  return NextResponse.json({
    ok: Boolean(sha),
    app: 'foodhub',
    sha: sha || null,
    shortSha: sha ? sha.slice(0, 7) : null,
    at: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
