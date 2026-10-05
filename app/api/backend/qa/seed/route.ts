import { NextResponse } from 'next/server';
import { seedStats } from '@/lib/data/local-seed';
import { withPerm } from '@/lib/foodhub/auth';

export const dynamic = 'force-dynamic';

export const GET = withPerm('analytics:view', async () => {
  const stats = seedStats();
  return NextResponse.json({ ok: true, stats, checks: [
    { name: 'company_present', pass: stats.companies === 1 },
    { name: 'locations_present', pass: stats.locations >= 4 },
    { name: 'brands_present', pass: stats.brands >= 18 },
    { name: 'doordash_stores_present', pass: stats.doordashStores > 0 },
    { name: 'status_rules_populated', pass: stats.deactivatedStores > 0 && stats.closedStores > 0 }
  ]});
});
