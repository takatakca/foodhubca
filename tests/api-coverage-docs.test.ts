// The coverage tables in docs/ must stay true: every operation of the published specifications is listed, and every one that
// the code keeps in a registry is in the table.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JET_LOGISTICS_OPS } from '../lib/foodhub/adapters/jet-logistics';
import { DELIVERECT_OPS } from '../lib/foodhub/adapters/deliverect-api';

const doc = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'docs', name), 'utf8');

/** operationIds of https://uk.api.just-eat.io/docs/openapi.yaml (read 2026-10-09): 60 operations. */
const JET_SPEC_OPERATIONS = [
  'CancelOrderNotification', 'DriverStatusNotification', 'FailedOrderForBackupFlow', 'ItemAvailability', 'PutRestaurantOffline', 'PutRestaurantOnline', 'PutServiceTimes', 'RestaurantTempOfflineStatusChanged', 'SentToPosFailed', 'SentToPosSuccess',
  'authRealmsDaasProtocolOpenidConnectTokenPost', 'deliveryPoolsDeliveryPoolIdAvailabilityRelativeGet', 'deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', 'deliveryPoolsDeliveryPoolIdChangeRiskPost', 'deliveryPoolsDeliveryPoolIdGet',
  'deliveryPoolsDeliveryPoolIdHoursPut', 'deliveryPoolsDeliveryPoolIdOfflineEventsDelete', 'deliveryPoolsDeliveryPoolIdOfflineEventsPost', 'deliveryPoolsDeliveryPoolIdPatch', 'deliveryPoolsDeliveryPoolIdPut',
  'deliveryPoolsDeliveryPoolIdRestaurantsDelete', 'deliveryPoolsDeliveryPoolIdRestaurantsPut', 'deliveryPoolsDeliveryPoolIdStatusGet', 'deliveryPoolsGet', 'deliveryPoolsPost', 'finalFinalPickedOrderPost', 'initialReceiveOrderPost', 'menusPost',
  'orderTimeUpdatedPost', 'ordersBrandSlugOrderIdAmendGet', 'ordersBrandSlugOrderIdAmendPost', 'ordersDeliverystateDriverlocationPut', 'ordersOrderIdDeliverystateAtdeliveryaddressPut', 'ordersOrderIdDeliverystateAtrestaurantPut',
  'ordersOrderIdDeliverystateAtrestaurantetaPut', 'ordersOrderIdDeliverystateDeliveredPut', 'ordersOrderIdDeliverystateDriverassignedPut', 'ordersOrderIdDeliverystateDriverlocationPut', 'ordersOrderIdDeliverystateDriverunassignedPut',
  'ordersOrderIdDeliverystateOnitswayPut', 'ordersOrderIdModificationGet', 'ordersOrderIdModificationPost', 'ordersOrderIdValidationPost', 'partnersLocationsLocationReferenceGoLivePost', 'partnersMarketLocationsOnboardPost',
  'partnersOnboardingSessionIdConfigurationPut', 'restaurantsDriverEtaPut', 'v1DeliveryCancellationRequestPut', 'v1DeliveryCollectPointsGet', 'v1DeliveryEstimatePost', 'v1DeliveryNotificationConfigDelete', 'v1DeliveryNotificationConfigGet',
  'v1DeliveryNotificationConfigPatch', 'v1DeliveryNotificationConfigPost', 'v1DeliveryPost', 'v1DeliveryRequestAssistancePost', 'v1DeliverySimulatePost', 'v1DeliveryStatusRequestIdGet', 'yourNotificationEndpointPost', 'yourOnboardingNotificationEndpointPost',
];

describe('docs/SKIP_API_COVERAGE.md', () => {
  const skip = doc('SKIP_API_COVERAGE.md');
  it('lists every one of the 60 operations of the published specification, each with its code and tests', () => {
    expect(JET_SPEC_OPERATIONS).toHaveLength(60);
    expect(new Set(JET_SPEC_OPERATIONS).size).toBe(60);
    for (const id of JET_SPEC_OPERATIONS) expect(skip, id).toContain(`(\`${id}\`)`);
    const rows = skip.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(60);
    expect(rows.every((r) => !/\| (missing|todo|n\/a) \|/i.test(r))).toBe(true);
  });
  it('the delivery-pool / delivery-state registry is exactly the 24 operations of the table', () => {
    for (const op of JET_LOGISTICS_OPS) expect(JET_SPEC_OPERATIONS).toContain(op.id);
    expect(JET_LOGISTICS_OPS).toHaveLength(24);
  });
});

describe('docs/TGTG_API_COVERAGE.md', () => {
  const tgtg = doc('TGTG_API_COVERAGE.md');
  it('says plainly that Too Good To Go has no public API, and names the official route', () => {
    expect(tgtg).toMatch(/publishes no public API/);
    expect(tgtg).toMatch(/Deliverect/);
  });
  it('lists every Deliverect operation of the registry', () => {
    expect(DELIVERECT_OPS).toHaveLength(29);
    for (const op of DELIVERECT_OPS) expect(tgtg, op.id).toContain(op.path.replace(/\{[^}]+\}/g, (m) => m));
  });
});
