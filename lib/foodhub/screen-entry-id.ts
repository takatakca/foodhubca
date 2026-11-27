import { createHash } from 'node:crypto';

export const SCREEN_ENTRY_PREFIX = 'screen-';

/** The same displayed order code can belong to two stores on one platform. */
export function screenEntryOrderId(code: string, channelStoreId: string): string {
  const storeRef = createHash('sha256').update(channelStoreId).digest('hex').slice(0, 24);
  return `${SCREEN_ENTRY_PREFIX}${storeRef}:${code}`;
}

/** A safe, stable store reference for Clover's recovery title. Legacy entries have no reference. */
export function screenEntryStoreRef(externalOrderId: string): string | undefined {
  return /^screen-([0-9a-f]{24}):[A-Z0-9-]{3,40}$/.exec(externalOrderId)?.[1];
}
