import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { emailConfigured, maskEmail, maskPhone, smsConfigured } from '@/lib/foodhub/notify';
import { phoneAgentConfigured, phoneModel } from '@/lib/foodhub/phone/agent';
import { getIvrSettings, handoffTarget, ivrNumbers, saveIvrSettings, SAFER_GREETING, voicemailEmailTarget } from '@/lib/foodhub/phone/ivr/config';
import { IVR_PATH } from '@/lib/foodhub/phone/ivr/engine';
import { menuSpeech } from '@/lib/foodhub/phone/ivr/words';
import { getPhoneSettings } from '@/lib/foodhub/phone/settings';
import { ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// ON2GO phone menu settings (Settings → Expansion → AI phone → Menu téléphonique). Numbers and emails are shown masked.
async function readiness() {
  const s = await getIvrSettings();
  const handoff = handoffTarget(s);
  const email = voicemailEmailTarget(s);
  return {
    ai: phoneAgentConfigured(), model: phoneModel(), sms: smsConfigured(), email: emailConfigured(), tokenSet: Boolean(process.env.TWILIO_AUTH_TOKEN),
    numbers: ivrNumbers(s).map(maskPhone), envNumber: Boolean(process.env.FOODHUB_IVR_NUMBER),
    handoff: handoff ? maskPhone(handoff) : null, emailTo: email ? maskEmail(email) : null,
    voiceUrl: `${publicBaseUrl()}${IVR_PATH}`, statusUrl: `${publicBaseUrl()}${IVR_PATH}/status`,
    lines: (await getPhoneSettings()).lines.map((l) => ({ id: l.id, name: l.name, enabled: l.enabled })),
    saferGreeting: SAFER_GREETING,
    preview: { fr: menuSpeech(s.tree, '', 'fr'), en: menuSpeech(s.tree, '', 'en'), es: menuSpeech(s.tree, '', 'es') },
  };
}

export const GET = withPerm('view', async () => ok({ settings: await getIvrSettings(), readiness: await readiness() }));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'ON2GO phone menu');
  if (gate) return gate;
  const b = await readJson(req);
  return ok({ settings: await saveIvrSettings(b.settings ?? {}, actor), readiness: await readiness() });
});
