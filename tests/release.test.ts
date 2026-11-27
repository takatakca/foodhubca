import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import releaseProbe from '../lib/foodhub/release-probe.json';

const SHA = '609cc6f1a3a8ee78ef681d5fb92f7f5fe6087cd7';
const NONCE = 'f'.repeat(32);
const query = `${releaseProbe.query}=${NONCE}`;

describe('/api/release', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.FOODHUB_RELEASE_SHA;
    delete process.env.SOURCE_COMMIT;
    delete process.env.GITHUB_SHA;
    delete process.env.COOLIFY_COMMIT_SHA;
  });

  it('returns a public commit marker without cache', async () => {
    process.env.FOODHUB_RELEASE_SHA = '609cc6f1a3a8ee78ef681d5fb92f7f5fe6087cd7';
    const { GET } = await import('../app/api/release/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      ok: true,
      app: 'foodhub',
      sha: '609cc6f1a3a8ee78ef681d5fb92f7f5fe6087cd7',
      shortSha: '609cc6f',
      probeIdentity: releaseProbe.capability,
    });
  });

  it('stays available locally even when no build SHA is present', async () => {
    const { GET } = await import('../app/api/release/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, app: 'foodhub', sha: null, shortSha: null });
  });

  it('is public on its exact path only', async () => {
    const { proxy } = await import('../proxy');
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.DASHBOARD_PASSWORD = 'p'.repeat(16);
    expect((await proxy(new NextRequest('http://hub.local/api/release'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(new NextRequest('http://hub.local/api/release/x'))).status).toBe(401);
  });

  it.each(['/api/release', '/api/public/directory', '/api/health', '/login', '/api/foodhub/orders'])('binds a probe response on %s without changing its gate', async (path) => {
    const { proxy } = await import('../proxy');
    vi.stubEnv('FOODHUB_RELEASE_SHA', SHA);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    vi.stubEnv('DASHBOARD_PASSWORD', 'p'.repeat(16));
    const response = await proxy(new NextRequest(`http://hub.local${path}?${query}`));
    expect(response.status).toBe(path === '/api/foodhub/orders' ? 401 : 200);
    expect(response.headers.get(releaseProbe.shaHeader)).toBe(SHA);
    expect(response.headers.get(releaseProbe.nonceHeader)).toBe(NONCE);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const ordinary = await proxy(new NextRequest(`http://hub.local${path}`));
    expect(ordinary.status).toBe(response.status);
    expect(ordinary.headers.has(releaseProbe.shaHeader)).toBe(false);
    expect(ordinary.headers.has(releaseProbe.nonceHeader)).toBe(false);
  });

  it('does not stamp methods, paths or probe values outside the exact contract', async () => {
    const { proxy } = await import('../proxy');
    vi.stubEnv('FOODHUB_RELEASE_SHA', SHA);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    vi.stubEnv('DASHBOARD_PASSWORD', 'p'.repeat(16));
    const requests = [
      new NextRequest(`http://hub.local/api/release?${query}`, { method: 'POST' }),
      new NextRequest(`http://hub.local/api/release?${query}&${query}`),
      new NextRequest(`http://hub.local/api/release?${releaseProbe.query}=short`),
      new NextRequest(`http://hub.local/api/release/private?${query}`),
      new NextRequest(`http://hub.local/hub?${query}`),
    ];
    for (const request of requests) {
      const response = await proxy(request);
      expect(response.headers.has(releaseProbe.shaHeader)).toBe(false);
      expect(response.headers.has(releaseProbe.nonceHeader)).toBe(false);
    }
    vi.stubEnv('FOODHUB_RELEASE_SHA', 'invalid');
    const response = await proxy(new NextRequest(`http://hub.local/api/release?${query}`));
    expect(response.headers.has(releaseProbe.shaHeader)).toBe(false);
    expect(response.headers.has(releaseProbe.nonceHeader)).toBe(false);
  });
});
