import { DiscoveredEntity } from './connectors/live-connector-types';

export type PlatformEntityCandidate = {
  platformKey: string;
  entityType: string;
  externalId?: string;
  displayName?: string;
  brandHint?: string;
  locationHint?: string;
  status?: string;
  rawPayload: unknown;
};

export function toPlatformEntityCandidate(entity: DiscoveredEntity): PlatformEntityCandidate {
  return {
    platformKey: entity.platformKey,
    entityType: entity.entityType,
    externalId: entity.externalId,
    displayName: entity.name,
    brandHint: entity.brandHint,
    locationHint: entity.locationHint,
    status: (entity.raw?.status || entity.raw?.activation_status || entity.raw?.state || 'unknown') as string,
    rawPayload: entity.raw,
  };
}

export function summarizePlatformEntities(entities: PlatformEntityCandidate[]) {
  const byType = new Map<string, number>();
  for (const entity of entities) {
    byType.set(entity.entityType, (byType.get(entity.entityType) || 0) + 1);
  }
  return Array.from(byType.entries()).map(([entityType, count]) => ({ entityType, count }));
}
