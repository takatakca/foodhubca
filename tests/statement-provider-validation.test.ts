// Import the real route with an owner session: a workspace must never reclassify another provider's money.
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/foodhub/recon/imports/route';
import { sessionCookieFor } from '../lib/foodhub/auth';
import { COL } from '../lib/foodhub/recon/engine';
import { getRepo } from '../lib/foodhub/repo';
import { headerSignature, type ColumnMapping } from '../lib/foodhub/recon/statements';
import type { ChannelKey } from '../lib/foodhub/types';

const uber = [
  'Order ID,Workflow ID,Order Status,Order Date,Payout Date,Sales (excluding tax),Tax on Sales,Marketplace fee,Tax on Marketplace fee,Total payout',
  'A1,wf-1,Completed,2026-10-01,2026-10-08,20,2.99,-5,-0.75,17.24',
].join('\n');
const doorDash = [
  'Timestamp local date,Transaction type,DoorDash order ID,Merchant Store ID,Subtotal,Subtotal tax passed to merchant,Commission,Net total,Payout date',
  '2026-10-01,DELIVERY,dd-1,store-1,20,2.99,-5,17.24,2026-10-08',
].join('\n');
const generic = (id: string) => `Order Number,Order Date,Net Payout,Type\n${id},2026-10-01,17.24,Order`;
const columns: ColumnMapping = { orderRef: 0, orderDate: 1, net: 2, kind: 3 };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.SESSION_SECRET = 'statement-provider-validation-secret-0123456789';
  process.env.DASHBOARD_PASSWORD = 'statement-provider-validation-owner';
  (globalThis as typeof globalThis & { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

async function upload(csv: string, channel?: ChannelKey, mapping?: ColumnMapping) {
  const cookie = (await sessionCookieFor(null, 'password')).split(';')[0];
  return POST(new Request('https://hub.test/api/foodhub/recon/imports', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: 'statement.csv', contentBase64: Buffer.from(csv).toString('base64'), channel, mapping }),
  }), {});
}

async function moneyRecords() {
  const entries = await Promise.all(Object.values(COL).map(async (collection) => [collection, (await getRepo().listDocs(collection, {})).sort((a, b) => a.id.localeCompare(b.id))] as const));
  // Clone: memory documents could otherwise change both sides of a before/after assertion through a shared reference.
  return JSON.parse(JSON.stringify(Object.fromEntries(entries)));
}

