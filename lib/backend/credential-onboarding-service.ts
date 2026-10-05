import { PlatformKey } from './connectors/live-connector-types';
import { getLiveConnector } from './connectors/live-registry';
import { missingEnv } from './connectors/env-utils';

export type CredentialReadiness = {
  platformKey: PlatformKey;
  requiredSecrets: string[];
  missingSecrets: string[];
  readyForHealthCheck: boolean;
  safeMessage: string;
};

export function inspectCredentialReadiness(platformKey: PlatformKey): CredentialReadiness {
  const connector = getLiveConnector(platformKey);
  const missing = connector.missingCredentials?.() ?? missingEnv(connector.requiredEnv);
  return {
    platformKey,
    requiredSecrets: connector.requiredEnv,
    missingSecrets: missing,
    readyForHealthCheck: missing.length === 0,
    safeMessage: missing.length
      ? `Missing ${missing.length} server-side secret(s). Add them to .env.local or hosting secrets, not chat.`
      : 'Server-side credential variables exist. Run a health check before enabling sync.',
  };
}
