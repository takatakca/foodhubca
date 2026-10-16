// Reviews hub model (lib/foodhub/reviews/model.ts + themes.ts): ids, dedupe, reply never overwritten, no personal data.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReview, isPersonalHeader, makeReview, maskPersonalText, parseStars, reviewId, saveReply, stripPersonal, toReviewAt, upsertReviews,
  type ReviewInput,
} from '../lib/foodhub/reviews/model';
import { detectLang, detectThemes } from '../lib/foodhub/reviews/themes';

const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  platform: 'uber_eats', storeRef: 'store-1', orderRef: 'o-1', at: '2026-10-01T12:00:00.000Z', stars: 4, text: 'Très bon poulet', source: 'import', importId: 'imp-1', ...over,
});

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

describe('review ids', () => {
  it('uses the platform review id when there is one, else platform|store|order|at|stars', () => {
    expect(reviewId({ platform: 'google', platformReviewId: 'abc', at: 'x', stars: 1 })).toBe(reviewId({ platform: 'google', platformReviewId: 'abc', at: 'y', stars: 5 }));
    expect(reviewId({ platform: 'google', platformReviewId: 'abc', at: 'x', stars: 1 })).not.toBe(reviewId({ platform: 'skip', platformReviewId: 'abc', at: 'x', stars: 1 }));
    const a = makeReview(base());
    expect(a.id).toBe(makeReview(base({ text: 'other text' })).id);
    expect(a.id).not.toBe(makeReview(base({ stars: 3 })).id);
    expect(a.id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('parses stars and dates the portals write', () => {
    expect([parseStars('5'), parseStars('4.0'), parseStars('3/5'), parseStars('★★☆☆☆'), parseStars('FOUR'), parseStars('5 étoiles'), parseStars(2)]).toEqual([5, 4, 3, 2, 4, 5, 2]);
    expect([parseStars(''), parseStars('0'), parseStars('7'), parseStars('thumbs up'), parseStars(null)]).toEqual([null, null, null, null, null]);
    expect(toReviewAt('2026-10-01')).toBe('2026-10-01T12:00:00.000Z');
    expect(toReviewAt('2026-10-01 18:22:11')).toBe('2026-10-01T18:22:11.000Z');
    expect(toReviewAt('2026-10-01T18:22:11-04:00')).toBe('2026-10-01T22:22:11.000Z');
    expect(toReviewAt('')).toBeNull();
  });
});

describe('dedupe and replies', () => {
  it('saves a review once and counts the copies as duplicates', async () => {
    const r = makeReview(base());
    expect(await upsertReviews([r, r])).toEqual({ added: 1, duplicates: 1, updated: 0 });
    expect(await upsertReviews([r])).toEqual({ added: 0, duplicates: 1, updated: 0 });
  });

  it('never overwrites the reply state of a stored review', async () => {
    const r = makeReview(base({ brandName: null }));
    await upsertReviews([r]);
    await saveReply(r.id, { draft: 'Merci!', draftAt: '2026-10-02T00:00:00Z', draftBy: 'Sara', repliedAt: '2026-10-02T01:00:00Z', repliedBy: 'Sara' });
    // Same review imported again, without a reply but with a brand now known.
    const again = makeReview(base({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA', reply: { repliedAt: '2030-01-01T00:00:00Z', repliedBy: 'file' } }));
    expect(again.id).toBe(r.id);
    expect(await upsertReviews([again])).toEqual({ added: 0, duplicates: 1, updated: 1 });
    const stored = await getReview(r.id);
    expect(stored?.reply).toEqual({ draft: 'Merci!', draftAt: '2026-10-02T00:00:00Z', draftBy: 'Sara', repliedAt: '2026-10-02T01:00:00Z', repliedBy: 'Sara' });
    expect(stored?.brandName).toBe('Pi Pita');
    expect(stored?.locationCode).toBe('HOCHELAGA');
  });
});

describe('privacy', () => {
  it('knows which columns are personal', () => {
    for (const h of ['Customer Name', 'Consumer name', 'Nom du client', 'Prénom', 'Email', 'Courriel', 'Phone', 'Téléphone', 'Dasher Name', 'Courier', 'Livreur', 'Reviewer', 'Reviewer Name', 'Customer address']) expect(isPersonalHeader(h)).toBe(true);
    for (const h of ['Store Name', 'Restaurant name', 'Rating', 'Comment', 'Customer comment', 'Consumer rating', 'Order ID', 'Date', 'Business Name', 'Location']) expect(isPersonalHeader(h)).toBe(false);
  });

  it('drops personal fields and masks e-mails and phones in what is left', () => {
    const out = stripPersonal({ 'Customer Name': 'Jean Tremblay', Email: 'jean@example.com', Phone: '514-555-0199', 'Dasher Name': 'Marc', Comment: 'Appelez-moi au (514) 555-0199 ou jean@example.com', Rating: 2, nested: { 'Driver name': 'Luc', note: 'ok' } });
    expect(out).toEqual({ Comment: 'Appelez-moi au [téléphone] ou [courriel]', Rating: 2, nested: { note: 'ok' } });
    expect(JSON.stringify(out)).not.toMatch(/Jean|Marc|Luc|555|example/);
  });

  it('masks personal data inside the review text at ingestion', () => {
    const r = makeReview(base({ text: 'Livreur gentil. Mon numéro: +1 438 555 0123, écrivez à client.test@mail.ca' }));
    expect(r.text).toBe('Livreur gentil. Mon numéro: [téléphone], écrivez à [courriel]');
    expect(maskPersonalText('Commande 12345678 ok')).toBe('Commande 12345678 ok'); // an order number is not a phone
  });
});

describe('themes and language', () => {
  it('finds French and English themes, accents and case ignored', () => {
    expect(detectThemes('Repas TIÈDE, livré en retard et il manquait les frites')).toEqual(['cold', 'late', 'missing']);
    expect(detectThemes('Wrong order, spilled sauce, but tasty and the staff was friendly')).toEqual(['wrong', 'taste', 'packaging', 'friendly']);
    expect(detectThemes('Rapide et pas cher, portion généreuse')).toEqual(['portion', 'price', 'fast']);
    expect(detectThemes('')).toEqual([]);
    expect(detectThemes('froideur')).toEqual([]); // whole words only
  });

  it('detects the language (Québec French wins a tie)', () => {
    expect(detectLang('Le poulet était très bon, merci!')).toBe('fr');
    expect(detectLang('The chicken was very good, thanks')).toBe('en');
    expect(detectLang('Super')).toBeNull();
    expect(detectLang('')).toBeNull();
  });
});
