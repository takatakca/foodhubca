import { NextResponse, type NextRequest } from 'next/server';
import { skipAdapter } from '@/lib/foodhub/adapters/skip';
import { handleSkipMenuStatus } from '@/lib/foodhub/ops';
import { background, keepUnparsed, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// callback_url sent with every Skip menu push: JET reports whether the menu was published.
// Only an explicit success/failure for an identified restaurant closes a queued push; anything else is kept, not guessed.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  if (body === undefined) {
    background('keep unparsed skip menu status', () => keepUnparsed('skip', { raw: raw.slice(0, 20_000) }, 'Invalid JSON menu-status callback'));
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  background('skip menu status', async () => {
    const { keep } = await handleSkipMenuStatus(body);
    if (keep) await keepUnparsed('skip', body, keep);
  }, { channel: 'skip', body, kind: 'menu_publish' });
  return new NextResponse(null, { status: 200 });
}
