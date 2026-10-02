import { GenericRestConnector } from './generic-rest';
import { PlatformConnector } from './connector-types';

export function getConnectors(): PlatformConnector[] {
  return [
    new GenericRestConnector({ platform: 'clover', mode: 'oauth', endpointEnv: 'CLOVER_BASE_URL', tokenEnv: 'CLOVER_ACCESS_TOKEN', extraRequired: ['CLOVER_MERCHANT_ID'] }),
    new GenericRestConnector({ platform: 'doordash', mode: 'api_key', endpointEnv: 'DOORDASH_BASE_URL', tokenEnv: 'DOORDASH_SIGNING_SECRET', extraRequired: ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID'] }),
    new GenericRestConnector({ platform: 'uber_eats', mode: 'oauth', endpointEnv: 'UBER_BASE_URL', tokenEnv: 'UBER_ACCESS_TOKEN', extraRequired: ['UBER_CLIENT_ID'] }),
    new GenericRestConnector({ platform: 'skip_the_dishes', mode: 'api_key', endpointEnv: 'SKIP_BASE_URL', tokenEnv: 'SKIP_API_KEY' }),
    new GenericRestConnector({ platform: 'too_good_to_go', mode: 'api_key', endpointEnv: 'TGTG_BASE_URL', tokenEnv: 'TGTG_API_KEY' })
  ];
}

export function getConnector(platform: string): PlatformConnector | undefined {
  return getConnectors().find(c => c.platform === platform);
}
