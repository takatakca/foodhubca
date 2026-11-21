/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  // Mail readers for Too Good To Go order e-mails (lib/foodhub/tgtg-email): loaded from node_modules at run time.
  serverExternalPackages: ['imapflow', 'mailparser'],
  // Old bookmarks from RC2–RC9 keep working.
  async redirects() {
    const map = [
      ['/foodhub', '/'], ['/foodhub/orders', '/orders'], ['/foodhub/orders/:id', '/orders/:id'], ['/foodhub/orders/:id/ticket', '/ticket/:id'],
      ['/foodhub/menu', '/menu'], ['/foodhub/availability', '/menu/86'], ['/foodhub/hours', '/stores/hours'], ['/foodhub/stores', '/stores/mapping'],
      ['/foodhub/analytics', '/insights'], ['/foodhub/reports', '/insights/reports'], ['/foodhub/activity', '/insights/activity'],
      ['/foodhub/users', '/settings/team'], ['/foodhub/business', '/settings/business'], ['/foodhub/channels', '/settings/channels'], ['/foodhub/tgtg', '/money/tgtg'],
      ['/finance', '/money'], ['/finance/reconciliation', '/money/reconciliation'], ['/finance/disputes', '/money/disputes'], ['/finance/payouts', '/money/payouts'],
      ['/finance/ledger', '/money/ledger'], ['/finance/imports', '/money/statements'], ['/finance/fees', '/money/fees'],
      ['/imports', '/money/statements'], ['/ledger', '/money/ledger'], ['/go-live', '/settings/go-live'], ['/fix-tasks', '/alerts'],
      ['/integrations', '/settings/channels'], ['/integrations/:path*', '/settings/channels'], ['/settings/users', '/settings/team'],
      ['/store-health', '/stores'], ['/service-check', '/stores'], ['/verification', '/money/reconciliation'], ['/ai-ingestion', '/alerts'],
      ['/documents', '/money/statements'], ['/qa', '/settings/go-live'],
    ];
    return map.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
  // The public landing's console stills (public/hub-media/, scripts/hub-media.mjs): a day in the browser, a week stale
  // while it revalidates. A new still gets a new file name when its picture changes a lot.
  async headers() {
    const publicHubHeaders = [
      { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    return [
      { source: '/hub/:slug*', headers: publicHubHeaders },
      { source: '/en/hub/:slug*', headers: publicHubHeaders },
      { source: '/hub-media/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
    ];
  },
};
export default nextConfig;
