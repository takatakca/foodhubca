// Reviews hub ← DoorDash CONSUMER_FEEDBACK report (lib/foodhub/reviews/doordash-feedback.ts). The Reporting API code
// (doordash/reports.ts) is mocked where it would call DoorDash: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { getRepo } from '../lib/foodhub/repo';
import * as reports from '../lib/foodhub/doordash/reports';
import {
  feedbackColumns, ingestDoorDashFeedbackReport, listDoorDashFeedbackReports, parseConsumerFeedback, reportMessageFr, requestDoorDashFeedback,
} from '../lib/foodhub/reviews/doordash-feedback';
import { listReviews } from '../lib/foodhub/reviews/model';

vi.mock('../lib/foodhub/doordash/reports', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/doordash/reports')>();
  return {
    ...real,
    requestDoorDashReport: vi.fn(async (input: { reportType: string; from: string; to: string }) => ({ id: 'rep-1', reportType: input.reportType, from: input.from, to: input.to, storeIds: [], status: 'requested', message: 'Requested', requestedBy: 'Owner', at: '2026-10-16T00:00:00Z' })),
    refreshDoorDashReport: vi.fn(async () => null),
  };
});

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const [PROTECTED] = [...FORBIDDEN_STORE_IDS];

const CSV = [
  'DoorDash Consumer Feedback',
  'Store ID,Store Name,Delivery UUID,Consumer Name,Dasher Name,Rating,Comment,Created At,Some New Column',
  '11111111,Pi Pita (Hochelaga),dlv-1,Jean Tremblay,Marc,2,"Arrivé froid, appelez 514-555-0199",2026-10-10 18:00:00,x',
  `${PROTECTED},Po Poulet,dlv-2,Anne,Luc,1,Jamais reçu,2026-10-11 18:00:00,y`,
  '22222222,Unknown store,dlv-3,Paul,Eve,5,Excellent!,2026-10-12,z',
  'mx-locked,Somewhere,dlv-4,Zoe,Max,4,Bon,2026-10-12,z',
  '11111111,Pi Pita,dlv-5,,,,,2026-10-12,',
].join('\n');

