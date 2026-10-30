import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { LEAD_STATUSES, listLeads, supportEmail, updateLead, type LeadStatus } from '@/lib/foodhub/restaurant-leads';

export const dynamic = 'force-dynamic';

// Settings → Restaurant leads (owner only): the requests received from the ON2GO.ca "Join" form, newest first.
export const GET = withPerm('admin', async () => {
  const leads = await listLeads();
  return ok({ leads, statuses: LEAD_STATUSES, supportEmail: supportEmail() ? 'set' : null });
});

// Move a lead's status or write a note: { id, status?, notes? }
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const id = String(b.id || '').trim();
  if (!id) return fail('id requis. / id is required.');
  const patch: { status?: LeadStatus; notes?: string } = {};
  if (b.status !== undefined) {
    if (!(LEAD_STATUSES as readonly string[]).includes(String(b.status))) return fail(`status must be one of ${LEAD_STATUSES.join(', ')}`);
    patch.status = b.status as LeadStatus;
  }
  if (b.notes !== undefined) patch.notes = String(b.notes ?? '');
  const lead = await updateLead(id, patch, actor.username);
  if (!lead) return fail('Demande introuvable. / Lead not found.', 404);
  if (patch.status) {
    await logActivity({ actor: actor.username, source: 'dashboard', kind: 'settings', action: 'restaurant-lead-status', status: 'success', summary: `Demande ${lead.restaurant} → ${lead.status}`, detail: { leadId: lead.id, status: lead.status } });
  }
  return ok({ lead });
});
