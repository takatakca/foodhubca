// Reviews hub model (lib/foodhub/reviews/model.ts + themes.ts): ids, dedupe, reply never overwritten, no personal data.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReview, isPersonalHeader, makeReview, maskPersonalText, parseStars, reviewId, saveReply, separateTwins, stripPersonal, toReviewAt, upsertReviews,
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
  it('uses the platform review id when there is one, else platform|store|order|at|stars (+ text without an order id)', () => {
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

describe('review fixes: same-day ids, snake_case personal columns', () => {
  it('two same-day, same-star reviews without review or order id are two reviews, not a duplicate', async () => {
    const day = { platform: 'tgtg' as const, storeRef: 'Pi Pita', orderRef: null, at: '2026-10-01T12:00:00.000Z', stars: 4 };
    const a = makeReview(base({ ...day, text: 'Panier généreux' }));
    const b = makeReview(base({ ...day, text: 'Bon pain, un peu sec' }));
    expect(a.id).not.toBe(b.id);
    expect(await upsertReviews([a, b])).toEqual({ added: 2, duplicates: 0, updated: 0 });
    // The same text again is still the same review (re-import), case and accents ignored.
    expect(makeReview(base({ ...day, text: 'PANIER  genereux' })).id).toBe(a.id);
    // With an order id, an edited text stays the same review.
    expect(makeReview(base({ text: 'A' })).id).toBe(makeReview(base({ text: 'B' })).id);
  });

  it('separateTwins: identical star-only rows of one file are kept apart, stable across re-imports', () => {
    const star = () => makeReview(base({ platform: 'tgtg', orderRef: null, text: '', stars: 5 }));
    const once = separateTwins([{ review: star() }, { review: star() }, { review: star() }]).map((r) => r.id);
    expect(new Set(once).size).toBe(3);
    expect(separateTwins([{ review: star() }, { review: star() }, { review: star() }]).map((r) => r.id)).toEqual(once);
    // A row with a review id or an order id is never split (a true duplicate row).
    const withOrder = makeReview(base());
    expect(separateTwins([{ review: withOrder }, { review: withOrder }]).map((r) => r.id)).toEqual([withOrder.id, withOrder.id]);
    expect(separateTwins([{ review: star(), platformReviewId: 'x' }, { review: star(), platformReviewId: 'x' }]).map((r) => r.id)).toEqual([star().id, star().id]);
  });

  it('snake_case and camelCase customer / user ids are personal; store ids are not', () => {
    for (const h of ['customer_id', 'consumer_id', 'user_id', 'consumerId', 'EATER_UUID', 'guest-id', 'client_id', 'customer_email', 'CONSUMER_NAME', 'dasher_id']) expect(isPersonalHeader(h), h).toBe(true);
    for (const h of ['store_id', 'STORE_ID', 'delivery_uuid', 'order_id', 'business_id', 'merchant_store_id', 'rating']) expect(isPersonalHeader(h), h).toBe(false);
  });
});

describe('review fixes 2: phones, replied in the portal, negation', () => {
  it('masks 7-digit local and international numbers; an 8-digit order number stays', () => {
    expect(maskPersonalText('Appelez le 555-1234 ou 555 1234 ou 555.1234')).toBe('Appelez le [téléphone] ou [téléphone] ou [téléphone]');
    expect(maskPersonalText('Mon cell +33 6 12 34 56 78, merci')).toBe('Mon cell [téléphone], merci');
    expect(maskPersonalText('London +44 20 7946 0958')).toBe('London [téléphone]');
    expect(maskPersonalText('Commande 12345678 ok, 2 poutines à 12.50, le 2026-10-01')).toBe('Commande 12345678 ok, 2 poutines à 12.50, le 2026-10-01');
    expect(maskPersonalText('5551234')).toBe('5551234'); // no separator: could be an order number, kept
  });

  it('a re-import that shows a reply given in the portal marks the stored review replied, keeping its draft', async () => {
    const r = makeReview(base());
    await upsertReviews([r]);
    await saveReply(r.id, { draft: 'Merci!', draftAt: '2026-10-02T00:00:00Z', draftBy: 'Sara', draftSource: 'template' });
    const again = makeReview(base({ reply: { repliedAt: '2026-10-03T12:00:00.000Z', repliedBy: 'Portal' } }));
    expect(await upsertReviews([again])).toEqual({ added: 0, duplicates: 1, updated: 1 });
    expect((await getReview(r.id))?.reply).toEqual({ draft: 'Merci!', draftAt: '2026-10-02T00:00:00Z', draftBy: 'Sara', draftSource: 'template', repliedAt: '2026-10-03T12:00:00.000Z', repliedBy: 'Portal' });
    // A second re-import never moves the replied mark.
    expect(await upsertReviews([makeReview(base({ reply: { repliedAt: '2030-01-01T00:00:00.000Z', repliedBy: 'file' } }))])).toEqual({ added: 0, duplicates: 1, updated: 0 });
    expect((await getReview(r.id))?.reply?.repliedAt).toBe('2026-10-03T12:00:00.000Z');
  });

  it('negated mentions do not count as a theme; topics and other clauses still do', () => {
    expect(detectThemes('Excellent, pas froid du tout et livraison rapide!')).toEqual(['taste', 'fast']);
    expect(detectThemes('Not cold at all, not late')).toEqual([]);
    expect(detectThemes('Aucun retard, rien ne manquait, sans erreur')).toEqual([]);
    expect(detectThemes("It wasn't cold and nothing was missing")).toEqual([]);
    expect(detectThemes('Pas cher, mais froid')).toEqual(['cold', 'price']);
    expect(detectThemes('Not bad but cold')).toEqual(['cold']);
    expect(detectThemes('Pas rapide du tout')).toEqual([]);
    expect(detectThemes("Je n'ai jamais reçu mes frites")).toEqual(['missing']);
    expect(detectThemes('Pas bon')).toEqual([]); // "bon" alone is not a theme word
    expect(detectThemes('Pas de goût')).toEqual(['taste']); // a topic stays a topic
  });
});
