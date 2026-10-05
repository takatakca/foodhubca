import { NextResponse } from 'next/server';
import { mimeFor, readImage } from '@/lib/foodhub/media';

export const dynamic = 'force-dynamic';

// Public menu photos (see proxy.ts): Uber Eats, DoorDash and Skip download them from here.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const buf = await readImage(name);
  if (!buf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': mimeFor(name), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
