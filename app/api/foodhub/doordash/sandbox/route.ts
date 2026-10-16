import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { doorDashSandboxStatus, isDoorDashTestStore, readSandboxConfig, readSandboxState, writeSandboxConfig } from '@/lib/foodhub/doordash/sandbox';
import {
  clearSandboxTests, pushSandboxMenu, runSandboxOrderAction, setSandboxItem, setSandboxStoreOnline, type SandboxAction,
} from '@/lib/foodhub/doordash/sandbox-ops';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { CANCEL_REASON_LABELS, type CancelReason } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Settings → Platforms → DoorDash sandbox tests (lib/foodhub/doordash/sandbox.ts). GET: the mode, the test store(s), the
// test orders and the test log. POST { action, … }: the DoorDash-facing certification steps on a test order or the test
// store. Same permission as the platform settings page. Nothing here reaches Clover, a printer, a kitchen screen,
// Watchtower or the reports; DoorDash calls are refused for any store that is not a listed test store.
export const GET = withPerm('stores:map', async () => {
  const [state, config, catalog, stores] = await Promise.all([readSandboxState(), readSandboxConfig(), getCatalog(), getRepo().listStores('doordash')]);
  return ok({
    status: doorDashSandboxStatus(process.env, stores), config, orders: state.orders, log: state.log, paused: state.paused, menuIds: state.menuIds,
    brands: catalog.brands.map((b) => b.name), locations: catalog.locations.map((l) => ({ code: l.code, name: l.name })),
  });
});

const ORDER_ACTIONS: SandboxAction[] = ['confirm', 'reject', 'ready', 'cancel'];

export const POST = withPerm('stores:map', async (req) => {
  const b = await readJson(req);
  const action = String(b.action ?? '');
  if ((ORDER_ACTIONS as string[]).includes(action)) {
    const reasonCode = b.reasonCode && Object.prototype.hasOwnProperty.call(CANCEL_REASON_LABELS, String(b.reasonCode)) ? (String(b.reasonCode) as CancelReason) : undefined;
    const out = await runSandboxOrderAction(String(b.orderId ?? ''), action as SandboxAction, { reasonCode, details: typeof b.details === 'string' ? b.details.slice(0, 200) : undefined, by: 'from Food Hub' });
    return out.ok ? ok({ message: out.message, order: out.order ?? null }) : fail(out.message, 409, { order: out.order ?? null });
  }
  if (action === 'config') {
    const patch = {
      ...(typeof b.brandName === 'string' ? { brandName: b.brandName.trim() || undefined } : {}),
      ...(typeof b.locationCode === 'string' ? { locationCode: b.locationCode.trim() || undefined } : {}),
      ...(typeof b.autoConfirm === 'boolean' ? { autoConfirm: b.autoConfirm } : {}),
    };
    return ok({ config: await writeSandboxConfig(patch) });
  }
  if (action === 'clear') { await clearSandboxTests(); return ok({ message: 'Sandbox test list emptied.' }); }
  const storeId = String(b.storeId ?? '').trim();
  // A listed id that is a real (mapped) store is refused too: a real store's menu, items and pause are never driven from here.
  if (!(await isDoorDashTestStore(storeId))) return fail(`${storeId || '(no store)'} is not a DoorDash test store (DOORDASH_SANDBOX_STORE_IDS, never a store mapped in Food Hub).`, 400);
  const out = action === 'push_menu' ? await pushSandboxMenu(storeId)
    : action === 'item' ? await setSandboxItem(storeId, String(b.ref ?? ''), b.available === true, b.kind === 'modifier' ? 'modifier' : 'item')
      : action === 'store' ? await setSandboxStoreOnline(storeId, b.online === true)
        : null;
  if (!out) return fail('Unknown action.', 404);
  return out.ok ? ok({ message: out.message }) : fail(out.message, 409);
});
