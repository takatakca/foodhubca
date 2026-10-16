'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, PhoneCall, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { PhoneLine, PhoneLineKitchen, PhoneSettings } from '@/lib/foodhub/phone/settings';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { SPEECH_MODELS, voicesFor, type VoiceOption } from '@/lib/foodhub/phone/voices';
import { Section } from '../../settings-ui';
import { CopyValue, ExpansionHead } from '../expansion-ui';
import { CallSimulatorPanel, PhoneReadinessPanel } from './phone-tools';

const voiceLabel = (v: VoiceOption) => `${v.label} · ${v.gender === 'female' ? '♀' : '♂'}${v.tier === 'generative' ? ' · generative' : ''}`;

type Readiness = { ai: boolean; model: string; twilio: boolean; tokenSet: boolean; voiceUrl: string; statusUrl: string };
type Draft = Omit<PhoneLine, 'id'> & { id?: string };

/** The kitchens of a line (brand@kitchen groups); a one-kitchen line is one group. Same rule as lineKitchens() on the server. */
const kitchensOf = (l: Pick<PhoneLine, 'locationCode' | 'brands' | 'kitchens'>): PhoneLineKitchen[] => (l.kitchens?.length ? l.kitchens : [{ locationCode: l.locationCode, brands: l.brands }]);

