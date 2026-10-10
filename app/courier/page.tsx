import type { Metadata } from 'next';
import { CourierView } from './courier-view';

export const dynamic = 'force-dynamic';
// The personal link's token lives in the #fragment and in this phone's storage only: never in a Referer, never indexed.
export const metadata: Metadata = { title: 'Livreur · Courier', referrer: 'no-referrer', robots: { index: false, follow: false } };

// Page of one of our own couriers (lib/foodhub/delivery/courier-app.ts): his running deliveries and the taps that move them.
export default function CourierPage() {
  return <CourierView />;
}
