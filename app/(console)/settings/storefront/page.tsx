import StorefrontSettings from './storefront-settings';

export const dynamic = 'force-dynamic';

// Settings → "Commander direct" (the ON2GO ordering pages). Opened by its address (/settings/storefront) until a
// settings tab is added by the branch that owns the settings navigation.
export default function StorefrontSettingsPage() {
  return <StorefrontSettings />;
}
