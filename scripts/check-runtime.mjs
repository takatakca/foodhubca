// Docker HEALTHCHECK and isolated final-image probe. Never reads or prints credentials.
import { verifyLiveDeployment } from './verify-live.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--build-smoke')) throw new Error('Unexpected runtime check option');
  const buildSmoke = args[0] === '--build-smoke';
  if (buildSmoke && (process.env.FOODHUB_FORCE_MEMORY !== 'true' ||
      process.env.LIVE_CONNECTORS_GLOBAL_ENABLED !== 'false' || process.env.FOODHUB_INTERNAL_SYNC_MIN !== '0')) {
    throw new Error('Build smoke requires isolated memory mode with live connectors and sync disabled');
  }
  const sha = process.env.FOODHUB_RELEASE_SHA || '';
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Runtime requires a full source commit');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid runtime port');
  const report = await verifyLiveDeployment({ url: `http://127.0.0.1:${port}/`, sha, allowLoopback: true, buildSmoke });
  console.log(`PASS Food Hub ${report.sha}: release, health, public directory, login and protected orders`);
} catch (error) {
  console.error('FAIL Food Hub runtime: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
