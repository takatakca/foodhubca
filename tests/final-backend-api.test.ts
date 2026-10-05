// Release 1.4.0 — backend API group: ledger balance, ingestion rules, connector readiness,
// sync-now dedupe, UrbanPiper removal, authenticated /api/backend routes, Control Tower copy.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayoutLedgerPreview } from '../lib/backend/ledger';
import { analyzeIncomingEvent } from '../lib/backend/ingestion-supervisor';
import { inspectCredentialReadiness } from '../lib/backend/credential-onboarding-service';
import { getLiveConnector } from '../lib/backend/connectors/live-registry';
import { localSeed, seedStats } from '../lib/data/local-seed';

// Fake Supabase client: records the upsert/insert it receives and "inserts" only the first row
// (what PostgREST returns with ignoreDuplicates when the others already exist).
const fake = vi.hoisted(() => {
  const state = { table: '', upsert: null as null | { rows: any[]; opts: any }, insert: null as any };
  const client = {
    from(table: string) {
      state.table = table;
      return {
        upsert(rows: any[], opts: any) { state.upsert = { rows, opts }; return { select: async () => ({ data: rows.slice(0, 1).map((r, i) => ({ ...r, id: `rec-${i}` })), error: null }) }; },
        insert(row: any) { state.insert = row; return { select: () => ({ single: async () => ({ data: { id: 'run-1', ...row }, error: null }) }) }; },
      };
    },
  };
  return { state, client };
});
vi.mock('../lib/supabase/server', () => ({ hasSupabaseEnv: () => true, createServiceClient: () => fake.client, supabaseAdmin: () => fake.client }));
import { createSyncRun, insertIngestedRecords } from '../lib/backend/connector-run-service';

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const sum = (lines: Array<{ debit: number; credit: number }>) => lines.reduce((t, l) => ({ d: t.d + Math.round(l.debit * 100), c: t.c + Math.round(l.credit * 100) }), { d: 0, c: 0 });

describe('ledger preview (lib/backend/ledger)', () => {
  const base = { platform: 'uber_eats', gross_sales: 1000, taxes: 149.75, fees: 300, adjustments: 25, source_id: 'p-1' };
  it('without an actual payout the receivable stays open, no deposit is booked and the journal balances', () => {
    const d = createPayoutLedgerPreview(base);
    expect(d.lines.find((l) => l.account.endsWith('expected payout receivable'))?.debit).toBe(874.75);
    expect(d.lines.some((l) => l.account.includes('bank') || l.account.includes('variance'))).toBe(false);
    expect(d.lines.find((l) => l.account.endsWith('adjustments'))).toMatchObject({ debit: 0, credit: 25 });
    const t = sum(d.lines);
    expect(t.d).toBe(t.c);
    expect(d.totals).toEqual({ debit: 1174.75, credit: 1174.75 });
    expect(d.status).toBe('draft_review_required');
  });
  it('books a short deposit against the receivable with the shortfall on the variance line', () => {
    const d = createPayoutLedgerPreview({ ...base, actual_payout: 850 });
    expect(d.lines.find((l) => l.account.endsWith('bank deposit'))).toMatchObject({ debit: 850, credit: 0 });
    expect(d.lines.find((l) => l.account.endsWith('payout variance'))).toMatchObject({ debit: 24.75, credit: 0 });
    const t = sum(d.lines);
    expect(t.d).toBe(t.c);
  });
  it('books an overpayment as a credit variance and a real zero deposit as a full shortfall', () => {
    const over = createPayoutLedgerPreview({ ...base, actual_payout: 900 });
    expect(over.lines.find((l) => l.account.endsWith('payout variance'))).toMatchObject({ debit: 0, credit: 25.25 });
    expect(sum(over.lines).d).toBe(sum(over.lines).c);
    const zero = createPayoutLedgerPreview({ ...base, actual_payout: 0 });
    expect(zero.lines.find((l) => l.account.endsWith('payout variance'))?.debit).toBe(874.75);
    expect(sum(zero.lines).d).toBe(sum(zero.lines).c);
  });
  it('rounds every line to the cent (no 100.30000000000001)', () => {
    const d = createPayoutLedgerPreview({ platform: 'doordash', gross_sales: 100.1, tips: 0.2, actual_payout: 100.3, source_id: 'x' });
    expect(d.lines.find((l) => l.account.endsWith('expected payout receivable'))?.debit).toBe(100.3);
    expect(d.lines.find((l) => l.account.endsWith('taxes/tips clearing'))?.credit).toBe(0.2);
    const wholeCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
    expect(d.lines.every((l) => wholeCents(l.debit) && wholeCents(l.credit))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/\d\.\d{3,}/);
  });
});

