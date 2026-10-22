import { describe, expect, it } from 'vitest';
import { activitySummary, isTechnical } from '@/app/(console)/insights/activity/activity-text';
import { changeKind, fmtChange } from '@/components/charts/charts';

describe('activity log in French', () => {
  it('translates the common entries', () => {
    expect(activitySummary('Marie signed in with the recovery password (owner)', 'fr')).toBe('Marie s’est connecté avec le mot de passe de secours (propriétaire)');
    expect(activitySummary('OOEUF · NDG on Uber Eats is now online', 'fr')).toBe('OOEUF · NDG est maintenant en ligne sur Uber Eats');
    expect(activitySummary('Uber Eats order ab12cd34 for OOEUF · NDG never arrived by webhook — found on Uber and processed', 'fr'))
      .toBe('Commande Uber Eats ab12cd34 pour OOEUF · NDG : jamais reçue automatiquement, retrouvée sur Uber et traitée');
    expect(activitySummary('Kitchen tablet "Passe" enrolled at NDG', 'fr')).toBe('Tablette de cuisine « Passe » enregistrée à NDG');
  });
  it('keeps English for English readers and unknown entries as written', () => {
    expect(activitySummary('Marie signed in with the recovery password (owner)', 'en')).toBe('Marie signed in with the recovery password (owner)');
    expect(activitySummary('Something new happened', 'fr')).toBe('Something new happened');
  });
  it('puts screen diagnostics under « Technique », never support reports', () => {
    expect(isTechnical({ action: 'screen_problem', summary: 'x' })).toBe(true);
    expect(isTechnical({ action: 'other', summary: '1 problem(s) on /: GET /api/foodhub/pulse → network error' })).toBe(true);
    expect(isTechnical({ action: 'support_report', summary: 'Marie sent a support report from the console: printer jam' })).toBe(false);
    expect(isTechnical({ action: 'sign_in', summary: 'Marie signed in with a code (m***@x.ca)' })).toBe(false);
  });
});

describe('stat change vs the previous period', () => {
  it('says "no previous period" instead of +100 %', () => {
    expect(changeKind(100, false)).toBe('no-previous');
    expect(changeKind(undefined, true)).toBe('none');
    expect(changeKind(0, true)).toBe('flat');
    expect(changeKind(-3, true)).toBe('down');
    expect(changeKind(4.4, undefined)).toBe('up');
  });
  it('formats the change in the reader’s locale, one format per language', () => {
    expect(fmtChange(4.35, 'fr-CA').replace(/\s/g, ' ')).toMatch(/^\+4,4 %$/);
    expect(fmtChange(4.35, 'en-CA')).toBe('+4.4%');
    expect(fmtChange(-2, 'en-CA')).toBe('−2.0%');
    expect(fmtChange(0, 'en-CA')).toBe('0.0%');
  });
});
