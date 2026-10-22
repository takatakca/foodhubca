/**
 * Loading placeholder for card and list views (staff and journal).
 * Decorative blocks are hidden from assistive technology; status is announced once.
 */
export function ListSkeleton({ rows = 3, label = 'Chargement… / Loading…' }: {
  rows?: number;
  label?: string;
}) {
  const count = Number.isFinite(rows) ? Math.max(1, Math.min(12, Math.trunc(rows))) : 3;
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-4 rounded-md border border-line bg-surface p-4">
          <div className="size-10 shrink-0 rounded-full bg-sunken motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-sunken motion-safe:animate-pulse" />
            <div className="h-3 w-3/5 rounded bg-sunken motion-safe:animate-pulse" />
          </div>
          <div className="hidden h-7 w-20 rounded bg-sunken motion-safe:animate-pulse sm:block" />
        </div>
      ))}
    </div>
  );
}
