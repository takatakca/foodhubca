import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloverAppBadges } from '@/components/clover-app-badges';
import { CLOVER_APP_MARKET_BADGE_SRC, CLOVER_APPS_LIVE_ENV, cloverAppMarketUrl, liveCloverApps } from '@/lib/foodhub/clover-apps';
import SupportPage from '@/app/legal/support/page';
import LegalLayout from '@/app/legal/layout';
import { LoginView } from '@/app/login/login-view';

const FOODHUB_URL = 'https://www.clover.com/appmarket/apps/629HFYHNVMZYR';
const PHONE_URL = 'https://www.clover.com/appmarket/apps/20FK28P20HJC6';
const BADGE_RE = /<a [^>]*href="https:\/\/www\.clover\.com\/appmarket\/apps\/[^"]+"/g;

function html(node: ReturnType<typeof createElement>) { return renderToStaticMarkup(node); }
function support() { return html(SupportPage() as ReturnType<typeof createElement>); }
function legalFooter() { return html(LegalLayout({ children: createElement('p', null, 'body') }) as ReturnType<typeof createElement>); }
function login(apps = liveCloverApps()) {
  return html(createElement(LoginView, { next: '/', error: null, firstRun: false, recovery: false, needsKey: false, cloverApps: apps }));
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('Clover App Market badges (go-live switch NEXT_PUBLIC_CLOVER_APPS_LIVE)', () => {
  it('reads the switch as a comma list, ignoring case, spaces and unknown names', () => {
    expect(CLOVER_APPS_LIVE_ENV).toBe('NEXT_PUBLIC_CLOVER_APPS_LIVE');
    expect(liveCloverApps(undefined)).toEqual([]);
    expect(liveCloverApps('')).toEqual([]);
    expect(liveCloverApps(' , ')).toEqual([]);
    expect(liveCloverApps('phone').map((a) => a.key)).toEqual(['phone']);
    expect(liveCloverApps(' Phone , FOODHUB, uber ').map((a) => a.key)).toEqual(['foodhub', 'phone']);
    expect(cloverAppMarketUrl('20FK28P20HJC6')).toBe(PHONE_URL);
  });

  it('is hidden by default on every public page', () => {
    vi.stubEnv(CLOVER_APPS_LIVE_ENV, '');
    expect(html(createElement(CloverAppBadges, { apps: liveCloverApps(), lang: 'fr' }))).toBe('');
    for (const page of [support(), legalFooter(), login()]) {
      expect(page).not.toContain('appmarket/apps');
      expect(page).not.toContain(CLOVER_APP_MARKET_BADGE_SRC);
      expect(page).not.toContain('data-clover-badges');
    }
  });

  it('shows each listed app with its own absolute market link and Clover’s hosted badge', () => {
    vi.stubEnv(CLOVER_APPS_LIVE_ENV, 'foodhub,phone');
    const out = html(createElement(CloverAppBadges, { apps: liveCloverApps(), lang: 'en' }));
    expect(out).toContain('Get the apps on Clover');
    expect(out).toContain(`href="${FOODHUB_URL}"`);
    expect(out).toContain(`href="${PHONE_URL}"`);
    expect(out.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(out.match(new RegExp(`src="${CLOVER_APP_MARKET_BADGE_SRC.replace(/[.]/g, '\\.')}"`, 'g'))).toHaveLength(2);
    expect(out).toContain('alt="Install From Clover App Market"');
    expect(out).toContain('aria-label="Install TAKATAK Food Hub from the Clover App Market"');
    expect(out).toContain('aria-label="Install TAKATAK Phone AI from the Clover App Market"');
    expect(out).not.toMatch(/href="\/appmarket/); // never Clover's relative snippet URL

    const fr = html(createElement(CloverAppBadges, { apps: liveCloverApps(), lang: 'fr' }));
    expect(fr).toContain('Nos applications sur Clover');
    expect(fr).toContain('alt="Installer depuis le Clover App Market"');
    expect(fr).toContain('aria-label="Installer TAKATAK Phone AI depuis le Clover App Market"');
  });

  it('only the listed app appears: phone alone', () => {
    vi.stubEnv(CLOVER_APPS_LIVE_ENV, 'phone');
    const page = support();
    expect(page).toContain(`href="${PHONE_URL}"`);
    expect(page).not.toContain(FOODHUB_URL);
    expect(page.match(BADGE_RE)).toHaveLength(2); // FR block + EN block
  });

  it('places the badges on the support page (FR + EN), the legal footer and the sign-in page', () => {
    vi.stubEnv(CLOVER_APPS_LIVE_ENV, 'foodhub,phone');
    const page = support();
    expect(page.match(BADGE_RE)).toHaveLength(4);
    expect(page).toContain('Nos applications sur Clover');
    expect(page).toContain('Get the apps on Clover');

    const footer = legalFooter();
    expect(footer).toContain('data-clover-badges="compact"');
    expect(footer.match(BADGE_RE)).toHaveLength(2);
    expect(footer).toContain(`href="${FOODHUB_URL}"`);

    const signIn = login();
    expect(signIn).toContain('data-clover-badges="compact"');
    expect(signIn).toContain(`href="${PHONE_URL}"`);
    expect(signIn.match(BADGE_RE)).toHaveLength(2);
  });
});
