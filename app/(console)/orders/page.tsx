import { Suspense } from 'react';
import { OrdersView } from './orders-view';

export default function OrdersPage() {
  return <Suspense><OrdersView /></Suspense>;
}
