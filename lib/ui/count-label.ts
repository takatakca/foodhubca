/**
 * Counted words without "(s)" (premium A4 #12): « 1 magasin », « 3 magasins ». French keeps the singular for 0 and 1,
 * English only for 1. `many` defaults to the word + "s"; pass it for the others (« nouveau » → « nouveaux »).
 * A missing count reads as 0.
 */
type Count = number | null | undefined;
export const frWord = (n: Count, one: string, many = `${one}s`) => (Math.abs(n ?? 0) < 2 ? one : many);
export const enWord = (n: Count, one: string, many = `${one}s`) => (Math.abs(n ?? 0) === 1 ? one : many);
export const countFr = (n: Count, one: string, many?: string) => `${n ?? 0} ${frWord(n, one, many)}`;
export const countEn = (n: Count, one: string, many?: string) => `${n ?? 0} ${enWord(n, one, many)}`;