describe('analyze-ingest rules (lib/backend/ingestion-supervisor)', () => {
  const ev = (payload: unknown, entityType = 'store') => analyzeIncomingEvent({ platform: 'uber_eats', entityType, externalId: 's1', payload: payload as Record<string, unknown> });
  it('does not flag "deactivated": false or an ONLINE status', () => {
    expect(ev({ deactivated: false, status: 'ONLINE' })).toEqual([]);
  });
  it('ignores a Clover order whose state is "closed" (completed) and words like disclosed', () => {
    expect(ev({ state: 'closed', note: 'disclosed, enclosed' }, 'order')).toEqual([]);
  });
  it('applies the (I) / (Z) rules to the store name', () => {
    expect(ev({ name: 'Po Poulet (I)' }).map((f) => f.type)).toEqual(['store_deactivated']);
    expect(ev({ store_name: 'Pi Pita (Z)' }).map((f) => f.type)).toEqual(['store_active_closed']);
  });
  it('reads activation_status / open_status / status fields', () => {
    expect(ev({ activation_status: 'deactivated' }).map((f) => f.type)).toEqual(['store_deactivated']);
    expect(ev({ status: 'INACTIVE' }).map((f) => f.type)).toEqual(['store_deactivated']);
    expect(ev({ open_status: 'closed' }).map((f) => f.type)).toEqual(['store_active_closed']);
    expect(ev({ status: 'closed' }).map((f) => f.type)).toEqual(['store_active_closed']);
  });
  it('survives a missing or non-object payload and still flags negative money', () => {
    expect(ev(undefined)).toEqual([]);
    expect(ev('oops')).toEqual([]);
    expect(ev({ total: -5 }, 'payout').map((f) => f.type)).toEqual(['negative_money_event']);
  });
});

