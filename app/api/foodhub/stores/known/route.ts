import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { knownStores } from '@/lib/foodhub/known-stores';

export const dynamic = 'force-dynamic';

// The platform store ids you already have (e.g. your 7 Uber Eats UUIDs) with a brand / location suggestion
// and whether each one is linked yet. Read-only.
export const GET = withPerm('stores:map', async () => ok({ stores: await knownStores() }));
