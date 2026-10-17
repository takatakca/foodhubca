import { redirect } from 'next/navigation';
import { LEGAL_PATHS } from '@/lib/foodhub/legal';

export const dynamic = 'force-dynamic';

// /legal on its own (public, see proxy.ts): reviewers and customers who trim the URL land on the support page,
// which links to the privacy policy and the terms.
export default function LegalIndexPage(): never {
  redirect(LEGAL_PATHS.support);
}
