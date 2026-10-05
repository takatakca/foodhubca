import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/shell/console-shell';
import { ViewerProvider } from '@/components/shell/viewer';
import { getViewer, viewerCatalog } from '@/lib/foodhub/viewer';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const catalog = await viewerCatalog(viewer);
  return (
    <ViewerProvider viewer={viewer} catalog={catalog}>
      <ConsoleShell>{children}</ConsoleShell>
    </ViewerProvider>
  );
}
