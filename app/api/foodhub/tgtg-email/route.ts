import { withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { pollTgtgMailbox, pollSeconds } from '@/lib/foodhub/tgtg-email/imap';
import { resolveWaitingForStore, retryTgtgMail } from '@/lib/foodhub/tgtg-email/ingest';
import { allowedSenders } from '@/lib/foodhub/tgtg-email/parse';
import {
  BRANDS, LOCATIONS, dismissMailRecord, getMailboxStatus, getTgtgEmailSettings, listAttention, listMailRecords, removeTgtgMapping, saveTgtgMapping,
  setTgtgEmailEnabled, storeKey, suggestTgtgMapping, tgtgEmailReadiness, type TgtgMailRecord,
} from '@/lib/foodhub/tgtg-email/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** What the screen shows of an e-mail (never its whole body). */
function row(r: TgtgMailRecord) {
  return {
    id: r.id, source: r.source, receivedAt: r.receivedAt, from: r.from, subject: r.subject, status: r.status, reason: r.reason ?? null, orderId: r.orderId ?? null,
    brandName: r.brandName ?? null, locationCode: r.locationCode ?? null, dismissedAt: r.dismissedAt ?? null,
    parsed: r.parse ? { kind: r.parse.kind, code: r.parse.code ?? null, firstName: r.parse.firstName ?? null, quantity: r.parse.quantity ?? null, bagName: r.parse.bagName ?? null, pricePaid: r.parse.pricePaid ?? null, pickupLabel: r.parse.pickupLabel ?? null, storeName: r.parse.storeName ?? null, warnings: r.parse.warnings, problems: r.parse.problems } : null,
  };
}

// Settings → Platforms → Too Good To Go e-mails: switch, mailbox status, store-name mapping, last e-mails, attention list.
export const GET = withPerm('stores:map', async () => {
  const settings = await getTgtgEmailSettings();
  const recent = await listMailRecords(30);
  const attention = await listAttention(30);
  const mapped = new Set(settings.mappings.map((m) => storeKey(m.storeName)));
  // Store names seen in e-mails that nobody mapped yet, with a suggestion (the owner confirms).
  const unmapped = [...new Map([...attention, ...recent].filter((r) => r.parse?.storeName && !mapped.has(storeKey(r.parse.storeName)))
    .map((r) => [storeKey(r.parse!.storeName!), { storeName: r.parse!.storeName!, ...suggestTgtgMapping(r.parse!.storeName!, r.parse!.storeAddress ?? '') }])).values()];
  const merchants = [...new Set((await getRepo().listStores()).map((s) => s.cloverMerchantId).filter(Boolean))] as string[];
  return ok({
    readiness: tgtgEmailReadiness(),
    webhookUrl: `${publicBaseUrl()}/api/foodhub/webhooks/tgtg-email`,
    allowedSenders: allowedSenders(),
    pollSeconds: pollSeconds(),
    settings,
    mailbox: await getMailboxStatus(),
    recent: recent.map(row),
    attention: attention.map(row),
    unmapped,
    brands: BRANDS,
    locations: LOCATIONS.map((l) => ({ code: l.code, name: l.name, address: l.address_line_1 })),
    merchants,
  });
});

// { action: 'toggle', enabled } | { action: 'map', storeName, brandName, locationCode, cloverMerchantId? } | { action: 'unmap', storeName }
// | { action: 'poll' } | { action: 'retry', id } | { action: 'dismiss', id }
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const action = String(b.action || '');
  try {
    if (action === 'toggle') return ok({ settings: await setTgtgEmailEnabled(Boolean(b.enabled), actor) });
    if (action === 'map') {
      const r = await saveTgtgMapping({ storeName: String(b.storeName || ''), brandName: String(b.brandName || ''), locationCode: String(b.locationCode || ''), cloverMerchantId: b.cloverMerchantId ? String(b.cloverMerchantId) : null }, actor);
      const resolved = await resolveWaitingForStore(r.mapping.storeName);
      return ok({ mapping: r.mapping, resolved });
    }
    if (action === 'unmap') { await removeTgtgMapping(String(b.storeName || ''), actor); return ok({}); }
    if (action === 'poll') {
      if (!tgtgEmailReadiness().imapConfigured) return fail('No mailbox configured (TGTG_IMAP_HOST, TGTG_IMAP_USER, TGTG_IMAP_PASSWORD).');
      return ok({ poll: await pollTgtgMailbox() });
    }
    if (action === 'retry') return ok({ result: await retryTgtgMail(String(b.id || ''), actor) });
    if (action === 'dismiss') {
      const r = await dismissMailRecord(String(b.id || ''), actor);
      return r ? ok({}) : fail('E-mail not found.', 404);
    }
    return fail('Unknown action.');
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
