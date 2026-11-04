// Public deployment diagnostics only. Never accepts credentials, follows redirects, disables TLS or deploys.
// GET/OPTIONS plus deliberately invalid, anonymous PUT {} verify the saved-list routes deny writes.
// Usage: node scripts/verify-platform-readiness.mjs --foodhub-sha <40hex> --on2go-sha <40hex>
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const DEFAULT_SITES = ['https://on2go.ca', 'https://www.on2go.ca', 'https://preview.on2go.ca'];
const MARKER = '\n__FOODHUB_READINESS_HTTP__:';
const TRANSPORT_MESSAGES = {
  proxy_blocked: 'The configured proxy rejected the HTTPS CONNECT tunnel. The origin was not observed.',
  proxy_auth_required: 'The configured proxy requires authorization. The origin was not observed.',
  proxy_tunnel_failed: 'The configured proxy could not establish the HTTPS tunnel. The origin was not observed.',
  dns_failed: 'Name resolution failed in this environment; current production state is unknown.',
  timeout: 'The request timed out; current production state is unknown.',
  tls_failed: 'HTTPS trust could not be established. Check the configured CA and certificate without disabling verification.',
  transport_missing: 'curl is unavailable; no request was made.',
  network_unreachable: 'No complete HTTP response was received; current production state is unknown.',
};

export class ReadinessError extends Error {
  constructor(code, message, state = 'fail', httpStatus) {
    super(message); this.name = 'ReadinessError'; this.code = code; this.state = state; this.httpStatus = httpStatus;
  }
}

export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A valid HTTPS origin is required.'); }
  if (typeof value !== 'string' || /\s/.test(value) || url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('Supply an HTTPS origin without credentials, query or subpath.');
  if (!/^[a-z0-9.-]+$/i.test(url.hostname) && !/^\[[a-f0-9:.]+\]$/i.test(url.hostname)) throw new Error('Supply a literal HTTPS hostname or IP, without URL glob syntax.');
  return url.origin;
}

export function validateOptions(options) {
  const foodhubUrl = validateOrigin(options.foodhubUrl || 'https://foodhub.on2go.ca');
  const on2goUrls = [...new Set((options.on2goUrls ?? DEFAULT_SITES).map(validateOrigin))];
  if (on2goUrls.length < 1 || on2goUrls.length > 10) throw new Error('Supply between one and ten ON2GO origins.');
  for (const key of ['foodhubSha', 'on2goSha']) {
    if (!/^[0-9a-f]{40}$/i.test(options[key] || '')) throw new Error(`${key} requires the complete expected 40-character Git SHA.`);
  }
  return { foodhubUrl, foodhubSha: options.foodhubSha.toLowerCase(), on2goUrls, on2goSha: options.on2goSha.toLowerCase() };
}

export function parseOptions(argv, env = process.env) {
  const options = { foodhubUrl: env.FOODHUB_HTTPS_URL || 'https://foodhub.on2go.ca', foodhubSha: env.EXPECTED_FOODHUB_SHA || '',
    on2goSha: env.EXPECTED_ON2GO_SHA || '', on2goUrls: env.ON2GO_HTTPS_URLS ? env.ON2GO_HTTPS_URLS.split(',').map((s) => s.trim()) : DEFAULT_SITES };
  let explicitSites = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--foodhub-url', '--foodhub-sha', '--on2go-url', '--on2go-sha'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Use --foodhub-sha SHA40 --on2go-sha SHA40; optional --foodhub-url ORIGIN and repeated --on2go-url ORIGIN.');
    }
    const value = argv[++i];
    if (flag === '--on2go-url') { if (!explicitSites) options.on2goUrls = []; explicitSites = true; options.on2goUrls.push(value); }
    else options[flag === '--foodhub-url' ? 'foodhubUrl' : flag === '--foodhub-sha' ? 'foodhubSha' : 'on2goSha'] = value;
  }
  return validateOptions(options);
}

