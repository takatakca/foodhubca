import { liveConnectorsGloballyEnabled, missingEnv, result, CHANNEL_LABELS } from '../config';
import type { ChannelKey, ChannelReadiness, ChannelResult } from '../types';

export function buildReadiness(channel: ChannelKey, required: string[], opts: { specConfirmed?: boolean; note?: string; noteFr?: string; extraMissing?: string[]; extraWebhooks?: Array<{ label: string; path: string }>; handoff?: Array<{ label: string; envKey: string }> } = {}): ChannelReadiness {
  const missing = [...missingEnv(required), ...(opts.extraMissing ?? [])];
  const configured = missing.length === 0;
  const live = liveConnectorsGloballyEnabled();
  const specConfirmed = opts.specConfirmed !== false;
  let note = opts.note ?? '';
  let noteFr = opts.noteFr ?? opts.note ?? '';
  if (!configured) { note = `Missing: ${missing.join(', ')}. ${note}`.trim(); noteFr = `Manquant : ${missing.join(', ')}. ${noteFr}`.trim(); }
  else if (!specConfirmed) { note = note || 'Credentials present, but the partner API spec is not confirmed yet. Outbound calls stay blocked.'; noteFr = noteFr || 'Clés présentes, mais la spécification de l’API du partenaire n’est pas encore confirmée. Les envois restent bloqués.'; }
  else if (!live) { note = 'Credentials present. Set LIVE_CONNECTORS_GLOBAL_ENABLED=true to allow outbound calls.'; noteFr = 'Clés présentes. Mettez LIVE_CONNECTORS_GLOBAL_ENABLED=true pour permettre les envois.'; }
  else { note = note || 'Live.'; noteFr = noteFr || 'En direct.'; }
  return {
    channel,
    label: CHANNEL_LABELS[channel],
    configured,
    canSend: configured && specConfirmed && live,
    missing,
    note,
    noteFr,
    webhookPath: WEBHOOK_PATHS[channel],
    extraWebhooks: opts.extraWebhooks,
    handoff: opts.handoff,
  };
}

export const WEBHOOK_PATHS: Record<ChannelKey, string> = {
  uber_eats: '/api/foodhub/webhooks/uber-eats',
  doordash: '/api/foodhub/webhooks/doordash',
  skip: '/api/foodhub/webhooks/skip/orders',
  tgtg: '/api/foodhub/webhooks/tgtg',
};

export function blockedResult(channel: ChannelKey, readiness: ChannelReadiness): ChannelResult {
  return result(channel, 'blocked', readiness.note || 'Channel not ready for outbound calls.');
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
