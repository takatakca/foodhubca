import { localSeed } from '@/lib/data/local-seed';
import { createServiceClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { PlatformStore } from '@/lib/types';

export type StoreRow = PlatformStore & { needs_review?: boolean; review_note?: string };

export type StoreDataResult = {
  source: 'supabase' | 'local_seed';
  stores: StoreRow[];
  warning?: string;
};

/**
 * Supabase-first store data with local seed fallback.
 * - When Supabase is configured and platform_stores has rows, those rows are shown.
 *   Nothing in the app writes platform_stores (only supabase/seed.sql does), so either
 *   way this is the seed snapshot from the owner's screenshots. Live store status
 *   (Uber / DoorDash / Skip sync) lives in the Food Hub store repo → Command Center.
 * - Before Supabase is set up (or if the query fails), the captured seed data
 *   is shown, clearly labeled, so the app is never blank and never pretends.
 */
export async function getPlatformStores(): Promise<StoreDataResult> {
  if (!hasSupabaseEnv()) {
    return { source: 'local_seed', stores: localSeed.doordashStores as StoreRow[], warning: 'Supabase is not configured yet. Showing captured seed data.' };
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('platform_stores')
      .select('store_name, address_line_1, city, province, postal_code, activation_status, open_status, status_symbol, needs_review, review_note, external_business_id, external_store_id, brands(name), locations(code), platforms(key)')
      .order('store_name');
    if (error) throw error;
    if (!data || data.length === 0) {
      return { source: 'local_seed', stores: localSeed.doordashStores as StoreRow[], warning: 'Supabase is connected but platform_stores is empty. Run supabase/seed.sql. Showing captured seed data.' };
    }
    const stores: StoreRow[] = data.map((row: any) => ({
      platform: row.platforms?.key ?? 'doordash',
      brand_name: row.brands?.name ?? '',
      location_code: row.locations?.code ?? '',
      store_name: row.store_name,
      address_line_1: row.address_line_1 ?? '',
      city: row.city ?? '',
      province: row.province ?? '',
      postal_code: row.postal_code ?? '',
      activation_status: row.activation_status,
      open_status: row.open_status,
      external_business_id: row.external_business_id,
      external_store_id: row.external_store_id,
      status_symbol: row.status_symbol,
      needs_fix: row.activation_status === 'deactivated',
      ...(row.needs_review ? { needs_review: true, review_note: row.review_note } : {}),
    }));
    return { source: 'supabase', stores };
  } catch (error) {
    return { source: 'local_seed', stores: localSeed.doordashStores as StoreRow[], warning: `Supabase query failed (${String(error instanceof Error ? error.message : error)}). Showing captured seed data.` };
  }
}
