import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { callConfigured } from '@/lib/foodhub/notify';
import { phoneAgentConfigured, phoneModel } from '@/lib/foodhub/phone/agent';
import { getPhoneSettings, savePhoneSettings } from '@/lib/foodhub/phone/settings';
import { VOICE_PATH } from '@/lib/foodhub/phone/twilio';
import { ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

function readiness() {
  return {
    ai: phoneAgentConfigured(), model: phoneModel(), twilio: callConfigured(), tokenSet: Boolean(process.env.TWILIO_AUTH_TOKEN),
    voiceUrl: `${publicBaseUrl()}${VOICE_PATH}`, statusUrl: `${publicBaseUrl()}${VOICE_PATH}/status`,
  };
}

// Phone lines (Twilio number → kitchen + brands) and how the agent talks.
export const GET = withPerm('view', async () => ok({ settings: await getPhoneSettings(), readiness: readiness() }));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'phone lines');
  if (gate) return gate;
  const b = await readJson(req);
  return ok({ settings: await savePhoneSettings(b.settings ?? {}, actor), readiness: readiness() });
});
