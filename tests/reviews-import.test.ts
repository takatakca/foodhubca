// Reviews hub ← exported files (lib/foodhub/reviews/import.ts): portal presets, Google Takeout JSON, manual mapping,
// dry-run preview, brand matching, protected stores, size limit. Files are built in the test: nothing is downloaded.
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { getRepo } from '../lib/foodhub/repo';
import { detectPreset, importReviews, MAX_IMPORT_BYTES } from '../lib/foodhub/reviews/import';
import { listReviews } from '../lib/foodhub/reviews/model';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const csv = (lines: string[]) => strToU8(lines.join('\n'));

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

describe('portal presets', () => {
  it('Uber Eats Manager export: platform, brand and kitchen from the store name, eater name never kept', async () => {
    const out = await importReviews('ratings.csv', csv([
      'Order UUID,Store Name,Eater Name,Rating,Comment,Date',
      'u-1,Pi Pita Hochelaga,Jean Tremblay,5,"Super bon goût, livré vite",2026-10-01',
      'u-2,Pi Pita Hochelaga,Anne Roy,2,Wrong order,2026-10-02',
    ]), {}, actor);
    expect(out.ok && out.platform).toBe('uber_eats');
    if (!out.ok) throw new Error(out.error);
    expect(out.preset).toBe('Uber Eats Manager');
    expect(out.counts).toMatchObject({ rows: 2, new: 2, duplicate: 0, skipped: 0 });
    const saved = await listReviews();
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.orderRef === 'u-1')).toMatchObject({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA', stars: 5, themes: ['taste', 'fast'], source: 'import' });
    expect(JSON.stringify(saved)).not.toMatch(/Jean|Anne|Tremblay/);
  });

  it('Skip, Too Good To Go and Google Business Profile exports', async () => {
    expect(detectPreset(['Order Number', 'Restaurant', 'Overall Rating', 'Comment', 'Review Date'])?.platform).toBe('skip');
    expect(detectPreset(['Store', 'Rating', 'Comment', 'Pickup Date', 'Surprise Bag'])?.platform).toBe('tgtg');
    expect(detectPreset(['Review ID', 'Reviewer Name', 'Star Rating', 'Review Text', 'Create Time', 'Location', 'Reply Text'])?.platform).toBe('google');
    expect(detectPreset(['A', 'B', 'C'], 'export-skip-oct.csv')?.platform).toBe('skip');

    const skip = await importReviews('s.csv', csv(['Order Number,Restaurant,Customer Phone,Overall Rating,Comment,Review Date', '1001,OOeuf NDG,514-555-0101,4,Bon déjeuner,2026-10-03']), {}, actor);
    expect(skip.ok && skip.platform).toBe('skip');
    const google = await importReviews('g.csv', csv([
      'Review ID,Reviewer Name,Star Rating,Review Text,Create Time,Location,Reply Text',
      'g-1,Jean Tremblay,FIVE,Excellent accueil,2026-10-04T15:00:00Z,Pi Pita,Merci!',
      'g-2,Anne Roy,TWO,Trop cher,2026-10-05T15:00:00Z,Pi Pita,',
    ]), {}, actor);
    if (!google.ok) throw new Error(google.error);
    expect(google.platform).toBe('google');
    const saved = await listReviews();
    const g1 = saved.find((r) => r.platform === 'google' && r.stars === 5)!;
    expect(g1.reply?.repliedAt).toBe('2026-10-04T15:00:00.000Z'); // already answered in the portal
    expect(saved.find((r) => r.platform === 'google' && r.stars === 2)?.reply).toBeUndefined();
    expect(JSON.stringify(saved)).not.toMatch(/Jean|Anne|555-0101/);
  });

  it('reads an Excel (.xlsx) export', async () => {
    const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const sheet = `<worksheet><sheetData><row r="1">${cell('A1', 'Store')}${cell('B1', 'Rating')}${cell('C1', 'Comment')}${cell('D1', 'Date')}</row><row r="2">${cell('A2', 'Pi Pita')}${cell('B2', '3')}${cell('C2', 'Portion trop petite')}${cell('D2', '2026-10-06')}</row></sheetData></worksheet>`;
    const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) });
    const out = await importReviews('tgtg-ratings.xlsx', bytes, { platform: 'tgtg' }, actor);
    if (!out.ok) throw new Error(out.error);
    expect(out.platform).toBe('tgtg');
    expect((await listReviews())[0]).toMatchObject({ platform: 'tgtg', stars: 3, brandName: 'Pi Pita', themes: ['portion'] });
  });
});

