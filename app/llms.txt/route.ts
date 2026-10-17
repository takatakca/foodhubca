import { hubLlmsTxt } from '@/lib/foodhub/public-hub';

// /llms.txt: a plain-text summary of ON2GO Hub for AI assistants (French, then English). Public facts only.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(hubLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
