import { beforeEach, describe, expect, it, vi } from 'vitest';

// getLang() (lib/i18n/server.ts): the public ON2GO Hub pages fix their language by path through a request header set by
// proxy.ts; that header wins over the visitor's language cookie. Without it, the cookie decides, then the default.
const state = vi.hoisted(() => ({ header: null as string | null, cookie: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.header === null ? {} : { 'x-fh-public-lang': state.header }),
  cookies: async () => ({ get: (name: string) => (name === 'fh_lang' && state.cookie !== undefined ? { name, value: state.cookie } : undefined) }),
}));

import { getLang } from '../lib/i18n/server';
import { DEFAULT_LANG, LANG_COOKIE } from '../lib/i18n';
import { PUBLIC_LANG_HEADER } from '../lib/foodhub/public-site';

describe('getLang()', () => {
  beforeEach(() => { state.header = null; state.cookie = undefined; });

  it('the mock uses the real cookie and header names', () => {
    expect(LANG_COOKIE).toBe('fh_lang');
    expect(PUBLIC_LANG_HEADER).toBe('x-fh-public-lang');
  });
  it('the path header wins over a conflicting cookie, both ways', async () => {
    state.header = 'fr'; state.cookie = 'en';
    expect(await getLang()).toBe('fr');
    state.header = 'en'; state.cookie = 'fr';
    expect(await getLang()).toBe('en');
  });
  it('falls back to the cookie, then the default; a bad header value is ignored', async () => {
    state.cookie = 'en';
    expect(await getLang()).toBe('en');
    state.header = 'de';
    expect(await getLang()).toBe('en');
    state.cookie = undefined; state.header = null;
    expect(await getLang()).toBe(DEFAULT_LANG);
  });
});
