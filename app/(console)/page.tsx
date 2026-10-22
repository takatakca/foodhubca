import { getViewer } from '@/lib/foodhub/viewer';
import { onboardingSteps } from '@/lib/foodhub/onboarding';
import { Overview } from './overview';

// Home. Owners and managers also get the three set-up steps ("Pour bien démarrer"), computed from what Food Hub can see
// working; the card hides itself once everything is done.
export default async function Home() {
  const viewer = await getViewer();
  const steps = viewer?.permissions.includes('stores:map') ? await onboardingSteps({ viewerHasPin: viewer.hasPin }).catch(() => null) : null;
  return <Overview steps={steps} />;
}
