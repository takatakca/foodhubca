import { describe, expect, it, vi } from 'vitest';
import { classifyTransportError, curlRequest, parseCurlResponse, parseOptions, ReadinessError, verifyPlatformReadiness } from '../scripts/verify-platform-readiness.mjs';

const HUB_SHA = 'a'.repeat(40), SITE_SHA = 'b'.repeat(40);
const HUB = 'https://foodhub.example', SITE = 'https://on2go.example';
const options = { foodhubUrl: HUB, foodhubSha: HUB_SHA, on2goUrls: [SITE], on2goSha: SITE_SHA };
const HEALTH = { ok: true, status: 'ok', checks: { database: 'ok', sync: 'ok', watchtower: 'ok', recovery: 'ok', inbox: 'ok', clover: 'ok', console: 'ok' } };

function service(override) {
  const calls = [];
  const request = async (raw, init) => {
    const url = new URL(raw); calls.push({ url: raw, ...init });
    expect(init.redirect).toBe('manual');
    expect(Object.keys(init.headers).some((key) => /authorization|cookie/i.test(key) && !key.toLowerCase().startsWith('access-control'))).toBe(false);
    if (init.method === 'PUT') expect(init.body).toBe('{}');
    const changed = override?.(url, init);
    if (changed) return changed;
    const headers = { 'Cache-Control': 'no-store' };
    const origin = init.headers.Origin;
    if (origin && origin !== 'https://unexpected.invalid') Object.assign(headers, {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, PATCH, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    if (url.pathname === '/api/release') return Response.json({ ok: true, app: 'foodhub', sha: HUB_SHA }, { headers });
    if (url.pathname === '/api/health') return Response.json(HEALTH, { headers });
    if (url.pathname === '/api/public/directory') return Response.json({ version: 1, brands: [{ id: 'demo' }], kitchens: [{ id: 'demo' }] }, { headers });
    if (url.pathname === '/release.txt') return new Response(SITE_SHA, { headers: { ...headers, 'Content-Type': 'text/plain' } });
    if (url.pathname === '/healthz') return new Response('ok', { headers: { ...headers, 'Content-Type': 'text/plain' } });
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    return Response.json({ ok: false, error: 'Denied' }, { status: origin === 'https://unexpected.invalid' ? 403 : 401, headers });
  };
  return { request, calls };
}

describe('public platform readiness diagnostics (no network)', () => {
  it('verifies exact releases, durable health, directory, protected organization/orders and actual customer preflights/denials', async () => {
    const fake = service(); const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.ok).toBe(true); expect(result.checks).toHaveLength(14);
    expect(fake.calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
    expect(fake.calls.find((call) => call.url.endsWith('/api/foodhub/organization'))).toBeTruthy();
    expect(result.scope).toBe('public_release_and_unauthenticated_contracts');
    expect(result.limitations.join(' ')).toMatch(/persistence.*not tested/);
  });

  it('pins both SHAs and validates every HTTPS origin before making any request', async () => {
    const request = vi.fn();
    for (const patch of [{ foodhubSha: '' }, { on2goSha: 'short' }, { foodhubUrl: 'http://foodhub.example' },
      { on2goUrls: ['https://owner:secret@on2go.example'] }, { on2goUrls: ['https://on2go.example/path'] },
      { on2goUrls: ['https://on2go.example?debug=1'] }, { on2goUrls: [] }, { on2goUrls: ['https://on2go.example/#hash'] }, { foodhubUrl: 'https://{one,two}.example' }]) {
      await expect(verifyPlatformReadiness({ ...options, ...patch }, request)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('reports proxy CONNECT403 as blocked, skips dependent hub probes and never calls it an origin403', async () => {
    const calls = [];
    const result = await verifyPlatformReadiness(options, async (url) => {
      calls.push(url); throw classifyTransportError({ code: 56, stderr: 'curl: (56) CONNECT tunnel failed, response 403' });
    });
    expect(result.ok).toBe(false); expect(calls).toHaveLength(2);
    expect(result.checks.every((check) => check.state === 'blocked' && check.code === 'proxy_blocked')).toBe(true);
    expect(result.checks.every((check) => !('httpStatus' in check))).toBe(true);
  });

  it('keeps an actual application403 distinct from a proxy rejection', async () => {
    const fake = service((url) => url.pathname === '/api/release' ? Response.json({ ok: false }, { status: 403 }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks[0]).toMatchObject({ state: 'fail', code: 'http_status', httpStatus: 403 });
    expect(result.checks.some((check) => check.code === 'proxy_blocked')).toBe(false);
  });

  it('rejects stale releases independently for Food Hub and ON2GO', async () => {
    const fake = service((url) => url.pathname === '/api/release' ? Response.json({ ok: true, app: 'foodhub', sha: 'c'.repeat(40) }, { headers: { 'Cache-Control': 'no-store' } })
      : url.pathname === '/release.txt' ? new Response('d'.repeat(40), { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.filter((check) => check.code === 'release_mismatch')).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it.each([['/api/release', 'unexpected_content'], ['/release.txt', 'unexpected_content'], ['/healthz', 'unhealthy']])('does not accept a soft HTTP200 HTML page at %s', async (path, code) => {
    const fake = service((url) => url.pathname === path ? new Response('<html>Outdated page</html>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.find((check) => check.path === path)).toMatchObject({ state: 'fail', code });
    expect(result.ok).toBe(false);
  });

  it('rejects redirects and never follows them', async () => {
    const fake = service((url) => url.pathname === '/api/release' ? new Response(null, { status: 302, headers: { Location: 'https://login.example/' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks[0]).toMatchObject({ code: 'unexpected_redirect', state: 'fail', httpStatus: 302 });
    expect(fake.calls.some((call) => call.url.startsWith('https://login.example'))).toBe(false);
  });

  it('rejects unhealthy or memory-only production even when release markers match', async () => {
    const fake = service((url) => url.pathname === '/api/health' ? Response.json({ ...HEALTH, status: 'degraded', checks: { ...HEALTH.checks, database: 'warn' } }, { headers: { 'Cache-Control': 'no-store' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.find((check) => check.check === 'foodhub_health')).toMatchObject({ code: 'unhealthy', state: 'fail' });
  });

  it.each([
    { ...HEALTH, checks: { ...HEALTH.checks, sync: 'down' } },
    { ...HEALTH, status: 'mystery' },
    { ...HEALTH, checks: { database: 'ok' } },
    { ...HEALTH, checks: { ...HEALTH.checks, watchtower: 'unknown' } },
    { ...HEALTH, checks: { ...HEALTH.checks, recovery: 'warn' } },
    { ...HEALTH, status: 'degraded' },
  ])('rejects contradictory, incomplete or unknown health: %j', async (health) => {
    const fake = service((url) => url.pathname === '/api/health' ? Response.json(health, { headers: { 'Cache-Control': 'no-store' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'foodhub_health')).toMatchObject({ code: 'unhealthy', state: 'fail' });
  });

  it('accepts the real degraded startup contract when every check is present and none is down', async () => {
    const fake = service((url) => url.pathname === '/api/health' ? Response.json({ ...HEALTH, status: 'degraded', checks: { ...HEALTH.checks, sync: 'warn' } }, { headers: { 'Cache-Control': 'no-store' } }) : null);
    expect((await verifyPlatformReadiness(options, fake.request)).ok).toBe(true);
  });

  it('rejects otherwise healthy but cacheable health data', async () => {
    const fake = service((url) => url.pathname === '/api/health' ? Response.json(HEALTH) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.find((check) => check.check === 'foodhub_health')).toMatchObject({ code: 'cache_policy', state: 'fail' });
  });

  it('detects missing newly introduced customer routes, not merely a healthy old backend', async () => {
    const fake = service((url) => url.pathname.endsWith('/favourites') ? new Response('<html>Not found</html>', { status: 404 }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.filter((check) => check.path.endsWith('/favourites') && check.code === 'route_missing')).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it('checks every real frontend origin and rejects absent method/header allowlists', async () => {
    const fake = service((url, init) => init.method === 'OPTIONS' && init.headers.Origin === 'https://preview.on2go.ca'
      ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': init.headers.Origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET' } }) : null);
    const result = await verifyPlatformReadiness({ ...options, on2goUrls: [SITE, 'https://preview.on2go.ca'] }, fake.request);
    expect(result.checks.filter((check) => check.check === 'customer_preflight:https://preview.on2go.ca' && check.code === 'cors_policy')).toHaveLength(3);
    expect(result.ok).toBe(false);
  });

  it('rejects public merchant data and customer error responses lacking no-store or JSON', async () => {
    const fake = service((url) => url.pathname === '/api/foodhub/organization' ? Response.json({ ok: true, organizations: [] })
      : url.pathname === '/api/public/on2go/me/addresses' ? Response.json({ ok: false }, { status: 401, headers: { 'Access-Control-Allow-Origin': SITE, Vary: 'Origin' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.find((check) => check.path === '/api/foodhub/organization')).toMatchObject({ code: 'http_status', state: 'fail' });
    expect(result.checks.some((check) => check.code === 'cache_policy')).toBe(true);
  });

  it('refuses an allowed-CORS response for a foreign origin', async () => {
    const fake = service((_url, init) => init.headers.Origin === 'https://unexpected.invalid'
      ? Response.json({ ok: false }, { status: 403, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://unexpected.invalid' } }) : null);
    const result = await verifyPlatformReadiness(options, fake.request);
    expect(result.checks.find((check) => check.check === 'foreign_origin_denied')).toMatchObject({ code: 'cors_policy', state: 'fail' });
  });
});

describe('proxy-aware curl transport', () => {
  it('separates CONNECT headers from the origin response without echoing bodies', () => {
    const response = parseCurlResponse('HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 200\r\ncontent-type: text/plain\r\ncache-control: no-store\r\n\r\nok\n__FOODHUB_READINESS_HTTP__:200');
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/plain');
  });

  it.each([[{ code: 6 }, 'dns_failed'], [{ code: 28 }, 'timeout'], [{ code: 60 }, 'tls_failed'],
    [{ code: 'ENOENT' }, 'transport_missing'], [{ code: 56, stderr: 'CONNECT tunnel failed, response 407' }, 'proxy_auth_required']])('classifies transport evidence without asserting the site is down', (error, code) => {
    expect(classifyTransportError(error)).toMatchObject({ code, state: 'blocked' });
  });

  it('honors configured proxy/CA through curl, ignores curlrc, and supplies no auth, cookie, insecure or follow option', async () => {
    const execute = vi.fn(async () => ({ stdout: 'HTTP/2 200\r\nContent-Type: text/plain\r\n\r\nok\n__FOODHUB_READINESS_HTTP__:200' }));
    await curlRequest(`${SITE}/healthz`, { method: 'GET' }, execute);
    const [program, args] = execute.mock.calls[0];
    expect(program).toBe('curl'); expect(args[0]).toBe('--disable'); expect(args).toContain('--globoff'); expect(args).toContain('=https');
    expect(args.some((arg) => ['-k', '--insecure', '-L', '--location', '--user', '--cookie', '--noproxy'].includes(arg))).toBe(false);
    await expect(curlRequest(`${HUB}/api/public/on2go/me/addresses`, { method: 'PUT', body: '{"addresses":[]}' }, execute)).rejects.toThrow(/invalid anonymous/);
    await expect(curlRequest(`${HUB}/api/public/on2go/me`, { headers: { Authorization: 'Bearer forbidden' } }, execute)).rejects.toThrow(/public CORS/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete or inconsistent final HTTP responses', () => {
    expect(() => parseCurlResponse('HTTP/2 200\r\n\r\nok')).toThrow(ReadinessError);
    expect(() => parseCurlResponse('HTTP/2 200\r\n\r\nok\n__FOODHUB_READINESS_HTTP__:000')).toThrow(ReadinessError);
    expect(() => parseCurlResponse('HTTP/2 200\r\n\r\nok\n__FOODHUB_READINESS_HTTP__:403')).toThrow(ReadinessError);
  });

  it('uses explicit independent SHA/origin options without any service token', () => {
    expect(parseOptions(['--foodhub-sha', HUB_SHA, '--on2go-sha', SITE_SHA, '--on2go-url', SITE], {})).toMatchObject({ foodhubSha: HUB_SHA, on2goSha: SITE_SHA, on2goUrls: [SITE] });
    expect(() => parseOptions(['--foodhub-sha', HUB_SHA], {})).toThrow(/on2goSha/);
    expect(() => parseOptions(['--token', 'forbidden'], {})).toThrow(/Use --foodhub/);
  });
});