export default function PhoneSettingsPage() {
  const { t } = useI18n();
  const { can, locations, brands } = useViewer();
  const toast = useToast();
  const [s, setS] = useState<PhoneSettings | null>(null);
  const [lines, setLines] = useState<Draft[]>([]);
  const [r, setR] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = can('admin');

  const load = useCallback(() => api<{ settings: PhoneSettings; readiness: Readiness }>('/api/foodhub/phone').then((d) => { setS(d.settings); setLines(d.settings.lines); setR(d.readiness); }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);
  const setLine = (i: number, p: Partial<Draft>) => setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  // Kitchens are always edited as a list; the server folds a one-kitchen list back into locationCode + brands.
  const setKitchens = (i: number, ks: PhoneLineKitchen[]) => setLine(i, { kitchens: ks, locationCode: ks[0]?.locationCode ?? '', brands: [...new Set(ks.flatMap((k) => k.brands))] });

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const d = await api<{ settings: PhoneSettings; readiness: Readiness }>('/api/foodhub/phone', { method: 'PUT', json: { settings: { ...s, lines } } });
      setS(d.settings); setLines(d.settings.lines); toast.success(t('Lignes enregistrées', 'Lines saved'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <ExpansionHead title={t('Commandes par téléphone (IA)', 'AI phone ordering')}
        intro={t('Chaque numéro Twilio = une ou plusieurs cuisines et leurs marques (avec plusieurs cuisines, l’agent demande d’abord quel restaurant). L’agent annonce qu’il est un assistant virtuel, prend la commande dans le menu en direct, confirme le total, l’envoie à Clover et texte la confirmation. Il transfère à un humain sur demande.', 'Each Twilio number = one or more kitchens and their brands (with several kitchens, the agent first asks which restaurant). The agent says it is a virtual assistant, takes the order from the live menu, confirms the total, sends it to Clover and texts the confirmation. It hands off to a person on request.')}
        right={owner && s ? <Button icon={<Save className="size-4" />} loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      {!s || !r ? <Skeleton className="h-96" /> : (
        <div className="max-w-5xl">
          <Section icon={<Bot className="size-5" />} title={t('Ce qu’il faut', 'What it needs')}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Ready ok={r.ai} label={r.ai ? `Claude · ${r.model}` : t('ANTHROPIC_API_KEY manquante', 'ANTHROPIC_API_KEY missing')} />
              <Ready ok={r.twilio} label={r.twilio ? t('Twilio branché', 'Twilio connected') : t('Twilio : TWILIO_ACCOUNT_SID, _AUTH_TOKEN, _FROM', 'Twilio: TWILIO_ACCOUNT_SID, _AUTH_TOKEN, _FROM')} />
              <Ready ok={lines.some((l) => l.enabled)} label={t(`${lines.filter((l) => l.enabled).length} ligne(s) active(s)`, `${lines.filter((l) => l.enabled).length} line(s) on`)} />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <CopyValue label={t('Twilio → numéro → « A call comes in » (Webhook, POST)', 'Twilio → number → "A call comes in" (Webhook, POST)')} value={r.voiceUrl} />
              <CopyValue label={t('Twilio → numéro → « Call status changes »', 'Twilio → number → "Call status changes"')} value={r.statusUrl} />
            </div>
            <p className="mt-2 text-xs text-ink-3">{t('Chaque requête de Twilio est vérifiée avec TWILIO_AUTH_TOKEN. Sans clé IA, ou interrupteur éteint, l’appel est transféré directement à la cuisine : aucun appel perdu.', 'Every Twilio request is verified with TWILIO_AUTH_TOKEN. Without an AI key, or with the switch off, the call goes straight to the kitchen: no call is lost.')}</p>
          </Section>

          <Section icon={<PhoneCall className="size-5" />} title={t('Lignes', 'Lines')}
            right={owner ? <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setLines((l) => [...l, { number: '', name: brands[0] ?? '', locationCode: locations[0]?.code ?? '', brands: brands.slice(0, 1), enabled: true, delivery: false }])}>{t('Ajouter une ligne', 'Add a line')}</Button> : undefined}>
            {!lines.length && <Banner tone="info">{t('Aucune ligne. Achetez un numéro local (514/438) dans Twilio, puis ajoutez-le ici.', 'No line yet. Buy a local number (514/438) in Twilio, then add it here.')}</Banner>}
            <div className="space-y-3">
              {lines.map((l, i) => (
                <fieldset key={l.id ?? `new-${i}`} disabled={!owner} className="rounded-md border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold">{l.name || t('Nouvelle ligne', 'New line')}{!l.id && <Badge tone="info">{t('non enregistrée', 'not saved')}</Badge>}</div>
                    <div className="flex items-center gap-3"><Switch checked={l.enabled} onChange={(v) => setLine(i, { enabled: v })} label={t('Active', 'On')} /><IconButton label={t('Retirer', 'Remove')} size="sm" onClick={() => setLines((x) => x.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></IconButton></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label={t('Numéro Twilio', 'Twilio number')}><Input type="tel" value={l.number} onChange={(e) => setLine(i, { number: e.target.value })} placeholder="+15145550199" /></Field>
                    <Field label={t('Nom dit au téléphone', 'Name said on the phone')}><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Po Poulet, Notre-Dame-de-Grâce" /></Field>
                    <Field label={t('Transfert à (vide = téléphone de la cuisine)', 'Hand-off to (empty = kitchen phone)')}><Input type="tel" value={l.handoffNumber ?? ''} onChange={(e) => setLine(i, { handoffNumber: e.target.value || undefined })} /></Field>
                    <div className="flex items-end sm:col-span-2"><Switch checked={l.delivery} onChange={(v) => setLine(i, { delivery: v })} label={t('Offrir la livraison (DoorDash Drive)', 'Offer delivery (DoorDash Drive)')} description={t('Payée par le lien Clover texté quand il est configuré ; sinon un membre de l’équipe rappelle pour le paiement avant l’envoi du livreur.', 'Paid by the texted Clover link when it is set up; otherwise a team member calls back for the payment before the courier is sent.')} /></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {kitchensOf(l).map((k, ki, ks) => (
                      <div key={ki} className="rounded-md bg-sunken p-3">
                        <div className="mb-2 flex items-end gap-2">
                          <Field label={ks.length > 1 ? t(`Cuisine ${ki + 1}`, `Kitchen ${ki + 1}`) : t('Cuisine', 'Kitchen')}><Select value={k.locationCode} onChange={(e) => setKitchens(i, ks.map((x, xi) => (xi === ki ? { ...x, locationCode: e.target.value } : x)))}>{locations.map((x) => <option key={x.code} value={x.code} disabled={x.code !== k.locationCode && ks.some((y) => y.locationCode === x.code)}>{x.name}</option>)}</Select></Field>
                          {ks.length > 1 && <IconButton label={t('Retirer cette cuisine', 'Remove this kitchen')} size="sm" onClick={() => setKitchens(i, ks.filter((_, xi) => xi !== ki))}><Trash2 className="size-4" /></IconButton>}
                        </div>
                        <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Marques vendues depuis cette cuisine sur ce numéro', 'Brands sold from this kitchen on this number')}</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">{brands.map((b) => <Checkbox key={b} checked={k.brands.includes(b)} label={b} onChange={(v) => setKitchens(i, ks.map((x, xi) => (xi === ki ? { ...x, brands: v ? [...x.brands, b] : x.brands.filter((y) => y !== b) } : x)))} />)}</div>
                      </div>
                    ))}
                    {owner && kitchensOf(l).length < locations.length && (
                      <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => { const ks = kitchensOf(l); const next = locations.find((x) => !ks.some((y) => y.locationCode === x.code)); if (next) setKitchens(i, [...ks, { locationCode: next.code, brands: [] }]); }}>{t('Ajouter une cuisine sur ce numéro', 'Add a kitchen on this number')}</Button>
                    )}
                    {kitchensOf(l).length > 1 && <p className="text-xs text-ink-3">{t('Plusieurs cuisines : l’agent demande au client quel restaurant il veut (ou le déduit de la marque demandée), puis prend la commande dans le menu de cette cuisine. Le ticket Clover part à cette cuisine.', 'Several kitchens: the agent asks the caller which restaurant (or deduces it from the brand asked for), then takes the order from that kitchen’s menu. The Clover ticket goes to that kitchen.')}</p>}
                  </div>
                </fieldset>
              ))}
            </div>
          </Section>

          <Section title={t('Voix et comportement', 'Voice and behaviour')}
            subtitle={t('Français québécois (comprend aussi le français de France), anglais (Canada / États-Unis), espagnol latino-américain (Mexique, Cuba).', 'Québec French (also understands France French), English (Canada / US), Latin-American Spanish (Mexico, Cuba).')}>
            <fieldset disabled={!owner} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('Voix française (fr-CA)', 'French voice (fr-CA)')}><Select value={s.voiceFr} onChange={(e) => setS({ ...s, voiceFr: e.target.value })}>{voicesFor('fr').map((x) => <option key={x.id} value={x.id}>{voiceLabel(x)}</option>)}</Select></Field>
              <Field label={t('Voix anglaise (en-US)', 'English voice (en-US)')}><Select value={s.voiceEn} onChange={(e) => setS({ ...s, voiceEn: e.target.value })}>{voicesFor('en').map((x) => <option key={x.id} value={x.id}>{voiceLabel(x)}</option>)}</Select></Field>
              <Field label={t('Voix espagnole (es-US / es-MX)', 'Spanish voice (es-US / es-MX)')}><Select value={s.voiceEs} onChange={(e) => setS({ ...s, voiceEs: e.target.value })}>{voicesFor('es').map((x) => <option key={x.id} value={x.id}>{voiceLabel(x)}</option>)}</Select></Field>
              <Field label={t('Silence de fin de phrase (s)', 'End-of-sentence silence (s)')}><Select value={String(s.speechTimeout)} onChange={(e) => setS({ ...s, speechTimeout: Number(e.target.value) })}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
              <Field label={t('Prénom de l’assistant (facultatif)', 'Assistant’s first name (optional)')}><Input value={s.persona?.name ?? ''} maxLength={30} onChange={(e) => setS({ ...s, persona: { ...(s.persona ?? { name: '', gender: 'female' }), name: e.target.value } })} placeholder="Léa" /></Field>
              <Field label={t('Reconnaissance (conversation)', 'Recognition (conversation)')}><Select value={s.speechModel} onChange={(e) => setS({ ...s, speechModel: e.target.value })}>{SPEECH_MODELS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
              <Field label={t('Reconnaissance (réponses courtes)', 'Recognition (short answers)')}><Select value={s.speechModelShort} onChange={(e) => setS({ ...s, speechModelShort: e.target.value })}>{SPEECH_MODELS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
              <Field label={t('Tours max avant transfert', 'Max turns before hand-off')}><Input inputMode="numeric" value={s.maxTurns} onChange={(e) => setS({ ...s, maxTurns: Number(e.target.value) || 40 })} /></Field>
              <div className="sm:col-span-2"><Switch checked={s.smsConfirmation} onChange={(v) => setS({ ...s, smsConfirmation: v })} label={t('Texter la confirmation (numéro, total, heure)', 'Text the confirmation (number, total, time)')} /></div>
              <div className="sm:col-span-2"><Switch checked={s.greetingMulti} onChange={(v) => setS({ ...s, greetingMulti: v })} label={t('Accueil ON2GO : écouter les trois langues à la fois (Deepgram)', 'ON2GO greeting: listen to all three languages at once (Deepgram)')} description={t('À activer seulement après un appel de test réussi sur le compte Twilio.', 'Turn on only after a successful test call on the Twilio account.')} /></div>
            </fieldset>
          </Section>

          <Section title={t('Paiement des commandes par téléphone', 'Payment of phone orders')}
            subtitle={t('Avec la clé Clover Hosted Checkout, un lien de paiement sécurisé est texté : la commande attend le paiement, puis part en cuisine (et le livreur) une seule fois. Sans la clé : paiement au comptoir, comme avant.', 'With the Clover Hosted Checkout key, a secure payment link is texted: the order waits for the payment, then goes to the kitchen (and the courier) exactly once. Without the key: pay at the counter, as before.')}>
            <fieldset disabled={!owner} className="grid gap-3 sm:grid-cols-3">
              <Field label={t('Mode', 'Mode')}><Select value={s.payment?.mode ?? 'link'} onChange={(e) => setS({ ...s, payment: { ...s.payment, mode: e.target.value as PhoneSettings['payment']['mode'] } })}>
                <option value="link">{t('Lien par texto (comptoir si pas de cellulaire)', 'Link by text (counter if no cell)')}</option>
                <option value="choose">{t('Le client choisit (pour emporter)', 'The caller chooses (pickup)')}</option>
                <option value="counter">{t('Toujours au comptoir', 'Always at the counter')}</option>
              </Select></Field>
              <Field label={t('Lien valide (min)', 'Link valid (min)')}><Input inputMode="numeric" value={s.payment?.expiryMin ?? 30} onChange={(e) => setS({ ...s, payment: { ...s.payment, expiryMin: Number(e.target.value) || 30 } })} /></Field>
              <Field label={t('Rappel texté après (min, 0 = aucun)', 'Reminder text after (min, 0 = none)')}><Input inputMode="numeric" value={s.payment?.reminderMin ?? 10} onChange={(e) => setS({ ...s, payment: { ...s.payment, reminderMin: Number(e.target.value) || 0 } })} /></Field>
            </fieldset>
          </Section>

          <PhoneReadinessPanel owner={owner} />
          {owner && <CallSimulatorPanel lines={lines} />}
        </div>
      )}
    </div>
  );
}

function Ready({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-[13px]"><StatusDot tone={ok ? 'go' : 'wait'} />{label}</div>;
}
