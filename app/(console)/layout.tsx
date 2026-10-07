import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/shell/console-shell';
import { ViewerProvider } from '@/components/shell/viewer';
import { getFeatures } from '@/lib/foodhub/expansion/features';
import { getViewer, viewerCatalog } from '@/lib/foodhub/viewer';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const catalog = await viewerCatalog(viewer);
  // Expansion screens (own delivery, phone, retail) appear only once the owner turned them on.
  const features = Object.values(await getFeatures().catch(() => ({}))).filter((f) => f.on).map((f) => f.key);
  return (
    <ViewerProvider viewer={viewer} catalog={catalog} features={features}>
      <ConsoleShell>{children}</ConsoleShell>
    </ViewerProvider>
  );
}
