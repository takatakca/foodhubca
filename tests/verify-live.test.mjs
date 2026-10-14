import { describe, expect, it } from 'vitest';
import { parseOptions, verifyLiveDeployment } from '../scripts/verify-live.mjs';

const SHA = 'a'.repeat(40);
function mockFetch({ sha = SHA, publicStatus = 200, privateStatus = 401, healthStatus = 200, cors = true } = {}) {
  return async (url, options) => {
    const path = new URL(url).pathname;
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('manual');
    if (path === '/api/release') {
      return Response.json({ ok: true, app: 'foodhub', sha });
    }
    if (path === '/api/public/directory') {
      expect(options.headers.Origin).toBe('https://on2go.ca');
      return new Response(JSON.stringify({ version: 1, brands: [{ id: 'test' }], kitchens: [{ id: 'test' }] }), {
        status: publicStatus,
        headers: cors ? { 'access-control-allow-origin': 'https://on2go.ca' } : {},
      });
    }
    if (path === '/api/health') {
      return Response.json({ ok: true, status: 'healthy', checks: { db: true } }, { status: healthStatus });
    }
    if (path === '/login') return new Response('login', { status: 200 });
    if (path === '/api/foodhub/orders') return Response.json({ ok: false }, { status: privateStatus });
    throw new Error('Unexpected request: ' + path);
  };
}

describe('Food Hub live release verification (no network)', () => {
  it('verifies version, directory, health, login and protected orders', async () => {
    const report = await verifyLiveDeployment({
      url: 'https://foodhub.on2go.ca/',
      sha: SHA,
      fetchImpl: mockFetch(),
    });
    expect(report.sha).toBe(SHA);
    expect(report.checks).toHaveLength(5);
  });

  it('fails when a different commit is deployed', async () => {
    await expect(verifyLiveDeployment({
      url: 'https://foodhub.on2go.ca/',
      sha: 'b'.repeat(40),
      fetchImpl: mockFetch(),
    })).rejects.toThrow(/different SHA/);
  });

  it('fails closed if anonymous orders become accessible', async () => {
    await expect(verifyLiveDeployment({
      url: 'https://foodhub.on2go.ca/',
      sha: SHA,
      fetchImpl: mockFetch({ privateStatus: 200 }),
    })).rejects.toThrow(/expected 401/);
  });

  it('rejects failed health, broken directory or missing CORS', async () => {
    const params = { url: 'https://foodhub.on2go.ca/', sha: SHA };
    await expect(verifyLiveDeployment({ ...params, fetchImpl: mockFetch({ healthStatus: 503 }) })).rejects.toThrow(/api\/health/);
    await expect(verifyLiveDeployment({ ...params, fetchImpl: mockFetch({ publicStatus: 503 }) })).rejects.toThrow(/api\/public\/directory/);
    await expect(verifyLiveDeployment({ ...params, fetchImpl: mockFetch({ cors: false }) })).rejects.toThrow(/ON2GO origin/);
  });

  it('rejects unsafe hosts, credentials, unpinned malformed SHA and subpaths', async () => {
    for (const url of ['http://foodhub.on2go.ca/', 'https://admin:password@foodhub.on2go.ca/',
      'https://foodhub.on2go.ca/not-root', 'https://foodhub.on2go.ca/?debug=1']) {
      await expect(verifyLiveDeployment({ url, fetchImpl: mockFetch() })).rejects.toThrow(/HTTPS origin/);
    }
    await expect(verifyLiveDeployment({ url: 'https://foodhub.on2go.ca/', sha: 'abc', fetchImpl: mockFetch() })).rejects.toThrow(/40-character/);
  });

  it('uses explicit CLI args ahead of environment without requiring credentials', () => {
    expect(parseOptions(['--url', 'https://foodhub.on2go.ca/', '--sha', SHA], {
      FOODHUB_HTTPS_URL: 'https://elsewhere.example/',
      EXPECTED_SHA: 'b'.repeat(40),
    })).toEqual({ url: 'https://foodhub.on2go.ca/', sha: SHA });
  });
});