export function classifyTransportError(error) {
  const detail = `${error?.stderr || ''} ${error?.message || ''}`;
  let code = 'network_unreachable';
  if (/CONNECT tunnel failed, response 403|HTTP code 403 from proxy after CONNECT/i.test(detail)) code = 'proxy_blocked';
  else if (/CONNECT tunnel failed, response 407|HTTP code 407 from proxy after CONNECT/i.test(detail)) code = 'proxy_auth_required';
  else if (/CONNECT tunnel failed|proxy CONNECT aborted/i.test(detail)) code = 'proxy_tunnel_failed';
  else if (error?.code === 'ENOENT') code = 'transport_missing';
  else if ([5, 6].includes(Number(error?.code))) code = 'dns_failed';
  else if (Number(error?.code) === 28 || error?.killed || ['TimeoutError', 'AbortError'].includes(error?.name)) code = 'timeout';
  else if ([51, 58, 60, 77, 83, 90, 91].includes(Number(error?.code))) code = 'tls_failed';
  return new ReadinessError(code, TRANSPORT_MESSAGES[code], 'blocked');
}

/** Parse curl's final status separately from proxy CONNECT/interim response headers. */
export function parseCurlResponse(stdout) {
  const marker = stdout.lastIndexOf(MARKER);
  const statusText = marker >= 0 ? stdout.slice(marker + MARKER.length).trim() : '';
  if (!/^\d{3}$/.test(statusText) || Number(statusText) < 200) throw new ReadinessError('invalid_response', 'No complete final HTTP response was received.');
  let content = stdout.slice(0, marker);
  let headers = new Headers();
  let lastStatus;
  while (/^HTTP\/\S+\s+\d{3}[^\r\n]*\r?\n/.test(content)) {
    const end = content.search(/\r?\n\r?\n/);
    if (end < 0) throw new ReadinessError('invalid_response', 'Incomplete HTTP headers.');
    const block = content.slice(0, end);
    const split = content.slice(end).match(/^\r?\n\r?\n/)[0].length;
    const lines = block.split(/\r?\n/);
    lastStatus = Number(lines.shift().match(/^HTTP\/\S+\s+(\d{3})/)[1]);
    headers = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    content = content.slice(end + split);
  }
  const status = Number(statusText);
  if (lastStatus !== status) throw new ReadinessError('invalid_response', 'Final HTTP status and response headers disagree.');
  return new Response([204, 304].includes(status) ? null : content, { status, headers });
}

export async function curlRequest(url, options = {}, executeImpl = execute) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('Public probes require HTTPS without URL credentials or fragments.');
  validateOrigin(target.origin);
  const method = options.method || 'GET';
  if (!['GET', 'OPTIONS', 'PUT'].includes(method) || (method === 'PUT' && options.body !== '{}')) {
    throw new Error('Only public reads and invalid anonymous PUT {} probes are supported.');
  }
  const args = ['--disable', '--globoff', '--silent', '--show-error', '--max-time', '15', '--connect-timeout', '8', '--proto', '=https',
    '--request', method, '--dump-header', '-', '--output', '-', '--write-out', `${MARKER}%{http_code}`,
    '--header', 'Cache-Control: no-cache'];
  for (const [key, value] of Object.entries(options.headers || {})) {
    if (!['origin', 'access-control-request-method', 'access-control-request-headers', 'content-type'].includes(key.toLowerCase()) || /[\r\n]/.test(value)) {
      throw new Error('Only public CORS probe headers are accepted.');
    }
    args.push('--header', `${key}: ${value}`);
  }
  if (method === 'PUT') args.push('--data-binary', '{}');
  args.push('--url', url);
  // curl honors the environment's configured proxy/CA. --disable ignores user curlrc, and no -L/-k/auth/cookies are used.
  let stdout;
  try { ({ stdout } = await executeImpl('curl', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 })); }
  catch (error) { throw classifyTransportError(error); }
  return parseCurlResponse(stdout);
}

