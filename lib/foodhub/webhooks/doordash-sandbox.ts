// DoorDash SANDBOX webhooks (doordash/sandbox.ts says which ones): processed into the "DoorDash sandbox tests" list only.
// Same classification and same HTTP answers as real traffic (classifyDoorDash: 202 for Order Create, 200 otherwise), and
// the same DoorDash calls back (doordash/sandbox-ops.ts) — but no order row, no Clover, no ticket, no kitchen ring, no
// Watchtower alert, no activity-feed line, nothing in money or reports. Never throws: a test never sits in the inbox as
// a failure.
import { doorDashCourierStatus } from '../courier';
import { isProtectedDoorDashId } from '../doordash/guard';
import { addSandboxEvent, addSandboxLog, findSandboxOrder, payloadOrderRefs, payloadStoreIds, rememberSandboxOrderIds, type SandboxOrder } from '../doordash/sandbox';
import { autoConfirmSandboxOrder, recordSandboxOrder, updateSandboxState } from '../doordash/sandbox-ops';
import { menuCallbackOutcome } from '../ops';
import { adjustedLines, classifyDoorDash, flattenDelivery } from './doordash';
import { parseDoorDashOrder } from '../adapters/doordash';
import { nowIso } from '../config';
import type { HandlerOutcome } from './uber';

const tag = (o: Pick<SandboxOrder, 'displayId' | 'id'>) => `#${o.displayId || o.id.slice(0, 8)}`;

export async function handleDoorDashSandboxWebhook(raw: any, reason: string): Promise<HandlerOutcome> {
  try {
    return await handle(raw, reason);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await updateSandboxState((s) => addSandboxLog(s, { kind: 'error', text: `Sandbox webhook not processed: ${msg}`, ok: false })).catch(() => undefined);
    return { result: `sandbox test: not processed (${msg})` };
  }
}

