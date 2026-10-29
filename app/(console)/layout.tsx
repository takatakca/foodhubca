import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/shell/console-shell';
import { ViewerProvider } from '@/components/shell/viewer';
import { getFeatures } from '@/lib/foodhub/expansion/features';
import { getViewer, viewerCatalog } from '@/lib/foodhub/viewer';
import { effectiveViewMode, VIEW_COOKIE } from '@/lib/ui/view-mode';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const catalog = await viewerCatalog(viewer);
  // Expansion screens (own delivery, phone, retail) appear only once the owner turned them on.
  const features = Object.values(await getFeatures().catch(() => ({}))).filter((f) => f.on).map((f) => f.key);
  // Simple view by default; owners and managers may keep the full view (cookie read here, so no menu flashes).
  const mode = effectiveViewMode((await cookies()).get(VIEW_COOKIE)?.value, viewer);
  return (
    <ViewerProvider viewer={viewer} catalog={catalog} features={features} mode={mode}>
      <ConsoleShell>{children}</ConsoleShell>
    </ViewerProvider>
  );
}
