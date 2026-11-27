// Read-only verification of a deployed Food Hub instance. No credentials or order writes.
// Usage: npm run verify:live -- --url https://foodhub.on2go.ca/ --sha <40-char-commit>
// A missing expected commit is a failure: merely seeing *any* release marker is NOT deployment proof.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import releaseProbe from '../lib/foodhub/release-probe.json' with { type: 'json' };

export function parseOptions(argv, env = process.env) {
  let url = env.FOODHUB_HTTPS_URL || '';
  let sha = env.EXPECTED_SHA || '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url' && argv[i + 1]) url = argv[++i];
    else if (argv[i] === '--sha' && argv[i + 1]) sha = argv[++i];
    else throw new Error('Usage: npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_COMMIT_SHA');
  }
  return { url, sha };
}

function requireStatus(response, expected, path) {
  if (response.status !== expected) {
    throw new Error(path + ' returned HTTP ' + response.status + ', expected ' + expected);
  }
}

async function readJson(response, path) {
  try {
    return await response.json();
  } catch {
    throw new Error(path + ' did not return valid JSON');
  }
}

export async function verifyLiveDeployment({ url, sha = '', fetchImpl = fetch, allowLoopback = false, buildSmoke = false }) {
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new Error('Supply a valid production HTTPS URL with --url or FOODHUB_HTTPS_URL');
  }
  // Never send a user-supplied URL with embedded credentials, query params or subpaths.
  const localSmoke = allowLoopback && base.protocol === 'http:' && base.hostname === '127.0.0.1';
  if ((base.protocol !== 'https:' && !localSmoke) || !base.hostname || base.username || base.password ||
      base.search || base.hash || base.pathname !== '/') {
    throw new Error('Production URL must be an HTTPS origin with no credentials, query or subpath');
  }
  // Never report a successful release verification without an expected revision.
  // Both the runtime probe and the operator must pin the full Git commit.
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('Expected SHA is required and must be the full 40-character Git commit');
  }

  const missingIdentity = [];
  const request = async (path, headers = {}) => {
    const requestUrl = new URL(path, base);
    const nonce = randomBytes(16).toString('hex');
    requestUrl.searchParams.set(releaseProbe.query, nonce);
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: 'GET',
        cache: 'no-store',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const cause = error instanceof Error ? error.name : 'network error';
      throw new Error('GET ' + path + ' unreachable (' + cause + ')');
    }
    const responseSha = response.headers.get(releaseProbe.shaHeader);
    const responseNonce = response.headers.get(releaseProbe.nonceHeader);
    if (responseSha !== null && responseSha.toLowerCase() !== sha.toLowerCase()) {
      throw new Error(path + ' returned a different release SHA');
    }
    if (responseNonce !== null && responseNonce !== nonce) {
      throw new Error(path + ' returned a different probe nonce');
    }
    if (responseSha === null || responseNonce === null) missingIdentity.push(path);
    return response;
  };

  const verifyRelease = async () => {
    const response = await request('/api/release');
    requireStatus(response, 200, '/api/release');
    const release = await readJson(response, '/api/release');
    if (release?.app !== 'foodhub' || release.ok !== true ||
        typeof release.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(release.sha)) {
      throw new Error('/api/release did not prove a complete Food Hub commit');
    }
    if (release.sha.toLowerCase() !== sha.toLowerCase()) {
      throw new Error('/api/release is on a different SHA: ' + release.sha.slice(0, 7));
    }
    if (release.probeIdentity !== undefined && release.probeIdentity !== releaseProbe.capability) {
      throw new Error('/api/release advertised an unsupported release identity capability');
    }
    return { sha: release.sha, probeIdentity: release.probeIdentity };
  };
  const firstRelease = await verifyRelease();

  const directoryResponse = await request('/api/public/directory', { Origin: 'https://on2go.ca' });
  requireStatus(directoryResponse, 200, '/api/public/directory');
  if (directoryResponse.headers.get('access-control-allow-origin') !== 'https://on2go.ca') {
    throw new Error('/api/public/directory does not allow the ON2GO origin');
  }
  const directory = await readJson(directoryResponse, '/api/public/directory');
  if (directory.version !== 1 || !Array.isArray(directory.brands) || directory.brands.length === 0 ||
      !Array.isArray(directory.kitchens) || directory.kitchens.length === 0) {
    throw new Error('/api/public/directory has missing or empty brand/kitchen data');
  }

  const healthResponse = await request('/api/health');
  // Only an isolated final-image build probe may lack a database. Production never accepts 503.
  const databaseFreeBuild = localSmoke && buildSmoke && healthResponse.status === 503;
  if (!databaseFreeBuild && healthResponse.status !== 200) {
    const healthBody = await readJson(healthResponse, '/api/health').catch(() => null);
    const checks = healthBody?.checks && typeof healthBody.checks === 'object'
      ? Object.entries(healthBody.checks).map(([name, state]) => name + '=' + state).join(',')
      : '';
    throw new Error('/api/health returned HTTP ' + healthResponse.status + ', expected 200' + (checks ? ' (' + checks + ')' : ''));
  }
  const health = await readJson(healthResponse, '/api/health');
  if (databaseFreeBuild ? health.ok !== false || health.checks?.database !== 'down'
    : health.ok !== true || !health.status || health.status === 'down' || health.checks?.database !== 'ok') {
    throw new Error('/api/health is not healthy');
  }

  const loginResponse = await request('/login');
  requireStatus(loginResponse, 200, '/login');

  // A public 200 here is a release blocker; it can expose merchant orders.
  const privateResponse = await request('/api/foodhub/orders');
  requireStatus(privateResponse, 401, '/api/foodhub/orders');

  // The reverse proxy may switch versions while the other endpoints are being checked.
  const lastRelease = await verifyRelease();
  if (firstRelease.probeIdentity !== lastRelease.probeIdentity) {
    throw new Error('/api/release capability changed during verification');
  }
  const provesEveryResponse = firstRelease.probeIdentity === releaseProbe.capability;
  if (provesEveryResponse && missingIdentity.length) {
    throw new Error(missingIdentity[0] + ' is missing release identity for its probe');
  }

  return {
    sha: firstRelease.sha,
    origin: base.origin,
    checks: [
      provesEveryResponse ? '/api/release: exact deployed SHA for each probe response'
        : '/api/release: exact deployed SHA before and after endpoint checks (marker only)',
      '/api/public/directory: public brands, kitchens and ON2GO CORS',
      '/api/health: healthy',
      '/login: available',
      '/api/foodhub/orders: anonymous access denied',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await verifyLiveDeployment(parseOptions(process.argv.slice(2)));
    for (const check of report.checks) console.log('PASS ' + check);
    console.log('PASS ' + report.origin + ' at commit ' + report.sha);
  } catch (error) {
    console.error('FAIL Food Hub live verification: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
