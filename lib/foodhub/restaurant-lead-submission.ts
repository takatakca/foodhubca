// Optional idempotency for the same-origin Food Hub enquiry form. Existing ON2GO callers need no new header.
import crypto from 'node:crypto';
import { getRepo } from './repo';
import { allowLead, getLead, saveLead, type LeadInput, type RestaurantLead } from './restaurant-leads';

interface Attempt { fingerprint: string; leadId: string; at: string }
export type LeadSubmission = { kind: 'accepted'; lead?: RestaurantLead } | { kind: 'invalid_key' | 'conflict' | 'pending' | 'rate' | 'unavailable' };
const keyOf = (key: string) => `restaurant_lead_attempt:${crypto.createHash('sha256').update(key).digest('hex')}`;

/** A replay acknowledges the already-stored request; it never creates another lead or sends another email. */
export async function submitRestaurantLead(input: LeadInput, key: string | null, ip: string): Promise<LeadSubmission> {
  if (key !== null && !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return { kind: 'invalid_key' };
  let repo: ReturnType<typeof getRepo>;
  try { repo = getRepo(); } catch { return { kind: 'unavailable' }; }
  if (process.env.NODE_ENV === 'production' && repo.mode !== 'supabase') return { kind: 'unavailable' };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const replay = async (attempt: Attempt | null): Promise<LeadSubmission> => {
    if (!attempt || typeof attempt.leadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attempt.leadId)) return { kind: 'unavailable' };
    if (attempt.fingerprint !== fingerprint) return { kind: 'conflict' };
    return await getLead(attempt.leadId) ? { kind: 'accepted' } : { kind: 'pending' };
  };
  try {
    if (key) {
      const existing = await repo.getKv<Attempt>(keyOf(key));
      if (existing) return await replay(existing);
    }
    if (!allowLead(ip)) return { kind: 'rate' };
    if (!key) return { kind: 'accepted', lead: await saveLead(input) };
    const attempt: Attempt = { fingerprint, leadId: crypto.randomUUID(), at: new Date().toISOString() };
    if (!await repo.claimKv(keyOf(key), attempt)) return await replay(await repo.getKv<Attempt>(keyOf(key)));
    try {
      return { kind: 'accepted', lead: await saveLead(input, attempt.at, attempt.leadId) };
    } catch {
      // A failed storage response may follow a committed write. Verify it, keep the claim, and never invent success.
      return await getLead(attempt.leadId) ? { kind: 'accepted' } : { kind: 'unavailable' };
    }
  } catch { return { kind: 'unavailable' }; }
}
