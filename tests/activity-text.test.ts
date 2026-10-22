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
  it('translates the Google sign-in entries', () => {
    expect(activitySummary('Marie signed in with Google (m***@x.ca)', 'fr')).toBe('Marie s’est connecté avec Google (m***@x.ca)');
    expect(activitySummary('Google account not on the team (m***@x.ca)', 'fr')).toBe('Connexion Google refusée : ce compte n’est pas dans l’équipe (m***@x.ca)');
    expect(activitySummary('Google account without a verified email refused', 'fr')).toBe('Connexion Google refusée : courriel non vérifié');
    expect(activitySummary('Google callback with a missing or mismatched state', 'fr')).toBe('Connexion Google refusée : retour de Google expiré ou invalide');
    expect(activitySummary('Google refused the code exchange (invalid_grant)', 'fr')).toBe('Google refused the code exchange (invalid_grant)');
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
  it('keeps failed platform actions in the main list, even with the platform’s HTTP status in the text', () => {
    expect(isTechnical({ action: 'pause', summary: 'Paused — OOEUF · NDG on Uber Eats (POST /v1/delivery/store/x/update-store-status returned HTTP 500: busy)' })).toBe(false);
    expect(isTechnical({ action: 'item_off', summary: "86'd Poutine — OOEUF · NDG on Uber Eats (GET /api/menus returned HTTP 404)" })).toBe(false);
    expect(isTechnical({ action: 'publish', summary: 'Menu published — OOEUF · NDG on Uber Eats (Network error: fetch failed)' })).toBe(false);
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
  it('a previous period with orders but a 0 for this stat: no percentage, and never "no previous period"', () => {
    // No cancellations in either period: change(0, 0) = 0 → flat, not "pas de période précédente".
    expect(changeKind(0, true, true)).toBe('flat');
    // No cancellations then, some now: change(x, 0) = 100 → no "+100 %".
    expect(changeKind(100, true, true)).toBe('from-zero');
    expect(changeKind(100, false, true)).toBe('no-previous');
  });
  it('formats the change in the reader’s locale, one format per language', () => {
    expect(fmtChange(4.35, 'fr-CA').replace(/\s/g, ' ')).toMatch(/^\+4,4 %$/);
    expect(fmtChange(4.35, 'en-CA')).toBe('+4.4%');
    expect(fmtChange(-2, 'en-CA')).toBe('−2.0%');
    expect(fmtChange(0, 'en-CA')).toBe('0.0%');
  });
});