describe('Google Takeout JSON', () => {
  it('Business Profile reviews file: stars words, reply state, reviewer never read', async () => {
    const json = { reviews: [
      { name: 'accounts/1/locations/2/reviews/abc', reviewer: { displayName: 'Jean Tremblay', profilePhotoUrl: 'https://x' }, starRating: 'FOUR', comment: 'Très bon poulet', createTime: '2026-10-01T15:00:00Z', reviewReply: { comment: 'Merci', updateTime: '2026-10-02T15:00:00Z' } },
      { name: 'accounts/1/locations/2/reviews/def', reviewer: { displayName: 'Anne' }, starRating: 'ONE', comment: 'Froid', createTime: '2026-10-03T15:00:00Z' },
    ] };
    const out = await importReviews('reviews.json', strToU8(JSON.stringify(json)), { brandName: 'Po Poulet', locationCode: 'NDG_MAIN' }, actor);
    if (!out.ok) throw new Error(out.error);
    expect(out).toMatchObject({ platform: 'google', preset: 'Google Takeout', counts: { rows: 2, new: 2 } });
    const saved = await listReviews();
    expect(saved.map((r) => r.stars).sort()).toEqual([1, 4]);
    expect(saved.find((r) => r.stars === 4)).toMatchObject({ brandName: 'Po Poulet', locationCode: 'NDG_MAIN', reply: { repliedAt: '2026-10-02T15:00:00.000Z' } });
    expect(JSON.stringify(saved)).not.toMatch(/Jean|Anne|profilePhoto/);
  });

  it('Maps GeoJSON reviews file', async () => {
    const json = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'Google Maps URL': 'https://maps.example/1', Published: '2026-10-05T10:00:00Z', 'Five-Star Rating Published': 5, 'Review Comment': 'Excellent', Location: { 'Business Name': 'OOeuf', Address: '6280 Av Somerled' } } }] };
    const out = await importReviews('Reviews.json', strToU8(JSON.stringify(json)), {}, actor);
    if (!out.ok) throw new Error(out.error);
    expect((await listReviews())[0]).toMatchObject({ platform: 'google', stars: 5, brandName: 'OOeuf' });
  });

  it('a JSON file without reviews is refused', async () => {
    expect(await importReviews('x.json', strToU8('{"foo":1}'), {}, actor)).toMatchObject({ ok: false });
    expect(await importReviews('x.json', strToU8('{nope'), {}, actor)).toMatchObject({ ok: false });
  });
});

describe('manual mapping, dry run, limits', () => {
  const unknown = ['Col A,Col B,Col C,Col D', '2026-10-07,4,Bon service,Pi Pita', '2026-10-08,1,Erreur dans la commande,Pi Pita'];

  it('asks for the columns when the file is not recognized, then imports with the mapping', async () => {
    const ask = await importReviews('weird.csv', csv(unknown), {}, actor);
    expect(ask).toMatchObject({ ok: false, needsMapping: true, headers: ['Col A', 'Col B', 'Col C', 'Col D'] });
    const out = await importReviews('weird.csv', csv(unknown), { platform: 'other', mapping: { date: 0, stars: 1, text: 2, store: 3 } }, actor);
    if (!out.ok) throw new Error(out.error);
    expect(out.counts).toMatchObject({ rows: 2, new: 2 });
    expect((await listReviews()).every((r) => r.brandName === 'Pi Pita' && r.platform === 'other')).toBe(true);
  });

  it('dry run: first 20 rows and the counts, nothing saved; duplicates counted after the real import', async () => {
    const lines = ['Store,Rating,Comment,Date', ...Array.from({ length: 25 }, (_, i) => `Pi Pita,${(i % 5) + 1},Avis ${i},2026-09-${String(i + 1).padStart(2, '0')}`), 'Pi Pita,,,2026-09-30', 'Pi Pita,4,sans date,'];
    const dry = await importReviews('uber.csv', csv(lines), { dryRun: true }, actor);
    if (!dry.ok) throw new Error(dry.error);
    expect(dry.dryRun).toBe(true);
    expect(dry.preview).toHaveLength(20);
    expect(dry.counts).toEqual({ rows: 27, new: 25, duplicate: 0, skipped: 2, dropped: 0, unmapped: 0 });
    expect(await listReviews()).toHaveLength(0);
    const real = await importReviews('uber.csv', csv(lines), {}, actor);
    expect(real.ok && real.counts.new).toBe(25);
    const again = await importReviews('uber.csv', csv(lines), { dryRun: true }, actor);
    expect(again.ok && again.counts).toMatchObject({ new: 0, duplicate: 25 });
    expect(await listReviews()).toHaveLength(25);
  });

  it('refuses files over 5 MB and empty files', async () => {
    expect(await importReviews('big.csv', new Uint8Array(MAX_IMPORT_BYTES + 1), {}, actor)).toMatchObject({ ok: false, error: expect.stringMatching(/5 MB/) });
    expect(await importReviews('empty.csv', new Uint8Array(0), {}, actor)).toMatchObject({ ok: false });
  });

  it('never keeps a protected DoorDash store, and keeps a limited person to their kitchens', async () => {
    const [PROTECTED] = [...FORBIDDEN_STORE_IDS];
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-ooeuf', brandName: 'OOeuf', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    const out = await importReviews('doordash.csv', csv(['Store ID,Rating,Comment,Date', `${PROTECTED},1,Froid,2026-10-01`, 'dd-ooeuf,5,Parfait,2026-10-01']), {}, actor);
    if (!out.ok) throw new Error(out.error);
    expect(out.counts).toMatchObject({ new: 1, dropped: 1 });
    expect((await listReviews()).map((r) => r.brandName)).toEqual(['OOeuf']);

    const scoped = await importReviews('skip.csv', csv(['Restaurant,Rating,Comment,Date', 'Pi Pita Hochelaga,4,Bon,2026-10-02', 'OOeuf NDG 6280 Av Somerled,4,Bon,2026-10-02']), { allowedLocations: ['HOCHELAGA'] }, actor);
    if (!scoped.ok) throw new Error(scoped.error);
    expect(scoped.counts).toMatchObject({ new: 1, skipped: 1 });
  });
});
