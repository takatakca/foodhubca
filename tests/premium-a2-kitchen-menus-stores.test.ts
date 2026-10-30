import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '@/lib/i18n';
import { countEn, countFr, enWord, frWord } from '@/lib/ui/count-label';
import { statusDetailText } from '@/components/stores/status-detail';
import { pctText, pricingSummary, PlatformPricing } from '@/components/menu/platform-pricing';
import { OverflowMenu } from '@/components/menu/overflow-menu';
import { SectionPicker } from '@/components/stores/section-picker';
import type { MasterMenu } from '@/lib/foodhub/types';

const fr = translator('fr');
const en = translator('en');
const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);

describe('counted words (no more "(s)")', () => {
  it('French keeps the singular for 0 and 1, English for 1 only', () => {
    expect(countFr(0, 'magasin')).toBe('0 magasin');
    expect(countFr(1, 'magasin')).toBe('1 magasin');
    expect(countFr(2, 'magasin')).toBe('2 magasins');
    expect(countEn(0, 'store')).toBe('0 stores');
    expect(countEn(1, 'store')).toBe('1 store');
    expect(countEn(3, 'dish', 'dishes')).toBe('3 dishes');
  });
  it('takes an irregular plural and reads a missing count as 0', () => {
    expect(frWord(2, 'nouveau', 'nouveaux')).toBe('nouveaux');
    expect(countFr(3, 'plateforme a', 'plateformes ont')).toBe('3 plateformes ont');
    expect(countFr(undefined, 'produit')).toBe('0 produit');
    expect(enWord(null, 'row')).toBe('rows');
  });
});

describe('platform status reasons in the owner’s words', () => {
  it('turns DoorDash’s raw "out_of_business — Deactivated by DoorDash" into one French sentence', () => {
    expect(statusDetailText(fr, 'out_of_business — Deactivated by DoorDash')).toBe('Fermé pour de bon selon la plateforme');
    expect(statusDetailText(en, 'out_of_business — Deactivated by DoorDash')).toBe('Closed for good according to the platform');
  });
  it('maps Uber codes and our own notes; never shows underscores; empty stays empty', () => {
    expect(statusDetailText(fr, 'OFFLINE')).toBe('Hors ligne sur la plateforme');
    expect(statusDetailText(fr, 'Paused from TAKATAK')).toBe('mis en pause d’ici');
    expect(statusDetailText(fr, 'some_new_code')).toBe('some new code');
    expect(statusDetailText(fr, '')).toBeNull();
    expect(statusDetailText(fr, undefined)).toBeNull();
  });
});

describe('Menus: price per platform card', () => {
  it('formats markups the Québec way and summarises the three platforms on one line', () => {
    expect(pctText(20, 'fr-CA')).toBe('+20 %');
    expect(pctText(-5, 'en-CA')).toBe('−5%');
    expect(pctText(0, 'fr-CA')).toBe('—');
    expect(pricingSummary({ uber_eats: 20, skip: 12.5 }, 'fr-CA')).toBe('Uber Eats +20 % · DoorDash — · Skip +12,5 %');
  });
  it('renders closed as one labelled disclosure button (no bare number fields in the toolbar)', () => {
    const menu = { channelMarkupPct: { uber_eats: 20 }, items: [], categories: [], modifierGroups: [] } as unknown as MasterMenu;
    const out = html(createElement(PlatformPricing, { menu, onChange: () => undefined }));
    expect(out).toContain('Prix par plateforme');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('<input');
  });
});

describe('Menus: "Plus d’actions" menu', () => {
  it('is one labelled button that announces a menu, closed until pressed', () => {
    const out = html(createElement(OverflowMenu, { label: 'Plus d’actions', items: [{ key: 'share', label: 'Menu partagé', onSelect: () => undefined }] }));
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-label="Plus d’actions"');
    expect(out).not.toContain('role="menu"');
  });
  it('is disabled when every item is', () => {
    const out = html(createElement(OverflowMenu, { label: 'More', items: [{ key: 'a', label: 'A', onSelect: () => undefined, disabled: true }] }));
    expect(out).toMatch(/<button[^>]*disabled=""/);
  });
});

describe('Restaurants: section picker (no third tab strip)', () => {
  it('draws pills from 640 px and one labelled select on a phone, both on the current view', () => {
    const out = html(createElement(SectionPicker, { label: 'Afficher', value: 'busy', onChange: () => undefined, options: [{ key: 'now', label: 'Statut maintenant' }, { key: 'busy', label: 'Calendrier occupé' }] }));
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('<select');
    expect(out).toContain('aria-label="Afficher"');
    expect(out).toMatch(/<option value="busy" selected="">Calendrier occupé<\/option>/);
    expect(out).not.toContain('role="tablist"');
  });
});
