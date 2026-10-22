import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HubPage } from '@/components/public-hub/hub-page';
import { hubContext, hubMetadata, hubPageForSlug } from '@/lib/foodhub/public-hub';

// Public ON2GO.ca pages, French (/hub/…): open without a sign-in (proxy.ts, lib/foodhub/public-site.ts).
// Rendered per request: the App Market link and the base URL are server variables (no rebuild to change them).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const key = hubPageForSlug('fr', (await params).slug);
  return key ? hubMetadata(key, 'fr') : { robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const key = hubPageForSlug('fr', (await params).slug);
  if (!key) notFound();
  return <HubPage page={key} lang="fr" ctx={hubContext()} />;
}
