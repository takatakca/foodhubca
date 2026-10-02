import CommandCenter from './command-center';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'TAKATAK Command Center' };

// One screen for the whole business: orders from every app, sales, Clover, store status, alerts.
export default function HomePage() {
  return <CommandCenter />;
}
