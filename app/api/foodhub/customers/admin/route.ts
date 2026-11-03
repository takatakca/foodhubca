import { withPerm } from '@/lib/foodhub/auth';
import { giftCardsConfigured, loyaltyConfigured } from '@/lib/foodhub/customers/adapters';
import { countCustomers, listCustomers } from '@/lib/foodhub/customers/store';
import { allowedCustomerTenants, tenantDisplayName } from '@/lib/foodhub/customers/types';
import { verifyReadiness } from '@/lib/foodhub/customers/verify';
import { ok } from '@/lib/foodhub/http';
import { maskPhone } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// Settings → Customers (read-only, signed in): how many verified customers, the last 20 (phone masked), the activity
// log entries about customers, and whether phone verification can text at all. Never a full phone, never a token.
export const GET = withPerm('analytics:view', async () => {
  const [count, recent, activity] = await Promise.all([countCustomers(), listCustomers({ limit: 2000 }), getRepo().listActivity({ kinds: ['customer'], limit: 50 })]);
  const readiness = verifyReadiness();
  return ok({
    count,
    verify: { ...readiness, provider: readiness.provider === 'twilio_verify' ? 'Twilio Verify' : 'Food Hub SMS code' },
    tenants: allowedCustomerTenants().map((t) => ({ slug: t, name: tenantDisplayName(t) })),
    adapters: { loyalty: loyaltyConfigured(), giftCards: giftCardsConfigured() },
    recent: recent.slice(0, 20).map((c) => ({
      id: c.id, phone: maskPhone(c.phone), name: c.name ?? null, email: c.email ? `${c.email.slice(0, 1)}…@${c.email.split('@')[1] ?? ''}` : null, lang: c.lang, tenants: c.tenants,
      marketingConsent: c.marketingConsent, addresses: c.addresses.length, favourites: c.favourites.length, createdAt: c.createdAt, verifiedAt: c.verifiedAt,
    })),
    activity: activity.map((a) => ({ at: a.at, action: a.action, status: a.status, summary: a.summary, actor: a.actor })),
  });
});
