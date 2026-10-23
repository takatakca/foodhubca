import { Skeleton } from '@/components/ui/card';

/**
 * Route-level skeleton keeps the console useful while server data loads. One loading status for the screen reader;
 * the shapes are A4's `Skeleton` (motion-safe, 12 px radius) inside the shell's own page width and gutters.
 */
export default function ConsoleLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Chargement de la console / Loading dashboard</span>
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 border border-line bg-surface shadow-card" />)}
      </div>
      <Skeleton className="h-64 border border-line bg-surface shadow-card" />
    </div>
  );
}
