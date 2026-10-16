'use client';

import type { StoredOrder } from '@/lib/foodhub/types';
import { CourierWatch } from './courier-watch';
import { OrderMoney } from './order-money';
import { Quick86 } from './quick-86';

export { KitchenStatus } from './kitchen-status';

/**
 * Kitchen order tools under an order's items: courier watch, "Rupture" (86) from a line, and the order's money
 * (read-only, on demand). Each part hides itself when it has nothing to show or the viewer lacks the permission.
 */
export function OrderTools({ order }: { order: StoredOrder }) {
  return (
    <div className="space-y-2">
      <CourierWatch order={order} />
      <Quick86 order={order} />
      <OrderMoney orderId={order.id} />
    </div>
  );
}
