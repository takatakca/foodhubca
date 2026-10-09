'use client';

import { useCallback, useEffect, useState } from 'react';
import { Headset, Languages, Link2, ListTree, Mic, PhoneForwarded, RotateCcw, Save } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { DEFAULT_TREE, LINK_KEYS, PLATFORM_IDS, PLATFORM_NAME, type IvrLang, type IvrNode, type IvrSettings, type LinkKey, type Texts } from '@/lib/foodhub/phone/ivr/tree';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../../settings-ui';
import { CopyValue, ExpansionHead } from '../../expansion-ui';

type Readiness = {
  ai: boolean; model: string; sms: boolean; email: boolean; tokenSet: boolean; numbers: string[]; envNumber: boolean; handoff: string | null; emailTo: string | null;
  voiceUrl: string; statusUrl: string; lines: Array<{ id: string; name: string; enabled: boolean }>; saferGreeting: Texts; preview: Texts;
};

const LANGS: Array<{ key: IvrLang; label: string }> = [{ key: 'fr', label: 'Français' }, { key: 'en', label: 'English' }, { key: 'es', label: 'Español' }];
const VOICES: Record<IvrLang, string[]> = {
  fr: ['Polly.Gabrielle-Neural', 'Polly.Liam-Neural', 'Google.fr-CA-Neural2-A', 'Google.fr-CA-Neural2-B', 'Google.fr-CA-Chirp3-HD-Aoede'],
  en: ['Polly.Joanna-Neural', 'Polly.Matthew-Neural', 'Polly.Danielle-Neural', 'Polly.Ruth-Generative'],
  es: ['Polly.Lupe-Neural', 'Polly.Pedro-Neural', 'Google.es-US-Neural2-A', 'Google.es-US-Neural2-B'],
};

/** Updates one node anywhere in the tree. */
function patchNode(tree: IvrNode[], id: string, patch: (n: IvrNode) => IvrNode): IvrNode[] {
  return tree.map((n) => (n.id === id ? patch(n) : n.children ? { ...n, children: patchNode(n.children, id, patch) } : n));
}

