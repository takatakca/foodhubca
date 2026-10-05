import { Suspense } from 'react';
import { AlertsView } from './alerts-view';

export default function AlertsPage() {
  return <Suspense><AlertsView /></Suspense>;
}
