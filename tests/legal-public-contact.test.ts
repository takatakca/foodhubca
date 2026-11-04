import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from '@/app/legal/privacy/page';
import TermsPage from '@/app/legal/terms/page';
import { legalInfo } from '@/lib/foodhub/legal';
import { PUBLIC_GROUP_SUPPORT_EMAIL } from '@/lib/foodhub/public-support';

beforeEach(() => {
  vi.stubEnv('FOODHUB_SUPPORT_EMAIL', '');
  vi.stubEnv('FOODHUB_SUPPORT_PHONE', '');
  vi.stubEnv('FOODHUB_LEGAL_COMPANY', 'Demo Legal Company');
  vi.stubEnv('FOODHUB_LEGAL_ADDRESS', 'Demo legal address');
  vi.stubEnv('FOODHUB_LEGAL_APPROVED', 'false');
});
afterEach(() => vi.unstubAllEnvs());

describe.each([['privacy', PrivacyPage], ['terms', TermsPage]] as const)('%s public contact presentation', (_name, Page) => {
  it('shows the published group email in FR and EN instead of a configuration placeholder', () => {
    const before = legalInfo();
    const html = renderToStaticMarkup(createElement(Page));
    const english = html.indexOf('id="en"');
    expect(english).toBeGreaterThan(0);
    expect(html.slice(0, english)).toContain(PUBLIC_GROUP_SUPPORT_EMAIL);
    expect(html.slice(english)).toContain(PUBLIC_GROUP_SUPPORT_EMAIL);
    expect(html).not.toMatch(/FOODHUB_SUPPORT_EMAIL|FOODHUB_SUPPORT_PHONE|courriel à compléter|email to be completed/);
    expect(html).toContain('Demo Legal Company');
    expect(html).toContain('Demo legal address');
    expect(legalInfo()).toEqual(before);
    expect(legalInfo().approved).toBe(false);
  });

  it('uses the same fallback for whitespace-only configuration', () => {
    vi.stubEnv('FOODHUB_SUPPORT_EMAIL', '  \t  ');
    expect(renderToStaticMarkup(createElement(Page))).toContain(PUBLIC_GROUP_SUPPORT_EMAIL);
  });

  it('keeps the configured support address and optional phone without replacing company/legal approval data', () => {
    vi.stubEnv('FOODHUB_SUPPORT_EMAIL', '  demo-support@example.test  ');
    vi.stubEnv('FOODHUB_SUPPORT_PHONE', '+1 555-555-0101');
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain('demo-support@example.test');
    expect(html).toContain('+1 555-555-0101');
    expect(html).not.toContain(PUBLIC_GROUP_SUPPORT_EMAIL);
    expect(legalInfo().company).toBe('Demo Legal Company');
    expect(legalInfo().address).toBe('Demo legal address');
    expect(legalInfo().approved).toBe(false);
  });
});
