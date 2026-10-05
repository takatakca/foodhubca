import { Suspense } from 'react';
import { MappingView } from './mapping-view';

export default function MappingPage() {
  return <Suspense><MappingView /></Suspense>;
}