async function handle(raw: any, reason: string): Promise<HandlerOutcome> {
  const body = flattenDelivery(raw);
  const c = classifyDoorDash(raw);
  // Po Poulet NDG (and every locked store) is never touched, not even by a sandbox test: nothing is answered or sent.
  const protectedId = payloadStoreIds(body).find((id) => isProtectedDoorDashId(id));
  if (protectedId) {
    await updateSandboxState((s) => addSandboxLog(s, { kind: 'ignored', text: `Sandbox ${c.kind} webhook names protected store ${protectedId} — ignored, nothing sent.`, ok: false, storeId: protectedId }));
    return { result: 'sandbox test: ignored (protected store)' };
  }
  const { doordashId, clientOrderId } = payloadOrderRefs(body);
  // Every order this sandbox webhook is about joins the permanent sandbox id set: later events about it (and Replays)
  // stay tests whatever the env says by then.
  if (c.kind === 'cancel' || c.kind === 'dasher' || c.kind === 'release' || c.kind === 'adjustment') await rememberSandboxOrderIds(doordashId, clientOrderId);

  if (c.kind === 'order') {
    const { order, duplicate, cancelledBefore } = await recordSandboxOrder(c.order!, reason);
    if (duplicate) return { result: 'sandbox test order: duplicate (already received)' };
    if (cancelledBefore) return { result: 'sandbox test order: cancelled before it arrived — not confirmed' };
    const confirmed = await autoConfirmSandboxOrder(order);
    return { result: `sandbox test order received — not sent to Clover${confirmed ? `; ${confirmed.message}` : '; waiting for Confirm / Reject in DoorDash sandbox tests'}` };
  }

  if (c.kind === 'cancel') {
    const why = String(body.cancel_reason || body.cancellation_reason || c.eventType || 'cancelled by DoorDash');
    const out = await updateSandboxState((s) => {
      let o = findSandboxOrder(s, doordashId, clientOrderId);
      if (!o) {
        // Arrived before the order: kept, so the order is never confirmed when it lands.
        const at = nowIso();
        o = { id: doordashId || clientOrderId, clientOrderId: clientOrderId || '', storeId: String(body?.store?.merchant_supplied_id ?? ''), reason, status: 'cancelled', placeholder: true, receivedAt: at, updatedAt: at, events: [] };
        s.orders = [o, ...s.orders];
      }
      o.status = 'cancelled';
      addSandboxEvent(o, `DoorDash cancelled the test order (${why}).`);
      addSandboxLog(s, { kind: 'cancel', text: `DoorDash cancelled test order ${tag(o)}`, storeId: o.storeId || null });
      return o;
    });
    return { result: `sandbox test order ${tag(out)}: cancellation applied` };
  }

  if (c.kind === 'dasher' || c.kind === 'release' || c.kind === 'adjustment') {
    const updated = c.kind === 'adjustment' ? parseDoorDashOrder(body.order ?? body) : null;
    const id = c.kind === 'adjustment' ? (updated?.externalOrderId ?? doordashId) : doordashId;
    const text = c.kind === 'dasher' ? `Dasher: ${c.courierStatus}${body?.dasher?.first_name ? ` (${String(body.dasher.first_name)})` : ''}`
      : c.kind === 'release' ? 'DoorDash released the order: the Dasher is near (start preparing).'
        : `DoorDash adjusted the order${updated ? ` — new subtotal ${updated.subtotal.toFixed(2)}, tax ${updated.tax.toFixed(2)}` : ''}.`;
    const out = await updateSandboxState((s) => {
      const o = findSandboxOrder(s, id, clientOrderId);
      if (!o) { addSandboxLog(s, { kind: c.kind, text: `${text} — for a test order Food Hub does not hold (${id || clientOrderId || 'no id'})` }); return null; }
      if (c.kind === 'dasher') o.courier = c.courierStatus ?? doorDashCourierStatus(String(body?.dasher_status ?? '')) ?? o.courier;
      if (c.kind === 'release') o.courier = 'arriving';
      if (updated && o.order) o.order = { ...o.order, lines: adjustedLines(o.order.lines, updated.lines), subtotal: updated.subtotal, tax: updated.tax, total: updated.total };
      addSandboxEvent(o, text);
      return o;
    });
    return { result: out ? `sandbox test order ${tag(out)}: ${c.kind}` : `sandbox ${c.kind}: unknown test order (kept in the log)` };
  }

  if (c.kind === 'menu_status') {
    const outcome = menuCallbackOutcome(body);
    const menuId = body.menu?.id || body.menu_id;
    const details = String(body.event?.details ?? body.details ?? '').trim();
    const storeId = payloadStoreIds(body)[0] ?? null;
    const text = `Menu Status from DoorDash: ${outcome ?? 'no explicit result'}${menuId ? ` (menu id ${String(menuId)})` : ''}${details ? ` — ${details.slice(0, 300)}` : ''}`;
    await updateSandboxState((s) => {
      // As for a real store: DoorDash's menu id is kept so the next push updates that menu (PATCH).
      if (storeId && menuId) s.menuIds = { ...s.menuIds, [storeId]: String(menuId) };
      addSandboxLog(s, { kind: 'menu_status', text, ok: outcome === null ? undefined : outcome === 'success', storeId });
    });
    return { result: `sandbox menu status: ${outcome ?? 'noted'}` };
  }

  // Store deactivated, onboarding, report ready, anything else: written in the test log only.
  const storeId = payloadStoreIds(body)[0] ?? null;
  const what = c.kind === 'store_deactivated' ? `DoorDash paused the test store: ${String(body?.event?.reason ?? body?.reason ?? '')}`
    : c.kind === 'onboarding' ? `Onboarding status: ${String(body?.status ?? '')}${body?.exclusion_code ? ` (${String(body.exclusion_code)})` : ''}`
      : c.kind === 'report_ready' ? `Report ready: ${String(body?.report_id ?? '')} ${String(body?.status ?? '')}`
        : `Webhook ${c.eventType || c.kind} received (not an order Food Hub reads)`;
  await updateSandboxState((s) => addSandboxLog(s, { kind: c.kind, text: what.trim(), storeId }));
  return { result: `sandbox ${c.kind}: noted in the test log` };
}
