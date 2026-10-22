import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

describe('/api/release', () => {
  afterEach(() => {
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
});
