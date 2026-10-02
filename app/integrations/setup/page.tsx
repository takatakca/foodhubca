import { redirect } from 'next/navigation';

// Connections are managed in one place now: Food Hub → Channels & Setup (direct, no aggregator).
export default function Page() {
  redirect('/foodhub/channels');
}
