/** Route-level skeleton keeps the console useful while server data loads. */
export default function ConsoleLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto w-full max-w-[1320px] space-y-6 px-4 py-6 sm:px-6">
      <span className="sr-only">Chargement de la console / Loading dashboard</span>
      <div aria-hidden="true" className="h-9 w-56 animate-pulse rounded-lg bg-sunken" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />)}
      </div>
      <div aria-hidden="true" className="h-64 animate-pulse rounded-xl border border-line bg-surface" />
    </div>
  );
}
