import Link from 'next/link';
import { ADAPTERS } from '@/lib/foodhub/adapters';
import { liveConnectorsGloballyEnabled } from '@/lib/foodhub/config';
import { getCatalog } from '@/lib/foodhub/catalog';
import { getHours } from '@/lib/foodhub/hours';
import { getMenuLanguages } from '@/lib/foodhub/menu/language';
import { cloverAutoPrintEnabled, cloverReadiness } from '@/lib/foodhub/pos/clover';
import { cloverRecordPaymentEnabled } from '@/lib/foodhub/pos/clover-books';
import { COL } from '@/lib/foodhub/recon/engine';
import { getFees } from '@/lib/foodhub/recon/fees';
import { getRepo } from '@/lib/foodhub/repo';
import { lastSyncReport } from '@/lib/foodhub/sync';

export const dynamic = 'force-dynamic';

type Gate = { label: string; done: boolean; how: string; required: boolean };

// Live checklist: every line is computed from the real configuration, not ticked by hand.
export default async function GoLivePage() {
  const has = (k: string) => Boolean(process.env[k]);
  const repo = getRepo();
  const [stores, sync, catalog, hours, menus, users, fees, statements, languages] = await Promise.all([
    repo.listStores().catch(() => []), lastSyncReport().catch(() => null), getCatalog(), getHours().catch(() => null),
    repo.listMenus().catch(() => []), repo.listUsers().catch(() => []),
    getFees().catch(() => null), repo.listDocs(COL.imports, { limit: 1 }).catch(() => []), getMenuLanguages().catch(() => null),
  ]);
  const usedChannels = [...new Set(stores.map((s) => s.channel))];
  const plansConfirmed = usedChannels.filter((c) => fees?.confirmed[c]).length;
  const frenchMenus = menus.filter((m) => m.items.some((i) => i.nameFr)).length;
  const locs = catalog.locations.filter((l) => l.active);
  const withHours = locs.filter((l) => hours?.locations[l.code]).length;
  const mappedBrands = [...new Set(stores.map((s) => s.brandName))];
  const menusReady = mappedBrands.filter((b) => menus.some((m) => m.brandName === b && m.items.length > 0)).length;
  const clover = cloverReadiness();
  const r = (k: keyof typeof ADAPTERS) => ADAPTERS[k].readiness();
  const gates: Gate[] = [
    { label: 'Database connected (Supabase) and supabase/INSTALL_ALL.sql run', done: repo.mode === 'supabase', how: 'npm run setup → Supabase keys; paste INSTALL_ALL.sql in Supabase SQL Editor', required: true },
    { label: 'Dashboard password set', done: has('DASHBOARD_PASSWORD'), how: 'npm run setup → DASHBOARD_PASSWORD', required: true },
    { label: 'Public URL set (webhook URLs shown on Channels)', done: has('FOODHUB_PUBLIC_URL') || has('VERCEL_URL'), how: 'npm run setup → FOODHUB_PUBLIC_URL', required: true },
    { label: 'Clover connected (orders reach the kitchen)', done: clover.configured, how: clover.missing.join(', ') || 'OK', required: true },
    { label: 'Uber Eats connected', done: r('uber_eats').configured, how: r('uber_eats').missing.join(', ') || 'OK', required: true },
    { label: 'DoorDash connected', done: r('doordash').configured, how: r('doordash').missing.join(', ') || 'OK', required: true },
    { label: 'SkipTheDishes connected (JET Connect)', done: r('skip').configured, how: r('skip').missing.join(', ') || 'OK', required: true },
    { label: 'Too Good To Go webhook token (optional)', done: r('tgtg').configured, how: 'TGTG_WEBHOOK_SECRET — only if TGTG gives you an order feed', required: false },
    { label: 'Stores mapped (store id → brand + location + Clover)', done: stores.length > 0, how: `${stores.length} mapped — Food Hub → Stores`, required: true },
    { label: 'Store hours set for every location', done: locs.length > 0 && withHours === locs.length, how: `${withHours}/${locs.length} locations — Food Hub → Store Hours (without hours, a published menu shows 24/7)`, required: true },
    { label: 'Master menu built for every mapped brand', done: mappedBrands.length > 0 && menusReady === mappedBrands.length, how: `${menusReady}/${mappedBrands.length} brands — Menu Manager → Import from Clover, check, Publish`, required: true },
    { label: 'Team logins created (managers, store staff)', done: users.length > 0, how: `${users.length} user(s) — Food Hub → Users & Roles`, required: false },
    { label: 'Kitchen ticket auto-print on Clover', done: clover.configured && cloverAutoPrintEnabled(), how: cloverAutoPrintEnabled() ? 'On (FOODHUB_CLOVER_AUTOPRINT); optional CLOVER_PRINT_DEVICE_ID picks the printer' : 'Off — set FOODHUB_CLOVER_AUTOPRINT=on', required: false },
    { label: 'Clover bookkeeping: platform orders recorded as paid (Uber Eats / DoorDash / Skip / TGTG tenders)', done: clover.configured && cloverRecordPaymentEnabled(), how: cloverRecordPaymentEnabled() ? 'On — paid in Clover when the order leaves the kitchen; cancelled orders are removed from the register' : 'Off — remove FOODHUB_CLOVER_RECORD_PAYMENT=off', required: false },
    { label: 'Clover inventory webhook (86 from Clover reaches every platform instantly)', done: has('CLOVER_WEBHOOK_AUTH'), how: has('CLOVER_WEBHOOK_AUTH') ? 'Set' : 'Optional — without it, Food Hub checks Clover items on every sync. Channels → Clover webhook', required: false },
    { label: 'Commission plans confirmed (expected payouts)', done: usedChannels.length > 0 && plansConfirmed === usedChannels.length, how: `${plansConfirmed}/${usedChannels.length} platforms — Payouts & Money → Commission Plans`, required: false },
    { label: 'First payout statement imported (reconciliation starts)', done: statements.length > 0, how: statements.length ? 'Done — Payouts & Money → Statements' : 'Payouts & Money → Statements (or request the Uber Eats report)', required: false },
    { label: 'French menus (Quebec)', done: frenchMenus > 0, how: `${frenchMenus}/${menus.length} menus have French names · Uber Eats: ${languages?.uber_eats ?? 'both'}, DoorDash: ${languages?.doordash ?? 'en'}, Skip: ${languages?.skip ?? 'en'} — Menu Manager → Languages`, required: false },
    { label: 'Report emails (Resend)', done: has('RESEND_API_KEY') && has('REPORT_EMAIL_FROM'), how: 'RESEND_API_KEY + REPORT_EMAIL_FROM — for emailed / scheduled reports', required: false },
    { label: 'Webhook URLs + secrets given to each platform', done: stores.length > 0 && r('uber_eats').configured, how: 'Food Hub → Channels → “Show secrets to give platforms”', required: true },
    { label: 'Scheduled sync secret set', done: has('CRON_SECRET'), how: 'npm run setup generates CRON_SECRET', required: false },
    { label: 'First status sync ran', done: Boolean(sync), how: sync ? `last sync ${new Date(sync.at).toLocaleString('fr-CA')}` : 'open the Command Center (it syncs automatically)', required: false },
    { label: 'LIVE switch on', done: liveConnectorsGloballyEnabled(), how: 'LIVE_CONNECTORS_GLOBAL_ENABLED=true (last step)', required: true },
  ];
  const doneRequired = gates.filter((g) => g.required && g.done).length;
  const totalRequired = gates.filter((g) => g.required).length;
  return (
    <div>
      <div className="fh-head">
        <div>
          <h1>Go-Live Checklist</h1>
          <div className="small">Computed from your real configuration. {doneRequired}/{totalRequired} required steps done.</div>
        </div>
        <Link className="button" href="/foodhub/channels">Open Channels &amp; Setup</Link>
      </div>
      <table>
        <thead><tr><th></th><th>Step</th><th>How / status</th></tr></thead>
        <tbody>
          {gates.map((g, i) => (
            <tr key={g.label}>
              <td><span className={`badge ${g.done ? 'badge-green' : g.required ? 'badge-red' : 'badge-yellow'}`}>{g.done ? 'Done' : g.required ? 'To do' : 'Optional'}</span></td>
              <td><strong>{i + 1}. {g.label}</strong></td>
              <td className="small">{g.how}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
