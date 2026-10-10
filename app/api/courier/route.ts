import { NextResponse } from 'next/server';
import { courierToken, handleCourierRequest } from '@/lib/foodhub/delivery/courier-app';
import { readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Our couriers' page (/courier). No session: the courier's personal signed link is the credential, sent as
// "Authorization: Bearer <token>" (the page reads it from the link's #t=… fragment, never from the address).
// GET = his board; POST { action: "shift", onShift } or { action, deliveryId, note? } with action
// at_pickup | picked_up | at_dropoff | delivered | decline | problem.
export async function GET(req: Request) {
  const r = await handleCourierRequest(courierToken(req));
  return NextResponse.json(r.data, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const r = await handleCourierRequest(courierToken(req), await readJson(req));
  return NextResponse.json(r.data, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
}
