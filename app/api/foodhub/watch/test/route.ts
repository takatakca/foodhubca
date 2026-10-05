import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { channelsStatus, placeCall, postToChat, sendEmail, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// "Test" buttons: { channel: 'sms' | 'call' | 'email' | 'chat' } → sent to the signed-in person.
export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const user = actor.builtin ? null : await getRepo().getUser(actor.username);
  const lang = user?.prefs?.lang ?? 'fr';
  const meta = { purpose: 'test', by: actor.name };
  const channel = String(b.channel || '');
  if (channel === 'chat') return ok({ result: await postToChat({ title: lang === 'fr' ? `Test d’alerte TAKATAK par ${actor.name}` : `TAKATAK alert test by ${actor.name}`, severity: 'info' }, meta), channels: channelsStatus() });
  if (channel === 'sms') {
    if (!user?.phone) return fail('Ajoutez votre cellulaire dans votre profil. / Add your cell number to your profile.');
    return ok({ result: await sendSms({ to: user.phone, body: lang === 'fr' ? 'TAKATAK : test d’alerte réussi. Vous recevrez les alertes ici.' : 'TAKATAK: alert test OK. Alerts will come here.' }, meta) });
  }
  if (channel === 'call') {
    if (!user?.phone) return fail('Ajoutez votre cellulaire dans votre profil. / Add your cell number to your profile.');
    return ok({ result: await placeCall({ to: user.phone, say: lang === 'fr' ? 'Ceci est un test des alertes TAKATAK. Tout fonctionne.' : 'This is a TAKATAK alert test. Everything works.', lang }, meta) });
  }
  if (channel === 'email') {
    if (!user?.email) return fail('Ajoutez votre courriel dans votre profil. / Add your email to your profile.');
    return ok({ result: await sendEmail({ to: user.email, subject: 'TAKATAK — test', text: lang === 'fr' ? 'Test d’alerte réussi.' : 'Alert test OK.' }, meta) });
  }
  return fail('channel must be sms, call, email or chat');
});
