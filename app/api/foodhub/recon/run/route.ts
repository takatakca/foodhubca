import { approvalGate } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { refreshCases } from '@/lib/foodhub/recon/automation';
import { withFinance } from '@/lib/foodhub/recon/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Re-check the last 90 days now: opens cases for new problems, closes the ones later payouts fixed.
export const POST = withFinance('finance:edit', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'money.edit', null, 're-check payouts');
  if (gate) return gate;
  return ok({ ...(await refreshCases(90, actor)) });
});