export default function IvrSettingsPage() {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const owner = can('admin');
  const [s, setS] = useState<IvrSettings | null>(null);
  const [r, setR] = useState<Readiness | null>(null);
  const [lang, setLang] = useState<IvrLang>('fr');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ settings: IvrSettings; readiness: Readiness }>('/api/foodhub/phone/ivr').then((d) => { setS(d.settings); setR(d.readiness); }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const d = await api<{ settings: IvrSettings; readiness: Readiness }>('/api/foodhub/phone/ivr', { method: 'PUT', json: { settings: s } });
      setS(d.settings); setR(d.readiness); toast.success(t('Menu enregistré', 'Menu saved'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const setText = (k: 'greeting' | 'marketing' | 'askHelp', v: string) => s && setS({ ...s, [k]: { ...s[k], [lang]: v } });
  const setNode = (id: string, patch: (n: IvrNode) => IvrNode) => s && setS({ ...s, tree: patchNode(s.tree, id, patch) });

  return (
    <div>
      <ExpansionHead title={t('Menu téléphonique ON2GO', 'ON2GO phone menu')}
        intro={t('La ligne principale ON2GO : un accueil enregistré, puis l’IA parle avec le client et l’oriente (commande en ligne, commande Uber Eats / DoorDash / SkipTheDishes, facturation, marchands, livreurs, service à la clientèle, une personne, message vocal). Le clavier reste un plan B : les touches marchent en tout temps, 0 = une personne.', 'The ON2GO main line: a recorded greeting, then the AI talks with the caller and routes the call (online order, Uber Eats / DoorDash / SkipTheDishes order, billing, merchants, couriers, customer service, a person, voicemail). The keypad is the fallback: keys work at any time, 0 = a person.')}
        right={owner && s ? <Button icon={<Save className="size-4" />} loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      {!s || !r ? <Skeleton className="h-96" /> : (
        <fieldset disabled={!owner} className="max-w-5xl">
          <Section icon={<Headset className="size-5" />} title={t('Ce qu’il faut', 'What it needs')}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Ready ok={r.envNumber || r.numbers.length > 0} label={r.numbers.length ? `${t('Numéro', 'Number')} ${r.numbers.join(', ')}` : t('FOODHUB_IVR_NUMBER manquant', 'FOODHUB_IVR_NUMBER missing')} />
              <Ready ok={r.ai} label={r.ai ? `IA · ${r.model}` : t('ANTHROPIC_API_KEY manquante : clavier seulement', 'ANTHROPIC_API_KEY missing: keypad only')} />
              <Ready ok={r.tokenSet} label={r.tokenSet ? t('Signature Twilio vérifiée', 'Twilio signature checked') : t('TWILIO_AUTH_TOKEN manquant', 'TWILIO_AUTH_TOKEN missing')} />
              <Ready ok={r.sms} label={r.sms ? t('Textos (liens) prêts', 'Texts (links) ready') : t('Textos : TWILIO_ACCOUNT_SID, _AUTH_TOKEN', 'Texts: TWILIO_ACCOUNT_SID, _AUTH_TOKEN')} />
              <Ready ok={r.email && Boolean(r.emailTo)} label={r.emailTo ? `${t('Messages vocaux à', 'Voicemails to')} ${r.emailTo}` : t('Courriel des messages : FOODHUB_VOICEMAIL_EMAIL', 'Voicemail email: FOODHUB_VOICEMAIL_EMAIL')} />
              <Ready ok={Boolean(r.handoff)} label={r.handoff ? `${t('Une personne', 'A person')} : ${r.handoff}` : t('Pas de numéro « une personne » : message vocal', 'No "person" number: voicemail')} />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <CopyValue label={t('Twilio → numéro ON2GO → « A call comes in » (Webhook, POST)', 'Twilio → ON2GO number → "A call comes in" (Webhook, POST)')} value={r.voiceUrl} />
              <CopyValue label={t('Twilio → numéro ON2GO → « Call status changes »', 'Twilio → ON2GO number → "Call status changes"')} value={r.statusUrl} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label={t('Menu actif', 'Menu on')} description={t('Éteint : la ligne passe à l’agent de commande (si ce numéro en est une) ou à une personne.', 'Off: the line goes to the ordering agent (if this number is one) or to a person.')} />
              <Segmented value={s.mode} onChange={(v) => setS({ ...s, mode: v })} options={[{ key: 'ai', label: t('L’IA parle d’abord', 'AI talks first') }, { key: 'keypad', label: t('Clavier seulement', 'Keypad only') }]} />
            </div>
          </Section>

          <Section icon={<Languages className="size-5" />} title={t('Accueil et voix', 'Greeting and voices')} right={<Segmented size="sm" value={lang} onChange={setLang} options={LANGS} />}>
            <div className="grid gap-3">
              <Field label={t('Accueil', 'Greeting')} hint={<span>{t('Le texte du propriétaire est le défaut. « Numéro un au Canada » est une affirmation qu’il faut pouvoir prouver (Loi sur la concurrence). Plus sûr :', 'The owner’s text is the default. "Number one in Canada" is a claim that must be provable (Competition Act). Safer:')} <em>{r.saferGreeting[lang]}</em>{owner && <button type="button" className="ml-2 font-semibold text-info-2 hover:underline" onClick={() => setText('greeting', r.saferGreeting[lang])}>{t('Utiliser', 'Use it')}</button>}</span>}>
                <Textarea rows={2} value={s.greeting[lang]} onChange={(e) => setText('greeting', e.target.value)} />
              </Field>
              <Field label={t('Phrase marketing (courte, sur la bouffe)', 'Marketing line (short, about the food)')}><Textarea rows={2} value={s.marketing[lang]} onChange={(e) => setText('marketing', e.target.value)} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('Question de l’IA', 'AI question')}><Input value={s.askHelp[lang]} onChange={(e) => setText('askHelp', e.target.value)} /></Field>
                <Field label={t('Voix', 'Voice')}><Select value={s.voices[lang]} onChange={(e) => setS({ ...s, voices: { ...s.voices, [lang]: e.target.value } })}>{VOICES[lang].map((v) => <option key={v}>{v}</option>)}</Select></Field>
                <Field label={t('Accueil enregistré (MP3, https)', 'Recorded greeting (MP3, https)')} hint={t('Vide = voix neuronale ci-dessus.', 'Empty = the neural voice above.')}><Input value={s.audio.greeting[lang] ?? ''} placeholder="https://…/accueil-fr.mp3" onChange={(e) => setS({ ...s, audio: { ...s.audio, greeting: { ...s.audio.greeting, [lang]: e.target.value } } })} /></Field>
                <Field label={t('Message de boîte vocale enregistré (MP3)', 'Recorded voicemail prompt (MP3)')}><Input value={s.audio.voicemail[lang] ?? ''} placeholder="https://…/boite-vocale-fr.mp3" onChange={(e) => setS({ ...s, audio: { ...s.audio, voicemail: { ...s.audio.voicemail, [lang]: e.target.value } } })} /></Field>
              </div>
            </div>
          </Section>

          <Section icon={<ListTree className="size-5" />} title={t('Options du menu', 'Menu options')} subtitle={t('L’IA oriente vers ces options ; le clavier les lit dans cet ordre. Touche 0 = une personne, étoile = répéter.', 'The AI routes to these options; the keypad reads them in this order. Key 0 = a person, star = repeat.')}
            right={owner ? <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => setS({ ...s, tree: DEFAULT_TREE })}>{t('Menu par défaut', 'Default menu')}</Button> : undefined}>
            <div className="space-y-2">
              {s.tree.map((n) => <NodeRow key={n.id} node={n} lang={lang} depth={0} onChange={setNode} />)}
            </div>
            <div className="mt-4 rounded-md bg-sunken p-3 text-[13px]"><div className="mb-1 text-xs font-bold text-ink-3 uppercase">{t('Aperçu du menu clavier (enregistré)', 'Keypad menu preview (saved)')}</div>{r.preview[lang]}</div>
          </Section>

          <Section icon={<PhoneForwarded className="size-5" />} title={t('Plateformes : soutien officiel', 'Platforms: official support')} subtitle={t('Le menu enregistre le numéro de commande, puis transfère à la ligne officielle de la plateforme, ou texte son lien d’aide officiel si elle n’a pas de ligne. Chaque plateforme n’entend parler que d’elle-même.', 'The menu records the order number, then transfers to the platform’s official line, or texts its official help link when it has none. Each platform only hears about itself.')}>
            <div className="space-y-3">
              {PLATFORM_IDS.map((p) => (
                <div key={p} className="rounded-md border border-line p-3">
                  <div className="mb-2 font-bold">{PLATFORM_NAME[p]}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {LANGS.map((l) => (
                      <Field key={l.key} label={`${t('Ligne', 'Line')} ${l.label}`}><Input type="tel" value={s.platforms[p].phones[l.key] ?? ''} placeholder={t('aucune ligne', 'no line')} onChange={(e) => setS({ ...s, platforms: { ...s.platforms, [p]: { ...s.platforms[p], phones: { ...s.platforms[p].phones, [l.key]: e.target.value } } } })} /></Field>
                    ))}
                    <Field label={t('Page d’aide officielle', 'Official help page')}><Input value={s.platforms[p].helpUrl} onChange={(e) => setS({ ...s, platforms: { ...s.platforms, [p]: { ...s.platforms[p], helpUrl: e.target.value } } })} /></Field>
                  </div>
                </div>
              ))}
              <p className="text-xs text-ink-3">{t('Sources (9 oct. 2026) : help.doordash.com/consumers/s/contactsupport (fr_CA 855-643-8439, en_CA 855-431-0459, es_US 855-834-8733) ; help.uber.com/ubereats (« pas de numéro de téléphone » pour Uber Eats) ; skipthedishes.com/faq (« Need Help? » et clavardage).', 'Sources (Oct 9, 2026): help.doordash.com/consumers/s/contactsupport (fr_CA 855-643-8439, en_CA 855-431-0459, es_US 855-834-8733); help.uber.com/ubereats ("no phone number" for Uber Eats); skipthedishes.com/faq ("Need Help?" and chat).')}</p>
            </div>
          </Section>

          <Section icon={<Link2 className="size-5" />} title={t('Liens ON2GO envoyés par texto', 'ON2GO links sent by text')} subtitle={t('Pages à mettre en ligne : ce sont des adresses provisoires tant qu’elles ne le sont pas.', 'Pages to put online: these are placeholders until they are.')}>
            <div className="grid gap-3 sm:grid-cols-2">
              {LINK_KEYS.map((k) => <Field key={k} label={LINK_LABEL[k](t)}><Input value={s.links[k]} onChange={(e) => setS({ ...s, links: { ...s.links, [k]: e.target.value } as Record<LinkKey, string> })} /></Field>)}
            </div>
          </Section>

          <Section icon={<Mic className="size-5" />} title={t('Transferts et messages', 'Hand-offs and messages')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('Ligne IA qui prend les commandes', 'AI line that takes orders')}><Select value={s.orderLineId} onChange={(e) => setS({ ...s, orderLineId: e.target.value })}><option value="">{t('Automatique', 'Automatic')}</option>{r.lines.map((l) => <option key={l.id} value={l.id}>{l.name}{l.enabled ? '' : ` (${t('éteinte', 'off')})`}</option>)}</Select></Field>
              <Field label={t('« Parler à quelqu’un » sonne à', '"Talk to someone" rings')} hint={t('Vide = FOODHUB_IVR_HANDOFF_NUMBER, sinon message vocal.', 'Empty = FOODHUB_IVR_HANDOFF_NUMBER, else voicemail.')}><Input type="tel" value={s.handoffNumber} onChange={(e) => setS({ ...s, handoffNumber: e.target.value })} /></Field>
              <Field label={t('Messages vocaux et billets à', 'Voicemails and tickets to')} hint={t('Vide = FOODHUB_VOICEMAIL_EMAIL.', 'Empty = FOODHUB_VOICEMAIL_EMAIL.')}><Input type="email" value={s.voicemailEmail} onChange={(e) => setS({ ...s, voicemailEmail: e.target.value })} /></Field>
              <Field label={t('Attente d’une réponse (s)', 'Wait for an answer (s)')}><Select value={String(s.timeout)} onChange={(e) => setS({ ...s, timeout: Number(e.target.value) })}>{[4, 5, 6, 8, 10].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
              <div className="flex items-end sm:col-span-2"><Switch checked={s.transcribeVoicemail} onChange={(v) => setS({ ...s, transcribeVoicemail: v })} label={t('Transcrire les messages vocaux (fr-CA, en-US, es-US)', 'Transcribe voicemails (fr-CA, en-US, es-US)')} /></div>
            </div>
          </Section>
          {!owner && <Banner tone="info">{t('Seul le propriétaire modifie ce menu.', 'Only the owner edits this menu.')}</Banner>}
        </fieldset>
      )}
    </div>
  );
}

const LINK_LABEL: Record<LinkKey, (t: (fr: string, en: string) => string) => string> = {
  merchant: (t) => t('Devenir marchand', 'Become a merchant'),
  courier: (t) => t('Devenir livreur', 'Become a courier'),
  help: (t) => t('Aide / service à la clientèle', 'Help / customer service'),
  billing: (t) => t('Facturation', 'Billing'),
  order: (t) => t('Commander en ligne', 'Order online'),
};

const KIND: Record<IvrNode['action']['kind'], [string, string]> = {
  menu: ['Sous-menu', 'Submenu'], ai: ['IA', 'AI'], order: ['Agent de commande', 'Ordering agent'], platform: ['Plateforme', 'Platform'], handoff: ['Une personne', 'A person'], voicemail: ['Message vocal', 'Voicemail'],
};

function NodeRow({ node, lang, depth, onChange }: { node: IvrNode; lang: IvrLang; depth: number; onChange: (id: string, patch: (n: IvrNode) => IvrNode) => void }) {
  const { t } = useI18n();
  const kind = KIND[node.action.kind];
  return (
    <div className={depth ? 'ml-6 border-l-2 border-line pl-3' : ''}>
      <div className="rounded-md border border-line p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input className="w-14 text-center" inputMode="numeric" maxLength={1} value={node.digit} aria-label={t('Touche', 'Key')} onChange={(e) => onChange(node.id, (n) => ({ ...n, digit: e.target.value.replace(/\D/g, '').slice(0, 1) }))} />
          <span className="font-mono text-xs text-ink-3">{node.id}</span>
          <Badge tone={node.action.kind === 'ai' ? 'brand' : node.action.kind === 'platform' ? 'violet' : 'neutral'}>{t(kind[0], kind[1])}{node.action.kind === 'ai' ? ` · ${node.action.flow}` : node.action.kind === 'platform' && node.action.platform ? ` · ${PLATFORM_NAME[node.action.platform]}` : ''}</Badge>
          <div className="ml-auto"><Switch size="sm" checked={node.enabled} onChange={(v) => onChange(node.id, (n) => ({ ...n, enabled: v }))} label={t('Active', 'On')} /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('Libellé lu au clavier', 'Label read on the keypad')}><Input value={node.label[lang]} onChange={(e) => onChange(node.id, (n) => ({ ...n, label: { ...n.label, [lang]: e.target.value } }))} /></Field>
          <Field label={t('Phrase d’entrée (facultatif)', 'Intro sentence (optional)')}><Input value={node.prompt[lang] ?? ''} onChange={(e) => onChange(node.id, (n) => ({ ...n, prompt: { ...n.prompt, [lang]: e.target.value } }))} /></Field>
          <Field label={t('Mots à reconnaître', 'Words to recognise')}><Input value={node.hints} onChange={(e) => onChange(node.id, (n) => ({ ...n, hints: e.target.value }))} /></Field>
          <Field label={t('Note pour l’IA (anglais)', 'Note for the AI (English)')}><Input value={node.ai} onChange={(e) => onChange(node.id, (n) => ({ ...n, ai: e.target.value }))} /></Field>
        </div>
      </div>
      {node.children?.length ? <div className="mt-2 space-y-2">{node.children.map((c) => <NodeRow key={c.id} node={c} lang={lang} depth={depth + 1} onChange={onChange} />)}</div> : null}
    </div>
  );
}

function Ready({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-[13px]"><StatusDot tone={ok ? 'go' : 'wait'} />{label}</div>;
}
