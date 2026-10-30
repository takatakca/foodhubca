import { describe, expect, it } from 'vitest';
import { hasTech, plainTitle, splitTech } from '@/app/(console)/settings/tech-text';
import { settingsNavGroups, isNavOn } from '@/app/(console)/settings/settings-nav-model';

describe('owner copy: technical text', () => {
  it('spots setting names, commands, SQL files and docs paths', () => {
    expect(hasTech('Ajoutez SESSION_SECRET dans l’hébergeur.')).toBe(true);
    expect(hasTech('Lancez npm run setup.')).toBe(true);
    expect(hasTech('Exécutez INSTALL_ALL.sql.')).toBe(true);
    expect(hasTech('Guide : docs/STOREFRONT.md')).toBe(true);
    expect(hasTech('Les codes partent par courriel.')).toBe(false);
    expect(hasTech('TPS + TVQ')).toBe(false);
    expect(hasTech(undefined)).toBe(false);
  });
  it('keeps the owner’s plain sentences and folds only the technical ones', () => {
    expect(splitTech('Brouillons publics à faire relire. Manque : FOODHUB_SUPPORT_EMAIL, FOODHUB_LEGAL_APPROVED=true'))
      .toEqual({ plain: 'Brouillons publics à faire relire.', tech: 'Manque : FOODHUB_SUPPORT_EMAIL, FOODHUB_LEGAL_APPROVED=true' });
    expect(splitTech('A changé le 3 octobre : tout le monde a dû se reconnecter. Mettez une valeur fixe.'))
      .toEqual({ plain: 'A changé le 3 octobre : tout le monde a dû se reconnecter. Mettez une valeur fixe.', tech: '' });
    expect(splitTech('Optionnel : CLOVER_CLIENT_ID et CLOVER_CLIENT_SECRET avec npm run setup.')).toEqual({ plain: '', tech: 'Optionnel : CLOVER_CLIENT_ID et CLOVER_CLIENT_SECRET avec npm run setup.' });
    expect(splitTech(undefined)).toEqual({ plain: '', tech: '' });
  });
  it('drops setting names from titles', () => {
    expect(plainTitle('Secret de session (SESSION_SECRET)')).toBe('Secret de session');
    expect(plainTitle('Mot de passe de secours (DASHBOARD_PASSWORD)')).toBe('Mot de passe de secours');
    expect(plainTitle('Courriels de connexion (SMTP ou Resend)')).toBe('Courriels de connexion (SMTP ou Resend)');
  });
});

describe('settings side-nav', () => {
  const all = () => true;
  it('hides the technician tools in the simple view unless that page is open', () => {
    expect(settingsNavGroups('/settings/team', all, false).map((g) => g.key)).not.toContain('advanced');
    expect(settingsNavGroups('/settings/go-live', all, false).map((g) => g.key)).toContain('advanced');
    expect(settingsNavGroups('/settings/team', all, true).map((g) => g.key)).toContain('advanced');
  });
  it('never lists a page the viewer cannot open', () => {
    const groups = settingsNavGroups('/settings/profile', (p) => p === 'view', true);
    const hrefs = groups.flatMap((g) => g.pages.map((p) => p.href));
    expect(hrefs).toContain('/settings/profile');
    expect(hrefs).not.toContain('/settings/team');
    expect(groups.every((g) => g.pages.length > 0)).toBe(true);
  });
  it('matches sub-pages, or the exact page when asked', () => {
    expect(isNavOn('/settings/expansion/phone/ivr', '/settings/expansion')).toBe(true);
    expect(isNavOn('/settings/expansion/phone/ivr', '/settings/expansion/phone', true)).toBe(false);
    expect(isNavOn('/settings/expansionx', '/settings/expansion')).toBe(false);
  });
});
