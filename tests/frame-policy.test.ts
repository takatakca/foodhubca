// Anti-clickjacking (lib/foodhub/frame-policy.ts, applied in proxy.ts): the console and its sign-in pages may only be
// framed by Food Hub itself and by Clover; pages made to be embedded keep their own rules.
import { describe, expect, it } from 'vitest';
import { CONSOLE_FRAME_ANCESTORS, framePolicyFor } from '../lib/foodhub/frame-policy';

describe('frame policy', () => {
  it('console pages, sign-in pages and console APIs: only Food Hub and Clover may frame them', () => {
    for (const p of ['/', '/orders', '/stores/screens', '/settings/team', '/login', '/kitchen/lock', '/api/foodhub/screens', '/api/foodhub/orders/x']) {
      expect(framePolicyFor(p)).toBe(CONSOLE_FRAME_ANCESTORS);
    }
    expect(CONSOLE_FRAME_ANCESTORS).toBe("frame-ancestors 'self' https://*.clover.com");
  });

  it('embeddable pages keep their own rules: storefront, payment links (own stricter policy), media, the public hub', () => {
    for (const p of ['/commander/ppp', '/api/storefront/menu', '/p/tok123', '/media/logo.png', '/hub', '/en/hub']) {
      expect(framePolicyFor(p)).toBeNull();
    }
  });
});