async function seedFile(id: string, csv = CSV, reportType = 'CONSUMER_FEEDBACK') {
  await getRepo().putDocs(reports.REPORT_REQUESTS, [{ id, at: '2026-10-16T00:00:00Z', data: { id, reportType, from: '2026-10-01', to: '2026-10-15', storeIds: [], status: 'ready', message: '', requestedBy: 'Owner', at: '2026-10-16T00:00:00Z' } }]);
  await getRepo().putDocs(reports.REPORT_FILES, [{ id, at: '2026-10-16T00:00:00Z', data: { id, fileName: 'feedback.csv', csv, truncated: false } }]);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no live calls in tests'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(reports.requestDoorDashReport).mockClear(); vi.mocked(reports.refreshDoorDashReport).mockClear(); });

describe('parseConsumerFeedback', () => {
  it('reads the useful columns whatever their order, never the personal ones', () => {
    const rows = parseConsumerFeedback(CSV);
    expect(rows).toHaveLength(4); // the row without rating nor comment is dropped
    expect(rows[0]).toEqual({ reviewId: null, storeRef: '11111111', storeName: 'Pi Pita (Hochelaga)', orderRef: 'dlv-1', stars: '2', text: 'Arrivé froid, appelez 514-555-0199', at: '2026-10-10T18:00:00.000Z' });
    expect(JSON.stringify(rows)).not.toMatch(/Jean|Marc|Anne|Luc|Paul|Eve/);
    expect(feedbackColumns(['order_id', 'rating', 'dasher_rating', 'feedback', 'feedback_date', 'store_id'])).toEqual({ storeRef: 5, orderRef: 0, stars: 1, at: 4, text: 3 });
    expect(parseConsumerFeedback('')).toEqual([]);
  });
});

describe('ingestDoorDashFeedbackReport', () => {
  it('drops protected stores, maps store numbers to brand and kitchen, keeps no personal data', async () => {
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-pita', brandName: 'Pi Pita', locationCode: 'HOCHELAGA', autoAccept: true, online: true, meta: { platformStoreId: '11111111' } });
    // A store mapped under another id but carrying the protected DoorDash number is caught too.
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'mx-locked', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: { platformStoreId: PROTECTED } });
    await seedFile('rep-1');
    const out = await ingestDoorDashFeedbackReport('rep-1', actor);
    expect(out).toMatchObject({ ok: true, rows: 4, added: 2, dropped: 2, unmapped: 1 });
    const saved = await listReviews();
    expect(saved).toHaveLength(2);
    const pita = saved.find((r) => r.orderRef === 'dlv-1')!;
    expect(pita).toMatchObject({ platform: 'doordash', brandName: 'Pi Pita', locationCode: 'HOCHELAGA', stars: 2, source: 'doordash_report', importId: 'doordash:rep-1', themes: ['cold'], lang: 'fr' });
    expect(pita.text).toBe('Arrivé froid, appelez [téléphone]');
    expect(saved.some((r) => r.storeRef === PROTECTED || r.orderRef === 'dlv-2' || r.orderRef === 'dlv-4')).toBe(false);
    expect(JSON.stringify(saved)).not.toMatch(/Jean|Marc|Paul|Eve|555/);
    // Run again: nothing new, nothing doubled.
    expect(await ingestDoorDashFeedbackReport('rep-1', actor)).toMatchObject({ ok: true, added: 0, duplicates: 2 });
    expect(reports.refreshDoorDashReport).not.toHaveBeenCalled();
  });

  it('asks the existing refresh when the file is not downloaded yet, and refuses other report types', async () => {
    await getRepo().putDocs(reports.REPORT_REQUESTS, [{ id: 'rep-2', at: '2026-10-16T00:00:00Z', data: { id: 'rep-2', reportType: 'CONSUMER_FEEDBACK', from: '2026-10-01', to: '2026-10-15', storeIds: [], status: 'requested', message: '', requestedBy: 'Owner', at: '2026-10-16T00:00:00Z' } }]);
    const pending = await ingestDoorDashFeedbackReport('rep-2', actor);
    expect(pending.ok).toBe(false);
    expect(reports.refreshDoorDashReport).toHaveBeenCalledWith('rep-2', actor);
    await seedFile('rep-3', CSV, 'PAYOUT_SUMMARY');
    expect((await ingestDoorDashFeedbackReport('rep-3', actor)).message).toMatch(/not customer feedback/);
    expect((await ingestDoorDashFeedbackReport('nope', actor)).ok).toBe(false);
    expect(await listReviews()).toHaveLength(0);
  });
});

describe('requesting the report', () => {
  it('delegates to requestDoorDashReport with the CONSUMER_FEEDBACK type (its guards apply there)', async () => {
    const out = await requestDoorDashFeedback('2026-10-01', '2026-10-15', actor);
    expect(reports.requestDoorDashReport).toHaveBeenCalledWith({ reportType: 'CONSUMER_FEEDBACK', from: '2026-10-01', to: '2026-10-15' }, actor);
    expect(out).toMatchObject({ id: 'rep-1', reportType: 'CONSUMER_FEEDBACK' });
  });

  it('lists only the feedback report requests', async () => {
    await seedFile('rep-a');
    await seedFile('rep-b', CSV, 'ORDER_DETAIL');
    expect((await listDoorDashFeedbackReports()).map((r) => r.id)).toEqual(['rep-a']);
  });
});

