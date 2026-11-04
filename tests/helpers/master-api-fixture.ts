// Executes the selected V1 production handlers/auth/parser unchanged, with isolated synthetic env and DB fixtures.
// No V1 writes, generated client, live DB, identity creation or real credentials are used.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const v1 = path.resolve(here, '../../../takatak-v1');
export const masterApiSourceAvailable = fs.existsSync(path.join(v1, 'src/app/api/v1/events/route.ts'));
const localRequire = createRequire(path.resolve(here, '../../package.json'));
export const SYNTHETIC_MASTER_KEY = 'synthetic-foodhub-master-key-0123456789';
export const SYNTHETIC_MASTER_ID = '818b8f9c-3fcf-4ab9-bf76-8b34c3be4fd9';
class FixturePrismaError extends Error { code = 'P2002'; }

export function masterApiFixture(now: number) {
  const events = new Map<string, Record<string, unknown>>();
  const calls: Array<{ path: string; body: string; authorization: string | null; idempotency: string | null }> = [];
  const sourceMerchant = { merchantId: SYNTHETIC_MASTER_ID, storeName: 'Synthetic restaurant group', storeSlug: 'synthetic', marketplaceStatus: 'active', subscriptionStatus: 'source-reported', subscriptionPlan: 'Source plan', lastSynchronizedAt: new Date(now) };
  let available = true;
  let known = true;
  const prisma = {
    sourceMerchant: { findUnique: async ({ where }: { where: { sourceApplication_externalMerchantId: { sourceApplication: string; externalMerchantId: string } } }) => {
      if (!available) throw new Error('fixture database unavailable');
      const input = where.sourceApplication_externalMerchantId;
      return known && input.sourceApplication === 'foodhub' && input.externalMerchantId === 'synthetic-vendor' ? sourceMerchant : null;
    } },
    sourceProfile: { findUnique: async () => { throw new Error('Customer identity lookup is outside counts-only proof'); } },
    sourceSynchronizationEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) => { if (!available) throw new Error('fixture database unavailable');return events.get(where.eventId) ?? null; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (events.has(String(data.eventId))) throw new FixturePrismaError();
        const row = { ...data, id: crypto.randomUUID() };events.set(String(data.eventId), row);return row;
      },
    },
  };
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(input: string): Record<string, unknown> {
    let filename = input;
    if (!filename.endsWith('.ts')) filename += '.ts';
    if (modules.has(filename)) return modules.get(filename)!.exports;
    const source = fs.readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const mod = { exports: {} as Record<string, unknown> };modules.set(filename, mod);
    const requireFixture = (name: string): unknown => {
      if (name === 'server-only') return {};
      if (name === '@prisma/client') return { Prisma: { PrismaClientKnownRequestError: FixturePrismaError } };
      if (name === '@/lib/db/prisma') return { getPrisma: () => prisma };
      if (name === './identity' || name === './merchant') return { resolveMasterPerson: async () => { throw new Error('Identity mutation forbidden in fixture'); }, resolveMasterMerchant: async () => { throw new Error('Merchant mutation forbidden in fixture'); } };
      if (name.startsWith('@/')) return load(path.join(v1, 'src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      return localRequire(name);
    };
    const context = vm.createContext({ module: mod, exports: mod.exports, require: requireFixture, Buffer, Request, Response, Headers, URL, URLSearchParams, Date, crypto, TextEncoder, TextDecoder,
      console: { error() {}, warn() {}, log() {} }, process: { env: { TAKATAK_FOODHUB_API_KEY: SYNTHETIC_MASTER_KEY } } });
    new vm.Script(code, { filename }).runInContext(context);
    return mod.exports;
  }
  // Food Hub's standalone CI does not check out V1. Independent client/outbox tests use a labelled wire fixture;
  // the paired-source assertion is skipped there and runs the actual handlers when the sibling checkout exists.
  const fallback = (kind: 'merchant' | 'event') => async (r: Request): Promise<Response> => {
    if (r.headers.get('authorization') !== `Bearer ${SYNTHETIC_MASTER_KEY}`) return Response.json({ ok: false }, { status: 401 });
    if (!available) return Response.json({ ok: false }, { status: 503 });
    const raw = await r.text();const body = JSON.parse(raw);
    if (body.source_application !== 'foodhub') return Response.json({ ok: false }, { status: 400 });
    if (kind === 'merchant') return Response.json(known && body.local_vendor_id === 'synthetic-vendor' ? { ok: true, known: true, master_merchant_id: sourceMerchant.merchantId,
      store_name: sourceMerchant.storeName, marketplace_status: sourceMerchant.marketplaceStatus, subscription_status: sourceMerchant.subscriptionStatus,
      subscription_plan: sourceMerchant.subscriptionPlan, synchronized_at: sourceMerchant.lastSynchronizedAt.toISOString() } : { ok: true, known: false });
    if (r.headers.get('idempotency-key') !== body.event_id) return Response.json({ ok: false }, { status: 400 });
    const previous = events.get(body.event_id);
    if (previous && previous.raw !== raw) return Response.json({ ok: false }, { status: 409 });
    if (!previous) events.set(body.event_id, { raw, id: crypto.randomUUID() });
    return Response.json({ ok: true, id: events.get(body.event_id)!.id, duplicate: !!previous, aggregate_type: body.aggregate_type, aggregate_id: body.aggregate_id });
  };
  const entitlement = masterApiSourceAvailable ? load(path.join(v1, 'src/app/api/v1/merchants/entitlements/route.ts')).POST as (r: Request) => Promise<Response> : fallback('merchant');
  const event = masterApiSourceAvailable ? load(path.join(v1, 'src/app/api/v1/events/route.ts')).POST as (r: Request) => Promise<Response> : fallback('event');
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));const headers = new Headers(init?.headers);const body = String(init?.body ?? '');
    calls.push({ path: url.pathname, body, authorization: headers.get('authorization'), idempotency: headers.get('idempotency-key') });
    const request = new Request(url, { ...init, headers, body });
    if (url.pathname === '/api/v1/merchants/entitlements') return entitlement(request);
    if (url.pathname === '/api/v1/events') return event(request);
    return new Response('', { status: 404 });
  };
  return { fetcher: fetcher as typeof fetch, events, calls, sourceMerchant, source: masterApiSourceAvailable ? 'actual-v1' : 'wire-fixture', setKnown(value: boolean) { known = value; }, setAvailable(value: boolean) { available = value; } };
}
