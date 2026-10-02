import { LiveConnector, PlatformKey } from './live-connector-types';
import { CloverLiveConnector } from './clover-live';
import { DoorDashLiveConnector } from './doordash-live';
import { UberEatsLiveConnector } from './uber-eats-live';
import { SkipTheDishesLiveConnector } from './skip-live';
import { TooGoodToGoLiveConnector } from './tgtg-live';

const connectors: Record<PlatformKey, LiveConnector> = {
  clover: new CloverLiveConnector(),
  doordash: new DoorDashLiveConnector(),
  uber_eats: new UberEatsLiveConnector(),
  skip_the_dishes: new SkipTheDishesLiveConnector(),
  too_good_to_go: new TooGoodToGoLiveConnector(),
};

export function getLiveConnector(platformKey: PlatformKey): LiveConnector {
  const connector = connectors[platformKey];
  if (!connector) throw new Error(`Unsupported connector: ${platformKey}`);
  return connector;
}

export function listLiveConnectors(): LiveConnector[] {
  return Object.values(connectors);
}

export function parsePlatformKey(value: string): PlatformKey {
  const allowed = Object.keys(connectors);
  if (!allowed.includes(value)) throw new Error(`Unsupported platform: ${value}`);
  return value as PlatformKey;
}