function requireStatus(response, expected) {
  if (response.status >= 300 && response.status < 400) throw new ReadinessError('unexpected_redirect', 'Redirect received; the expected endpoint was not verified.', 'fail', response.status);
  if (response.status !== expected) throw new ReadinessError(response.status === 404 ? 'route_missing' : 'http_status', `HTTP ${response.status}; expected ${expected}.`, 'fail', response.status);
}
function requireNoStore(response) {
  if (!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') || '')) throw new ReadinessError('cache_policy', 'Expected Cache-Control: no-store.');
}
async function jsonBody(response) {
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new ReadinessError('unexpected_content', 'Expected application JSON; HTML or another content type cannot prove the endpoint.');
  try { const body = await response.json(); if (body && typeof body === 'object' && !Array.isArray(body)) return body; } catch { /* rejected below */ }
  throw new ReadinessError('unexpected_content', 'Expected a valid JSON object.');
}
function requireCors(response, origin) {
  if (response.headers.get('access-control-allow-origin') !== origin || !(response.headers.get('vary') || '').split(',').some((v) => v.trim().toLowerCase() === 'origin')) {
    throw new ReadinessError('cors_policy', 'The exact ON2GO origin and Vary: Origin were not returned.');
  }
}
function tokens(response, header) { return (response.headers.get(header) || '').toLowerCase().split(',').map((s) => s.trim()); }

export async function verifyPlatformReadiness(rawOptions, requestImpl = curlRequest) {
  const options = validateOptions(rawOptions); // Validate both complete SHAs and every origin BEFORE any request.
  const checks = [];
  async function check(target, name, path, method, headers, evaluate, body) {
    try {
      const response = await requestImpl(`${target}${path}`, { method, headers, ...(body ? { body } : {}), redirect: 'manual' });
      await evaluate(response);
      const result = { target, check: name, path, method, state: 'pass', code: 'verified', httpStatus: response.status };
      checks.push(result); return result;
    } catch (error) {
      const failure = error instanceof ReadinessError ? error : classifyTransportError(error);
      const result = { target, check: name, path, method, state: failure.state, code: failure.code, message: failure.message,
        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}) };
      checks.push(result); return result;
    }
  }
  const hub = options.foodhubUrl;
  const hubRelease = await check(hub, 'foodhub_release', '/api/release', 'GET', {}, async (response) => {
    requireStatus(response, 200); requireNoStore(response); const value = await jsonBody(response);
    if (value.ok !== true || value.app !== 'foodhub' || !/^[a-f0-9]{40}$/i.test(value.sha || '')) throw new ReadinessError('invalid_release', 'Response did not identify a complete Food Hub release.');
    if (value.sha.toLowerCase() !== options.foodhubSha) throw new ReadinessError('release_mismatch', `Food Hub serves ${value.sha.toLowerCase()}, expected ${options.foodhubSha}.`);
  });
  if (hubRelease.state !== 'blocked') {
    await check(hub, 'foodhub_health', '/api/health', 'GET', {}, async (response) => {
      requireStatus(response, 200); requireNoStore(response); const value = await jsonBody(response);
      const keys = ['database', 'sync', 'watchtower', 'recovery', 'inbox', 'clover', 'console'];
      const checks = value.checks;
      if (value.ok !== true || !['ok', 'degraded'].includes(value.status) || !checks || typeof checks !== 'object' || Array.isArray(checks) ||
          keys.some((key) => !['ok', 'warn'].includes(checks[key])) || Object.values(checks).some((state) => !['ok', 'warn'].includes(state)) || checks.database !== 'ok') {
        throw new ReadinessError('unhealthy', 'Food Hub health is missing checks, contains a failure or does not prove durable database access.');
      }
      const expected = Object.values(checks).includes('warn') ? 'degraded' : 'ok';
      if (value.status !== expected) throw new ReadinessError('unhealthy', 'Food Hub aggregate health disagrees with its individual checks.');
    });
    await check(hub, 'public_directory', '/api/public/directory', 'GET', { Origin: options.on2goUrls[0] }, async (response) => {
      requireStatus(response, 200); requireCors(response, options.on2goUrls[0]); const value = await jsonBody(response);
      if (value.version !== 1 || !Array.isArray(value.brands) || !value.brands.length || !Array.isArray(value.kitchens) || !value.kitchens.length) {
        throw new ReadinessError('directory_invalid', 'The public directory has no verifiable brand/kitchen data.');
      }
    });
    for (const path of ['/api/foodhub/orders', '/api/foodhub/organization']) await check(hub, 'protected_merchant_route', path, 'GET', {}, async (response) => {
      requireStatus(response, 401); const value = await jsonBody(response);
      if (value.ok !== false) throw new ReadinessError('auth_contract', 'Anonymous access was not denied with application JSON.');
    });
  }
  for (const origin of options.on2goUrls) {
    const release = await check(origin, 'on2go_release', '/release.txt', 'GET', {}, async (response) => {
      requireStatus(response, 200); requireNoStore(response);
      if (!/^text\/plain(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new ReadinessError('unexpected_content', 'Expected a plain-text release marker, not HTML.');
      const value = (await response.text()).trim();
      if (!/^[a-f0-9]{40}$/i.test(value)) throw new ReadinessError('invalid_release', 'Response did not contain a complete ON2GO release SHA.');
      if (value.toLowerCase() !== options.on2goSha) throw new ReadinessError('release_mismatch', `ON2GO serves ${value.toLowerCase()}, expected ${options.on2goSha}.`);
    });
    if (release.state !== 'blocked') await check(origin, 'on2go_health', '/healthz', 'GET', {}, async (response) => {
      requireStatus(response, 200); requireNoStore(response);
      if (!/^text\/plain(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || (await response.text()).trim() !== 'ok') throw new ReadinessError('unhealthy', 'Expected the actual ON2GO health response, not a soft HTTP200 page.');
    });
    if (hubRelease.state === 'blocked') continue;
    for (const [path, method] of [['/api/public/on2go/me', 'GET'], ['/api/public/on2go/me/addresses', 'PUT'], ['/api/public/on2go/me/favourites', 'PUT']]) {
      await check(hub, `customer_preflight:${origin}`, path, 'OPTIONS', { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization, content-type' }, (response) => {
        requireStatus(response, 204); requireCors(response, origin);
        if (!tokens(response, 'access-control-allow-methods').includes(method.toLowerCase()) || !['authorization', 'content-type'].every((header) => tokens(response, 'access-control-allow-headers').includes(header))) {
          throw new ReadinessError('cors_policy', 'Preflight does not permit the actual customer method and browser headers.');
        }
      });
      await check(hub, `customer_anonymous_denied:${origin}`, path, method, { Origin: origin, ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}) }, async (response) => {
        requireStatus(response, 401); requireCors(response, origin); requireNoStore(response); const value = await jsonBody(response);
        if (value.ok !== false) throw new ReadinessError('auth_contract', 'Expected explicit application denial for a request without a customer token.');
      }, method === 'PUT' ? '{}' : undefined);
    }
  }
  if (hubRelease.state !== 'blocked') await check(hub, 'foreign_origin_denied', '/api/public/on2go/me', 'GET', { Origin: 'https://unexpected.invalid' }, async (response) => {
    requireStatus(response, 403); requireNoStore(response); const value = await jsonBody(response);
    if (value.ok !== false || response.headers.has('access-control-allow-origin')) throw new ReadinessError('cors_policy', 'A foreign browser origin was not refused.');
  });
  return { ok: checks.every((result) => result.state === 'pass'), scope: 'public_release_and_unauthenticated_contracts', targets: options, checks,
    limitations: ['Authenticated customer saves, persistence and provider order acceptance are not tested.', 'Native Coolify webhook history/configuration requires separate authorized control-plane access.', 'A transport block is not evidence that either public site is down.'] };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await verifyPlatformReadiness(parseOptions(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : result.checks.some((check) => check.state === 'fail') ? 1 : 2;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: 'configuration_error', message: error instanceof Error ? error.message : 'Invalid configuration.' }));
    process.exitCode = 1;
  }
}
