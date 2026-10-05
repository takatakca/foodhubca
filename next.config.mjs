/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
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
};
export default nextConfig;
