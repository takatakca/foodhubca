import { NextRequest, NextResponse } from 'next/server';
import { analyzeIncomingEvent } from '@/lib/backend/ingestion-supervisor';

export async function POST(req: NextRequest) {
  const event = await req.json();
  const findings = analyzeIncomingEvent(event);
  return NextResponse.json({ ok: true, findings });
}
