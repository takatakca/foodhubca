// Reviews hub reply drafts (lib/foodhub/reviews/drafts.ts). askClaude is mocked: no call reaches Anthropic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askClaude } from '../lib/foodhub/watch/ai';
import {
  clearReply, draftAndSave, draftBatch, draftReply, draftSystemPrompt, guardDraft, markReplied, MAX_BATCH, templateReply,
} from '../lib/foodhub/reviews/drafts';
import { getReview, makeReview, upsertReviews, REVIEW_PLATFORMS, type Review, type ReviewInput } from '../lib/foodhub/reviews/model';

vi.mock('../lib/foodhub/watch/ai', () => ({ askClaude: vi.fn() }));
const ask = vi.mocked(askClaude);
const actor = { username: 'sara', name: 'Sara', source: 'dashboard' as const };
let n = 0;
const rv = (over: Partial<ReviewInput> = {}): Review => makeReview({
  platform: 'doordash', brandName: 'Pi Pita', locationCode: 'HOCHELAGA', storeRef: 's', orderRef: `o-${n++}`, at: '2026-10-15T12:00:00.000Z', stars: 2, text: 'Mon repas est arrivé froid', source: 'import', importId: 'i', ...over,
});

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  ask.mockReset();
});
afterEach(() => { if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });

describe('guardDraft', () => {
  it('rejects another platform in a DoorDash reply, and the reverse', () => {
    expect(guardDraft('Merci! Vous pouvez aussi commander sur Uber Eats.', 'doordash')).toMatchObject({ ok: false, reasons: [expect.stringMatching(/another platform/)] });
    expect(guardDraft('Thanks, see you on SkipTheDishes', 'doordash').ok).toBe(false);
    expect(guardDraft('Merci, à bientôt sur Too Good To Go', 'doordash').ok).toBe(false);
    expect(guardDraft('Merci pour votre avis DoorDash.', 'uber_eats').ok).toBe(false);
    expect(guardDraft('Merci pour votre avis sur DoorDash.', 'doordash').ok).toBe(true); // its own name is fine
    expect(guardDraft('Commandez aussi en ligne via Food Hub ou au comptoir Clover.', 'doordash').ok).toBe(true);
  });

  it('rejects money promises and forbidden words, accents and case ignored', () => {
    for (const bad of ['Nous vous offrons un remboursement.', 'Un CRÉDIT sera ajouté.', 'Voici un rabais de 10 %.', 'We will refund you.', 'Ouvert 24/7!', 'Ouvert 24h sur 24', 'Notre cuisine virtuelle', 'Our ghost kitchen', 'Restaurant fantôme', 'Remboursé dès demain', 'Appelez le 514-555-0199', 'Écrivez à test@exemple.ca', 'Le livreur Marc était en retard']) {
      expect(guardDraft(bad, 'doordash').ok, bad).toBe(false);
    }
    expect(guardDraft('x'.repeat(601), 'google').reasons).toContain('longer than 600 characters');
    expect(guardDraft('Merci beaucoup 😀🎉', 'google')).toEqual({ ok: true, reasons: [], text: 'Merci beaucoup' }); // emojis removed, not rejected
  });
});

describe('templates', () => {
  it('French and English templates by stars and theme, all passing the guard on every platform', () => {
    const fr = templateReply(rv({ stars: 1, text: 'Il manquait les frites' }), 'Pi Pita');
    expect(fr).toMatch(/^Bonjour/);
    expect(fr).toContain('qu’il manquait quelque chose');
    expect(fr).toContain('L’équipe Pi Pita');
    const en = templateReply(rv({ stars: 2, text: 'The food arrived cold' }), 'Pi Pita');
    expect(en).toMatch(/^Hello/);
    expect(en).toContain('your meal arrived cold');
    expect(templateReply(rv({ stars: 5, text: 'Delicious, thanks!' }), 'OOeuf')).toContain('thank you so much');
    expect(templateReply(rv({ stars: 3, text: 'Correct' }), null)).toContain('L’équipe du restaurant');
    for (const stars of [null, 1, 2, 3, 4, 5]) for (const text of ['froid et en retard', 'wrong order and spilled', 'Très bon', 'Great', '']) for (const p of REVIEW_PLATFORMS) {
      const r = rv({ stars, text, platform: p });
      for (const lang of ['fr', 'en'] as const) expect(guardDraft(templateReply(r, 'Pi Pita', lang), p).ok).toBe(true);
    }
  });
});

describe('draftReply', () => {
  it('without ANTHROPIC_API_KEY: the template, Claude is not called', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await draftReply(rv());
    expect(out.source).toBe('template');
    expect(ask).not.toHaveBeenCalled();
  });

  it('a clean AI draft is kept; a draft breaking a rule falls back to the template', async () => {
    ask.mockResolvedValueOnce('Bonjour, merci de nous avoir écrit. Nous sommes désolés que votre repas soit arrivé froid. Contactez le restaurant directement. L’équipe Pi Pita');
    const ok = await draftReply(rv());
    expect(ok.source).toBe('ai');
    const [system, user] = ask.mock.calls[0];
    expect(system).toBe(draftSystemPrompt('Pi Pita'));
    expect(system).toMatch(/real brick-and-mortar restaurant in Montréal/);
    expect(user).toMatch(/Québec French/);

    ask.mockResolvedValueOnce('Désolés! Nous vous offrons un crédit sur Uber Eats, ouvert 24/7.');
    const bad = await draftReply(rv());
    expect(bad.source).toBe('template');
    expect(bad.rejected?.length).toBeGreaterThanOrEqual(3);
    expect(bad.text).toBe(templateReply(rv(), 'Pi Pita'));

    ask.mockResolvedValueOnce(null); // API down
    expect((await draftReply(rv({ text: 'It was cold' }))).text).toMatch(/^Hello/);
  });
});

describe('saving drafts and replies', () => {
  it('draft, replied and clear change only the reply state', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = rv();
    await upsertReviews([r]);
    const drafted = await draftAndSave(r.id, actor);
    expect(drafted?.review.reply).toMatchObject({ draftBy: 'Sara', draftSource: 'template' });
    const replied = await markReplied(r.id, actor);
    expect(replied?.reply).toMatchObject({ draft: drafted?.draft.text, repliedBy: 'Sara' });
    expect((await clearReply(r.id))?.reply).toBeUndefined();
    expect((await getReview(r.id))?.text).toBe(r.text);
    expect(await draftAndSave('missing', actor)).toBeNull();
  });

  it('batch: at most 25 reviews, one after the other', async () => {
    let inFlight = 0; let maxInFlight = 0;
    ask.mockImplementation(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((res) => setTimeout(res, 2)); inFlight--; return 'Bonjour, merci pour votre commentaire. L’équipe Pi Pita'; });
    const list = Array.from({ length: 30 }, () => rv());
    await upsertReviews(list);
    const out = await draftBatch(list, actor);
    expect(out).toMatchObject({ drafted: MAX_BATCH, ai: MAX_BATCH, templates: 0 });
    expect(ask).toHaveBeenCalledTimes(25);
    expect(maxInFlight).toBe(1);
  });
});
