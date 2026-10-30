import type { ReactNode } from 'react';
import { SettingsFrame } from './settings-nav';

/** Every Settings page shares the side-nav on wide screens (premium A3: no second or third tab strip). */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