describe('statement provider validation at import route', () => {
  it.each([
    { csv: uber, selected: 'doordash' as const, detected: 'Uber Eats' },
    { csv: uber, selected: 'skip' as const, detected: 'Uber Eats' },
    { csv: doorDash, selected: 'uber_eats' as const, detected: 'DoorDash' },
    { csv: doorDash, selected: 'skip' as const, detected: 'DoorDash' },
  ])('rejects $detected statements under $selected without creating finance records', async ({ csv, selected, detected }) => {
    const before = await moneyRecords();
    for (const mapping of [undefined, columns]) {
      const response = await upload(csv, selected, mapping);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining(`from ${detected}`) });
      expect(await moneyRecords()).toEqual(before);
    }
  });

  it('keeps automatic detection and matching explicit platform imports working', async () => {
    const automatic = await upload(uber);
    expect(automatic.status).toBe(200);
    expect(await automatic.json()).toMatchObject({ imported: true, import: { channel: 'uber_eats', newLines: 1 } });
    const explicit = await upload(doorDash, 'doordash');
    expect(explicit.status).toBe(200);
    expect(await explicit.json()).toMatchObject({ imported: true, import: { channel: 'doordash', newLines: 1 } });
    const lines = await getRepo().listDocs<{ channel: ChannelKey }>(COL.lines, {});
    expect(lines.map((l) => l.data.channel).sort()).toEqual(['doordash', 'uber_eats']);
  });

  it('requires confirmation for a new generic provider, then saves and reuses separate mappings for identical headers', async () => {
    const initial = await upload(generic('uber-first'), 'uber_eats', columns);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ imported: true, import: { channel: 'uber_eats', newLines: 1 } });
    const sig = headerSignature(generic('x').split('\n')[0].split(','));
    const original = JSON.parse(JSON.stringify(await getRepo().getDoc(COL.mappings, `${sig}:uber_eats`)));
    const before = await moneyRecords();
    for (const mapping of [undefined, {}]) {
      const unconfirmed = await upload(generic('dd-first'), 'doordash', mapping);
      expect(unconfirmed.status).toBe(200);
      expect(await unconfirmed.json()).toMatchObject({ imported: false, needsMapping: true, channel: 'doordash' });
      expect(await moneyRecords()).toEqual(before); // another provider's mapping never silently approves an import
    }

    const ddColumns = { orderRef: 0, orderDate: 1, net: 2 };
    const confirmed = await upload(generic('dd-first'), 'doordash', ddColumns);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ imported: true, import: { channel: 'doordash', newLines: 1 } });
    expect(await getRepo().getDoc(COL.mappings, `${sig}:uber_eats`)).toEqual(original);
    expect((await getRepo().getDoc(COL.mappings, `${sig}:doordash`))?.data).toEqual({ channel: 'doordash', mapping: ddColumns });
    expect(await getRepo().getDoc(COL.mappings, sig)).toBeNull();

    for (const channel of ['uber_eats', 'doordash'] as const) {
      const repeat = await upload(generic(`${channel}-repeat`), channel);
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toMatchObject({ imported: true, import: { channel, newLines: 1 } });
    }
    const lines = await getRepo().listDocs<{ channel: ChannelKey }>(COL.lines, {});
    expect(lines.map((l) => l.data.channel).sort()).toEqual(['doordash', 'doordash', 'uber_eats', 'uber_eats']);
    const current = await moneyRecords();
    const unspecified = await upload(generic('unconfirmed-provider'));
    expect(await unspecified.json()).toMatchObject({ imported: false, needsMapping: true, channel: null });
    expect(await moneyRecords()).toEqual(current);
  });

  it('remembers a single confirmed provider without a selection and deduplicates repeats, preferring scoped columns', async () => {
    const initial = await upload(generic('skip-repeat'), 'skip', columns);
    expect(await initial.json()).toMatchObject({ imported: true, import: { channel: 'skip', newLines: 1, totalNet: 17.24 } });
    const sig = headerSignature(generic('x').split('\n')[0].split(','));
    const legacy = { id: sig, at: '2026-09-01T12:00:00.000Z', data: { channel: 'skip', mapping: { ...columns, net: 3 } } };
    await getRepo().putDocs(COL.mappings, [legacy]);
    const repeat = await upload(generic('skip-repeat'));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ imported: true, import: { channel: 'skip', newLines: 0, totalNet: 17.24 } });
    expect(await getRepo().listDocs(COL.lines, {})).toHaveLength(1);
    expect(await getRepo().getDoc(COL.mappings, sig)).toEqual(legacy);
    expect((await getRepo().getDoc(COL.mappings, `${sig}:skip`))?.data).toEqual({ channel: 'skip', mapping: columns });
  });

  it('reads a compatible legacy mapping and requires confirmation for another provider without overwriting the legacy record', async () => {
    const sig = headerSignature(generic('x').split('\n')[0].split(','));
    const legacy = { id: sig, at: '2026-09-01T12:00:00.000Z', data: { channel: 'uber_eats', mapping: columns } };
    await getRepo().putDocs(COL.mappings, [legacy]);
    const remembered = await upload(generic('legacy-remembered'));
    expect(await remembered.json()).toMatchObject({ imported: true, import: { channel: 'uber_eats', newLines: 1 } });
    const repeat = await upload(generic('legacy-remembered'));
    expect(await repeat.json()).toMatchObject({ imported: true, import: { channel: 'uber_eats', newLines: 0 } });
    expect(await getRepo().getDoc(COL.mappings, sig)).toEqual(legacy);
    const before = await moneyRecords();
    const unconfirmed = await upload(generic('unconfirmed'), 'doordash');
    expect(unconfirmed.status).toBe(200);
    expect(await unconfirmed.json()).toMatchObject({ imported: false, needsMapping: true, channel: 'doordash' });
    expect(await moneyRecords()).toEqual(before);
    const confirmed = await upload(generic('dd-confirmed'), 'doordash', columns);
    expect(await confirmed.json()).toMatchObject({ imported: true, import: { channel: 'doordash', newLines: 1 } });
    expect(await getRepo().getDoc(COL.mappings, sig)).toEqual(legacy);
    const compatible = await upload(generic('uber-compatible'), 'uber_eats');
    expect(await compatible.json()).toMatchObject({ imported: true, import: { channel: 'uber_eats', newLines: 1 } });
    expect(await getRepo().getDoc(COL.mappings, sig)).toEqual(legacy);
    expect((await getRepo().getDoc(COL.mappings, `${sig}:uber_eats`))?.data).toEqual(legacy.data);
    expect((await getRepo().getDoc(COL.mappings, `${sig}:doordash`))?.data).toEqual({ channel: 'doordash', mapping: columns });
    const ambiguousBefore = await moneyRecords();
    const ambiguous = await upload(generic('provider-required'));
    expect(await ambiguous.json()).toMatchObject({ imported: false, needsMapping: true, channel: null });
    expect(await moneyRecords()).toEqual(ambiguousBefore);
  });
});
