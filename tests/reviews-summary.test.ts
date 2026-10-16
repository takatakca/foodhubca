// Reviews hub numbers (lib/foodhub/reviews/summary.ts): averages, distribution, 7/30/90-day trends, unanswered,
// DoorDash days left to reply, worst recent, groups per brand × platform × kitchen.
import { describe, expect, it } from 'vitest';
import { makeReview, type Review, type ReviewInput } from '../lib/foodhub/reviews/model';
import { daysLeftToReply, statsOf, summarizeReviews, worstRecent } from '../lib/foodhub/reviews/summary';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let n = 0;
const rv = (over: Partial<ReviewInput> & { daysAgo: number }): Review => makeReview({
  platform: 'doordash', brandName: 'Pi Pita', locationCode: 'HOCHELAGA', storeRef: 's', orderRef: `o-${n++}`, stars: 5, text: 'Très bon', source: 'import', importId: 'i', ...over, at: daysAgo(over.daysAgo),
});

describe('statsOf', () => {
  it('averages, distribution, unanswered (comments only) and themes', () => {
    const list = [rv({ daysAgo: 1, stars: 5 }), rv({ daysAgo: 2, stars: 4 }), rv({ daysAgo: 3, stars: 1, text: 'Froid et en retard' }), rv({ daysAgo: 3, stars: null, text: 'Froid' }), rv({ daysAgo: 4, stars: 3, text: '' })];
    list[0].reply = { repliedAt: daysAgo(0), repliedBy: 'Sara' };
    const s = statsOf(list, NOW);
    expect(s.count).toBe(5);
    expect(s.rated).toBe(4);
    expect(s.avg).toBe(3.25);
    expect(s.distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 1 });
    expect(s.unanswered).toBe(3); // the replied one and the star-only rating do not count
    expect(s.themes).toEqual([{ key: 'cold', count: 2 }, { key: 'taste', count: 2 }, { key: 'late', count: 1 }]);
    expect(statsOf([], NOW)).toMatchObject({ count: 0, avg: null, unanswered: 0 });
  });

  it('7 / 30 / 90-day trends against the period before', () => {
    const list = [
      rv({ daysAgo: 1, stars: 5 }), rv({ daysAgo: 5, stars: 3 }), // last 7 days: 4.0
      rv({ daysAgo: 10, stars: 2 }), // previous 7 days: 2.0
      rv({ daysAgo: 40, stars: 1 }), // previous 30 days
      rv({ daysAgo: 120, stars: 4 }), // previous 90 days
      rv({ daysAgo: 400, stars: 1 }), // outside every window
    ];
    const [d7, d30, d90] = statsOf(list, NOW).trend;
    expect(d7).toEqual({ days: 7, count: 2, avg: 4, prevCount: 1, prevAvg: 2, delta: 2 });
    expect(d30).toEqual({ days: 30, count: 3, avg: 3.33, prevCount: 1, prevAvg: 1, delta: 2.33 });
    expect(d90).toEqual({ days: 90, count: 4, avg: 2.75, prevCount: 1, prevAvg: 4, delta: -1.25 });
  });
});

describe('daysLeftToReply (DoorDash portal, 7 days)', () => {
  it('counts down from 7 for unanswered DoorDash reviews with a comment', () => {
    expect(daysLeftToReply(rv({ daysAgo: 0 }), NOW)).toBe(7);
    expect(daysLeftToReply(rv({ daysAgo: 2.5 }), NOW)).toBe(5);
    expect(daysLeftToReply(rv({ daysAgo: 10 }), NOW)).toBe(0);
    expect(daysLeftToReply(rv({ daysAgo: 1, platform: 'uber_eats' }), NOW)).toBeNull();
    expect(daysLeftToReply(rv({ daysAgo: 1, text: '' }), NOW)).toBeNull();
    const done = rv({ daysAgo: 1 });
    done.reply = { repliedAt: daysAgo(0) };
    expect(daysLeftToReply(done, NOW)).toBeNull();
  });
});

describe('groups and worst reviews', () => {
  it('one group per brand × platform × kitchen, most reviews first, with the worst recent ones', () => {
    const list = [
      ...[1, 2, 3, 4, 5, 6].map((s, i) => rv({ daysAgo: i + 1, stars: (s % 5) + 1 })),
      rv({ daysAgo: 1, platform: 'uber_eats', stars: 2 }),
      rv({ daysAgo: 1, brandName: 'OOeuf', locationCode: 'NDG_MAIN', stars: 4 }),
    ];
    const { overall, groups } = summarizeReviews(list, NOW);
    expect(overall.count).toBe(8);
    expect(groups.map((g) => [g.brandName, g.platform, g.locationCode, g.count])).toEqual([
      ['Pi Pita', 'doordash', 'HOCHELAGA', 6], ['OOeuf', 'doordash', 'NDG_MAIN', 1], ['Pi Pita', 'uber_eats', 'HOCHELAGA', 1],
    ]);
    const worst = groups[0].worst;
    expect(worst.map((r) => r.stars)).toEqual([1, 2, 2, 3]); // ≤ 3 stars only, lowest first
    expect(worstRecent([rv({ daysAgo: 60, stars: 2 })], NOW)).toHaveLength(1); // nothing recent: older ones
    expect(worstRecent([rv({ daysAgo: 1, stars: 5 })], NOW)).toHaveLength(0);
  });
});
