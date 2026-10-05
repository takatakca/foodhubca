import { redirect } from 'next/navigation';

// 1.4.0: nothing is configurable here — connectors and the live switch are on the Go-Live Checklist.
export default function SettingsPage() {
  redirect('/go-live');
}