describe('legacy live connectors use the real env names', () => {
  const keys = ['UBER_BASE_URL', 'UBER_CLIENT_ID', 'UBER_CLIENT_SECRET', 'UBER_ACCESS_TOKEN', 'SKIP_JET_BASE_URL', 'SKIP_JET_API_KEY', 'TGTG_WEBHOOK_SECRET', 'LIVE_CONNECTORS_GLOBAL_ENABLED'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('SkipTheDishes readiness asks for SKIP_JET_BASE_URL / SKIP_JET_API_KEY (what npm run setup writes)', () => {
    const r = inspectCredentialReadiness('skip_the_dishes');
    expect(r.requiredSecrets).toEqual(['SKIP_JET_BASE_URL', 'SKIP_JET_API_KEY']);
    expect(r.missingSecrets).toEqual(['SKIP_JET_BASE_URL', 'SKIP_JET_API_KEY']);
    process.env.SKIP_JET_BASE_URL = 'https://api.flytplatform.com'; process.env.SKIP_JET_API_KEY = 'k';
    expect(inspectCredentialReadiness('skip_the_dishes').readyForHealthCheck).toBe(true);
  });
  it('Too Good To Go reports blocked as webhook-only even with the live switch on', async () => {
    process.env.TGTG_WEBHOOK_SECRET = 's'; process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    const c = getLiveConnector('too_good_to_go');
    expect(c.requiredEnv).toEqual(['TGTG_WEBHOOK_SECRET']);
    const h = await c.testConnection();
    expect(h.status).toBe('blocked');
    expect(h.canCallLive).toBe(false);
    expect(h.message).toMatch(/webhook-only/i);
    expect(h.message).toMatch(/no public merchant API/i);
    await expect(c.sync({ syncType: 'orders' })).rejects.toThrow(/webhook-only/i);
  });
  it('Uber readiness needs UBER_CLIENT_ID + UBER_CLIENT_SECRET (or a static token), not just the base URL', async () => {
    process.env.UBER_BASE_URL = 'https://api.uber.com';
    const none = inspectCredentialReadiness('uber_eats');
    expect(none.readyForHealthCheck).toBe(false);
    expect(none.missingSecrets).toEqual(['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET']);
    expect(none.requiredSecrets).toEqual(['UBER_BASE_URL', 'UBER_CLIENT_ID', 'UBER_CLIENT_SECRET']);
    const health = await getLiveConnector('uber_eats').testConnection();
    expect(health.status).toBe('not_configured');
    expect(health.missingSecretKeys).toEqual(['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET']);
    process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret';
    expect(inspectCredentialReadiness('uber_eats').readyForHealthCheck).toBe(true);
    // live switch off → blocked (never "healthy" without a real call)
    expect((await getLiveConnector('uber_eats').testConnection()).status).toBe('blocked');
    delete process.env.UBER_CLIENT_ID; delete process.env.UBER_CLIENT_SECRET; process.env.UBER_ACCESS_TOKEN = 'tok';
    expect(inspectCredentialReadiness('uber_eats').missingSecrets).toEqual([]);
  });
});

describe('sync-now persistence (lib/backend/connector-run-service)', () => {
  it('upserts ingested records with the dedupe key and returns only the rows actually inserted', async () => {
    const rows = await insertIngestedRecords('run-1', [
      { platformKey: 'clover', recordType: 'order', externalId: 'o-1', amount: 10, rawPayload: { id: 'o-1' } },
      { platformKey: 'clover', recordType: 'order', externalId: 'o-2', amount: 12, rawPayload: { id: 'o-2' } },
    ]);
    expect(fake.state.table).toBe('ingested_platform_records');
    expect(fake.state.upsert?.opts).toEqual({ onConflict: 'platform_key,record_type,external_id', ignoreDuplicates: true });
    expect(fake.state.upsert?.rows).toHaveLength(2);
    expect(fake.state.upsert?.rows[0]).toMatchObject({ platform_key: 'clover', record_type: 'order', external_id: 'o-1', connector_run_id: 'run-1', currency: 'CAD' });
    expect(rows.map((r: any) => r.external_id)).toEqual(['o-1']);
  });
  it('records the requested window on the sync run', async () => {
    const run = await createSyncRun('clover', 'orders', { startDate: '2026-09-01', endDate: 'not-a-date' });
    expect(run.id).toBe('run-1');
    expect(fake.state.insert).toMatchObject({ platform_key: 'clover', sync_type: 'orders', status: 'running', source_window_start: '2026-09-01T00:00:00.000Z', source_window_end: null });
  });
});

describe('UrbanPiper is gone (locked decision)', () => {
  it('seed data no longer carries UrbanPiper locations', () => {
    expect(exists('data/actual/urbanpiper-confirmed-locations.json')).toBe(false);
    expect('urbanpiperLocations' in localSeed).toBe(false);
    expect('urbanpiperConfirmedLocations' in seedStats()).toBe(false);
    expect(seedStats().doordashStores).toBeGreaterThan(0);
  });
  it('fresh-install SQL has no UrbanPiper table or rows; the 1.4.0 patch cleans existing installs', () => {
    for (const f of ['schema.sql', 'seed.sql', 'rls.sql', 'storage.sql', 'phase25_live_connectors.sql', 'final_operational_patch.sql', 'rc4_security_patch.sql', 'foodhub.sql']) {
      expect(read(`supabase/${f}`).toLowerCase(), f).not.toContain('urbanpiper');
    }
    const patch = read('supabase/release_1_4_0_patch.sql');
    expect(patch).toContain('drop table if exists urbanpiper_locations;');
    expect(patch).toMatch(/delete from platforms p where p\.key = 'urbanpiper'/);
    expect(patch).toContain('create unique index if not exists ingested_platform_records_platform_type_external_uidx');
    expect(patch).toContain('on ingested_platform_records (platform_key, record_type, external_id)');
  });
  it('the one-paste installer includes the patch last and the scripts know about it', () => {
    const all = read('supabase/INSTALL_ALL.sql');
    const marker = '-- FILE: release_1_4_0_patch.sql';
    expect(all).toContain(marker);
    expect(all.indexOf(marker)).toBeGreaterThan(all.indexOf('-- FILE: foodhub.sql'));
    expect(all).toContain(read('supabase/release_1_4_0_patch.sql').trimEnd());
    expect(all.toLowerCase().indexOf('urbanpiper')).toBeGreaterThan(all.indexOf(marker));
    expect(read('scripts/build-install-sql.mjs')).toContain("'release_1_4_0_patch.sql'");
    expect(read('scripts/final-readiness-check.mjs')).toContain("'supabase/release_1_4_0_patch.sql'");
  });
});

describe('backend surface (source guards)', () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name === 'route.ts' ? [`${dir}/${e.name}`] : []));
  it('every /api/backend route is wrapped in withPerm (no anonymous handlers)', () => {
    const routes = walk('app/api/backend');
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) {
      const src = read(r);
      expect(src, r).toContain('withPerm(');
      expect(src, r).not.toMatch(/export async function (GET|POST|PUT|DELETE)/);
    }
    for (const r of ['app/api/backend/connectors/sync-now/route.ts', 'app/api/backend/connectors/live-health/route.ts', 'app/api/backend/connectors/autodiscover-live/route.ts', 'app/api/backend/connectors/controlled-sync/route.ts', 'app/api/backend/verification/run/route.ts', 'app/api/backend/ai/analyze-ingest/route.ts', 'app/api/backend/ledger/preview/route.ts']) {
      expect(read(r), r).toContain("withPerm('admin'");
    }
  });
  it('legacy GenericRest connectors, their routes and the webhook stub are deleted', () => {
    for (const f of ['lib/backend/connectors/index.ts', 'lib/backend/connectors/generic-rest.ts', 'lib/backend/connectors/base.ts', 'lib/backend/connectors/connector-types.ts', 'app/api/backend/connectors/autodiscover/route.ts', 'app/api/backend/connectors/health/route.ts', 'app/api/backend/webhooks/[platform]/route.ts', 'lib/backend/status-normalizer.ts', 'lib/backend/platform-entity-service.ts']) {
      expect(exists(f), f).toBe(false);
    }
    expect(read('lib/backend/credential-onboarding-service.ts')).not.toContain('assertOwnerEnabled');
  });
  it('store mapping routes enforce location scope and the brand/location catalog', () => {
    const stores = read('app/api/foodhub/stores/route.ts');
    expect(stores).toContain('getCatalog');
    expect(stores).toMatch(/inScope\(actor, existing\.locationCode\)/);
    expect(stores).toMatch(/inScope\(actor, store\.locationCode\)/);
    const activate = read('app/api/foodhub/uber-connect/activate/route.ts');
    expect(activate).toContain('getCatalog');
    expect(activate).toMatch(/inScope\(actor, p\.locationCode\)/);
  });
  it('placeholder screens redirect and are out of the sidebar; store screens say "seed snapshot"', () => {
    expect(read('app/settings/page.tsx')).toContain("redirect('/go-live')");
    expect(read('app/documents/page.tsx')).toContain("redirect('/finance/imports')");
    expect(read('app/ai-ingestion/page.tsx')).toContain("redirect('/fix-tasks')");
    const layout = read('app/layout.tsx');
    for (const href of ["'/settings'", "'/documents'", "'/ai-ingestion'"]) expect(layout).not.toContain(href);
    for (const p of ['app/store-health/page.tsx', 'app/fix-tasks/page.tsx', 'app/service-check/page.tsx', 'app/verification/page.tsx']) {
      const src = read(p);
      expect(src, p).toContain('Seed snapshot');
      expect(src, p).toContain('href="/"');
      expect(src, p).not.toMatch(/Live database|update these automatically|populate from APIs/);
    }
  });
});
