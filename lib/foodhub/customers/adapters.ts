// Loyalty (LOY4LTY) and gift cards (REW4RDS): adapters keyed by the customer's E.164 phone. Neither app exists yet, so
// both answer truthfully `connected: false` with the reason — the website shows "pas encore" instead of a fake zero.
// FOODHUB_LOYALTY_URL / FOODHUB_GIFTCARDS_URL are read only to say so in the console; nothing is called until the
// apps are built (then each adapter gets its signed client here, same key: the phone).

export type LoyaltyInfo = { connected: false; reason: string } | { connected: true; points: number; tier?: string };
export type GiftCardsInfo = { connected: false; reason: string } | { connected: true; cards: Array<{ last4: string; balance: number }> };

export function loyaltyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.FOODHUB_LOYALTY_URL ?? '').trim());
}

export function giftCardsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.FOODHUB_GIFTCARDS_URL ?? '').trim());
}

export async function loyaltyFor(_phone: string): Promise<LoyaltyInfo> {
  return { connected: false, reason: loyaltyConfigured() ? 'LOY4LTY not connected yet (FOODHUB_LOYALTY_URL is set, the adapter is not built)' : 'LOY4LTY not connected yet' };
}

export async function giftCardsFor(_phone: string): Promise<GiftCardsInfo> {
  return { connected: false, reason: giftCardsConfigured() ? 'REW4RDS not connected yet (FOODHUB_GIFTCARDS_URL is set, the adapter is not built)' : 'REW4RDS not connected yet' };
}
