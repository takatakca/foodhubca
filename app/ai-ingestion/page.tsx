export default function AiIngestionPage() {
  return (
    <main className="space-y-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">AI Ingestion Supervisor</h1>
        <p className="mt-2 text-sm text-slate-600">
          AI reviews incoming platform records after sync and creates findings for missing IDs, deactivated store markers, negative amounts, payout concerns, and mapping issues.
        </p>
      </section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Review API</h2>
        <p className="mt-2 text-sm text-slate-600">GET /api/backend/ai/live-ingestion-review</p>
      </section>
    </main>
  );
}
