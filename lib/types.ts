export type PlatformKey = 'clover' | 'doordash' | 'uber_eats' | 'skip_the_dishes' | 'too_good_to_go';
export type ActivationStatus = 'active' | 'deactivated';
export type OpenStatus = 'open' | 'closed' | 'unknown';
export type ReviewStatus = 'new' | 'needs_review' | 'approved' | 'rejected' | 'held';

export type PlatformStore = {
  id?: string;
  platform: PlatformKey;
  brand_name: string;
  location_code: string;
  store_name: string;
  address_line_1: string;
  city: string;
  province: string;
  postal_code: string;
  activation_status: ActivationStatus;
  open_status: OpenStatus;
  external_business_id?: string | null;
  external_store_id?: string | null;
  status_symbol?: string | null;
  needs_fix?: boolean;
};

export type ConnectorHealth = {
  platform: PlatformKey;
  configured: boolean;
  enabled: boolean;
  canFetch: boolean;
  missing: string[];
  message: string;
};

export type IngestEvent = {
  platform: PlatformKey;
  entityType: string;
  externalId: string;
  payload: Record<string, unknown>;
  receivedAt?: string;
};
