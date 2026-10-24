// "Printed once": the first ticket that prints a Revenu Québec document claims it; every later ticket shows that the
// document was printed and points to « Réimprimer (RPR) » (lib/foodhub/mev/printable.ts explains the rule).
// The claim lives apart from the order document (KV), so a writer holding an older copy of the order cannot erase it.
import crypto from 'node:crypto';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import { sha256 } from './map';
import { printableDoc, type PrintCopy } from './printable';
import type { MevRecord } from './types';

const KV = (docKey: string) => `mev_printed:${sha256(docKey).slice(0, 40)}`;
interface Claim { at: string; by: string; nonce: string }

export type ClaimResult = { granted: true; key: string; at: string } | { granted: false; key: string | null; at?: string; by?: string; reason: 'printed' | 'nothing_to_print' };

/** Claims one document for printing. Two tickets racing: the re-read after a short pause decides one winner. */
export async function claimDocument(docKey: string, by: string, pauseMs = 120): Promise<ClaimResult> {
  const repo = getRepo();
  const prev = await repo.getKv<Claim>(KV(docKey)).catch(() => null);
  if (prev) return { granted: false, key: docKey, at: prev.at, by: prev.by, reason: 'printed' };
  const mine: Claim = { at: nowIso(), by: by.slice(0, 80), nonce: crypto.randomUUID() };
  await repo.setKv(KV(docKey), mine);
  if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  const again = await repo.getKv<Claim>(KV(docKey)).catch(() => null);
  if (again?.nonce === mine.nonce) return { granted: true, key: docKey, at: mine.at };
  return { granted: false, key: docKey, at: again?.at ?? mine.at, by: again?.by, reason: 'printed' };
}

/** The ticket of an order asks to print its original (FAC) or its newest RPR / DUP. */
export async function claimOrderPrint(mev: MevRecord | null | undefined, copy: PrintCopy, by: string): Promise<ClaimResult> {
  const doc = printableDoc(mev, copy);
  if (!doc) return { granted: false, key: null, reason: 'nothing_to_print' };
  return claimDocument(doc.key, by);
}

/** Has this document been printed? (KV: the authority.) */
export async function documentPrinted(docKey: string): Promise<{ at: string; by: string } | null> {
  const c = await getRepo().getKv<Claim>(KV(docKey)).catch(() => null);
  return c ? { at: c.at, by: c.by } : null;
}
