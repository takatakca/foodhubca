import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import {
  listSkipCollectPoints, registerSkipDaasWebhook, skipDaas, skipDaasNotificationConfig, skipDaasRequestAssistance, skipDaasSimulate, SKIP_ASSISTANCE_REASONS, SKIP_NOTIFICATION_EVENTS, SKIP_SIMULATION_STEPS,
  type SkipNotificationConfig,
} from '@/lib/foodhub/delivery/skip-daas';
import type { ChannelResult } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const reply = (res: ChannelResult, extra: Record<string, unknown> = {}) => (res.ok ? ok({ result: res, ...extra }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res }));

// Skip Delivery (Delivery as a Service) set-up and support calls, beyond the automatic booking:
//   GET                                  readiness, the collect points Skip knows, and the webhook configuration stored at Skip
//   POST { action: "register-webhook" }  store Food Hub's address + SKIP_DAAS_WEBHOOK_SECRET at Skip (all events)
//   POST { action: "webhook-config", config }  create the notification configuration by hand
//   POST { action: "patch-webhook", config }   change part of it
//   POST { action: "delete-webhook" }    remove it
//   POST { action: "assistance", requestId, collectPointId, reason }   ask Skip for help on a running delivery (CA)
//   POST { action: "simulate", requestId, deliveryStep?, stepWaitDuration? }  staging only: walk a test delivery along
export const GET = withPerm('admin', async () => {
  const readiness = skipDaas.readiness();
  const points = readiness.configured ? await listSkipCollectPoints({ fresh: true }).catch(() => null) : null;
  const webhook = readiness.canSend ? await skipDaasNotificationConfig.get() : null;
  return ok({ readiness, collectPoints: points?.points ?? [], collectPointsMessage: points?.message ?? null, webhook: webhook?.ok ? webhook.response : null, events: SKIP_NOTIFICATION_EVENTS, assistanceReasons: SKIP_ASSISTANCE_REASONS, simulationSteps: SKIP_SIMULATION_STEPS });
});

export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const action = String(b.action ?? '');
  let res: ChannelResult;
  switch (action) {
    case 'register-webhook': res = await registerSkipDaasWebhook(); break;
    case 'webhook-config': res = await skipDaasNotificationConfig.create(b.config as SkipNotificationConfig); break;
    case 'patch-webhook': res = await skipDaasNotificationConfig.patch((b.config ?? {}) as Partial<SkipNotificationConfig>); break;
    case 'delete-webhook': res = await skipDaasNotificationConfig.delete(); break;
    case 'assistance': res = await skipDaasRequestAssistance(String(b.requestId ?? ''), String(b.collectPointId ?? ''), String(b.reason ?? '') as (typeof SKIP_ASSISTANCE_REASONS)[number]); break;
    case 'simulate': res = await skipDaasSimulate(String(b.requestId ?? ''), { deliveryStep: b.deliveryStep, stepWaitDuration: b.stepWaitDuration ? Number(b.stepWaitDuration) : undefined }); break;
    default: return fail('action must be register-webhook, webhook-config, patch-webhook, delete-webhook, assistance or simulate');
  }
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: `skip_daas_${action.replace(/-/g, '_')}`, status: res.ok ? 'success' : 'failed', channel: 'skip', summary: `Skip Delivery ${action}: ${res.message}` });
  return reply(res);
});