describe('review fixes: overall rating, protected store by any column or by name, French messages', () => {
  it('takes the overall rating, never a food / packaging / item sub-rating', () => {
    expect(feedbackColumns(['STORE_ID', 'DELIVERY_UUID', 'FOOD_RATING', 'PACKAGING_RATING', 'OVERALL_RATING', 'COMMENT', 'CREATED_AT'])).toMatchObject({ storeRef: 0, orderRef: 1, stars: 4, text: 5, at: 6 });
    expect(feedbackColumns(['item_name', 'item_rating', 'rating', 'comment', 'date']).stars).toBe(2);
    expect(feedbackColumns(['store_id', 'customer_id', 'consumer_id', 'rating', 'comment']).storeRef).toBe(0);
    const [row] = parseConsumerFeedback('store_id,item_name,item_rating,rating,comment,date\n11111111,Pita,1,5,Super,2026-10-10');
    expect(row.stars).toBe('5');
  });

  it('drops a row whose protected number sits in another column, and a not-mapped Po Poulet NDG by name', async () => {
    await seedFile('rep-x', [
      'Merchant Ref,Store Name,Delivery UUID,Rating,Comment,Created At',
      `${PROTECTED},Somewhere,dlv-1,1,Froid,2026-10-10`,
      '55555555,Po Poulet NDG,dlv-2,2,Tiède,2026-10-10',
      '66666666,Pi Pita Hochelaga,dlv-3,5,Parfait,2026-10-10',
    ].join('\n'));
    const out = await ingestDoorDashFeedbackReport('rep-x', actor);
    expect(out).toMatchObject({ ok: true, rows: 3, added: 1, dropped: 2 });
    expect(out.messageFr).toMatch(/^1 nouvel\(s\) avis, 0 déjà là, 2 d’un magasin protégé/);
    expect((await listReviews()).map((r) => r.brandName)).toEqual(['Pi Pita']);
  });

  it('French text for the report messages written by the Reporting API code', () => {
    expect(reportMessageFr('DoorDash is still preparing the file.')).toBe('DoorDash prépare encore le fichier.');
    expect(reportMessageFr('12 row(s), 3 row(s) of a protected store left out.')).toBe('12 ligne(s), 3 ligne(s) d’un magasin protégé laissée(s) de côté.');
    expect(reportMessageFr('Something new')).toBe('Something new');
  });
});

describe('review fixes 2: long request lists, truncated files, French refusals', () => {
  it('lists feedback requests even behind hundreds of newer payout / transaction requests', async () => {
    await seedFile('rep-old');
    const others = Array.from({ length: 250 }, (_, i) => {
      const at = new Date(Date.parse('2026-10-16T01:00:00Z') + i * 60_000).toISOString();
      return { id: `pay-${i}`, at, data: { id: `pay-${i}`, reportType: 'FINANCIAL_DETAILED_TRANSACTION', from: '2026-10-01', to: '2026-10-15', storeIds: [], status: 'ready', message: '', requestedBy: 'Owner', at } };
    });
    await getRepo().putDocs(reports.REPORT_REQUESTS, others);
    expect((await listDoorDashFeedbackReports()).map((r) => r.id)).toEqual(['rep-old']);
  });

  it('a truncated file: the cut last row is dropped and the message says so', async () => {
    await seedFile('rep-cut', [
      'Store ID,Store Name,Delivery UUID,Rating,Comment,Created At',
      '11111111,Pi Pita,dlv-1,5,Parfait,2026-10-10',
      '11111111,Pi Pita,dlv-2,4,Très b',
    ].join('\n'));
    const doc = await getRepo().getDoc<{ id: string; fileName: string; csv: string; truncated: boolean }>(reports.REPORT_FILES, 'rep-cut');
    await getRepo().putDocs(reports.REPORT_FILES, [{ id: 'rep-cut', at: '2026-10-16T00:00:00Z', data: { ...doc!.data, truncated: true } }]);
    const out = await ingestDoorDashFeedbackReport('rep-cut', actor);
    expect(out).toMatchObject({ ok: true, rows: 1, added: 1 });
    expect(out.message).toMatch(/File truncated: ask for a shorter period\.$/);
    expect(out.messageFr).toMatch(/Fichier tronqué : demandez une période plus courte\.$/);
  });

  it('French text for the request refusals (credentials, sandbox, dates, stores)', () => {
    expect(reportMessageFr('DoorDash Reporting API credentials missing: DOORDASH_REPORTS_DEVELOPER_ID, DOORDASH_REPORTS_KEY_ID (Developer Portal → your Reports integration → access key).'))
      .toBe('Identifiants de l’API de rapports DoorDash manquants : DOORDASH_REPORTS_DEVELOPER_ID, DOORDASH_REPORTS_KEY_ID (Developer Portal → intégration Reports → clé d’accès).');
    expect(reportMessageFr('Not sent: DoorDash is in sandbox mode (DOORDASH_ENV=sandbox) and the Marketplace key is a sandbox one.')).toMatch(/^Non envoyé : DoorDash est en mode test/);
    expect(reportMessageFr('Choose a valid date range (YYYY-MM-DD).')).toBe('Choisissez une période valide (AAAA-MM-JJ, la fin après le début).');
    expect(reportMessageFr('No mapped DoorDash store carries a DoorDash store number: give the store ids or business ids explicitly.')).toMatch(/^Aucun magasin DoorDash branché/);
  });
});
