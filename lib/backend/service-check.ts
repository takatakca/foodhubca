import { APP_RULES } from '@/lib/config';
import { PlatformStore } from '@/lib/types';

export type ServiceCheckResult = {
  brand_name: string;
  location_code: string;
  service: string;
  status: 'present_active' | 'present_deactivated' | 'present_closed' | 'missing';
  needs_fix: boolean;
  note: string;
};

export function runThreeServiceCheck(stores: PlatformStore[]): ServiceCheckResult[] {
  const groups = new Map<string, PlatformStore[]>();
  for (const store of stores) {
    const key = `${store.brand_name}::${store.location_code}`;
    groups.set(key, [...(groups.get(key) ?? []), store]);
  }

  const results: ServiceCheckResult[] = [];
  for (const [key, group] of groups) {
    const [brand_name, location_code] = key.split('::');
    for (const service of APP_RULES.requiredServices) {
      const found = group.find(s => s.platform === service);
      if (!found) {
        results.push({ brand_name, location_code, service, status: 'missing', needs_fix: true, note: `${service} is missing for this brand/location.` });
      } else if (found.activation_status === 'deactivated') {
        results.push({ brand_name, location_code, service, status: 'present_deactivated', needs_fix: true, note: `${service} store exists but is deactivated.` });
      } else if (found.open_status === 'closed') {
        results.push({ brand_name, location_code, service, status: 'present_closed', needs_fix: false, note: `${service} is active but currently closed.` });
      } else {
        results.push({ brand_name, location_code, service, status: 'present_active', needs_fix: false, note: `${service} looks active.` });
      }
    }
  }
  return results;
}
