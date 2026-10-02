import { describe, expect, it } from 'vitest';
import { missingEnv } from '../lib/backend/connectors/env-utils';
import { listLiveConnectors } from '../lib/backend/connectors/live-registry';

describe('Phase 25 live connector layer', () => {
  it('registers the required platforms', () => {
    const keys = listLiveConnectors().map((connector) => connector.platformKey).sort();
    expect(keys).toEqual(['clover','doordash','skip_the_dishes','too_good_to_go','uber_eats'].sort());
  });

  it('detects missing env values safely', () => {
    expect(missingEnv(['THIS_ENV_DOES_NOT_EXIST_FOR_TEST'])).toEqual(['THIS_ENV_DOES_NOT_EXIST_FOR_TEST']);
  });
});
