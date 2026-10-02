import { describe, expect, it } from 'vitest';
import { inspectCredentialReadiness } from '../lib/backend/credential-onboarding-service';

describe('final operational release safety', () => {
  it('does not mark a connector ready when required secrets are missing', () => {
    const readiness = inspectCredentialReadiness('clover');
    expect(readiness.requiredSecrets).toContain('CLOVER_ACCESS_TOKEN');
    expect(readiness.readyForHealthCheck).toBe(Boolean(process.env.CLOVER_ACCESS_TOKEN && process.env.CLOVER_MERCHANT_ID && process.env.CLOVER_BASE_URL));
  });
});
