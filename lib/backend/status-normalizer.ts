import { ActivationStatus, OpenStatus } from '@/lib/types';

export function normalizePlatformStatus(input: {
  storeName?: string | null;
  symbol?: string | null;
  rawStatus?: string | null;
}): { activation_status: ActivationStatus; open_status: OpenStatus; status_reason: string } {
  const storeName = (input.storeName ?? '').toLowerCase();
  const symbol = (input.symbol ?? '').toLowerCase();
  const raw = (input.rawStatus ?? '').toLowerCase();

  if (storeName.includes('(i)') || symbol === 'i' || raw.includes('deactivated') || raw.includes('inactive') || symbol.includes('grey')) {
    return { activation_status: 'deactivated', open_status: 'unknown', status_reason: '(I)/grey/deactivated rule' };
  }

  if (storeName.includes('(z)') || symbol === 'z' || raw.includes('closed')) {
    return { activation_status: 'active', open_status: 'closed', status_reason: '(Z) active but closed rule' };
  }

  return { activation_status: 'active', open_status: 'unknown', status_reason: 'default active rule' };
}
