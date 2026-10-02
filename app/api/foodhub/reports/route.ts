import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { emailConfigured, listReportSchedules, REPORTS } from '@/lib/foodhub/reports';

export const dynamic = 'force-dynamic';

export const GET = withPerm('analytics:view', async () => ok({
  reports: Object.entries(REPORTS).map(([key, r]) => ({ key, ...r })),
  schedules: await listReportSchedules(),
  emailConfigured: emailConfigured(),
}));
