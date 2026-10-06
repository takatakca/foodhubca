'use client';

// TakTak's help panel, open from any screen (TakTak button, "?" on a keyboard): help for this screen and its guided
// tour, display settings of this screen, connection status with the last problems, a support report, the co-pilot.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CircleHelp, Monitor, PlayCircle, Send, Sparkles, Wifi } from 'lucide-react';
import { Drawer } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/tabs';
import { Switch, Textarea } from '@/components/ui/form';
import { HINTS, pick } from '@/lib/help/content';
import { useDisplay, type Density, type TextSize, type Tips } from '@/lib/ui/display';
import { flush, health, lastRefreshAt, recentIssues, subscribe, type Health } from '@/lib/ui/supervisor';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { TakTak } from './taktak';
import { useHelp } from './help-provider';

function useSupervisor() {
  const version = useSyncExternalStore(subscribe, () => recentIssues().length + lastRefreshAt() + healthRank(health()), () => 0);
  return { version, health: health(), issues: recentIssues(), lastRefresh: lastRefreshAt() };
}
const healthRank = (h: Health) => ({ good: 0, slow: 1e15, stale: 2e15, offline: 3e15 })[h];

export function HelpDrawer() {
  const help = useHelp();
  const { t, lang, loc } = useI18n();
  const [display, setDisplay] = useDisplay();
  const sup = useSupervisor();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [onScreen, setOnScreen] = useState<string[]>([]);

  useEffect(() => {
    if (!help.drawerOpen) return;
    setOnScreen(Object.keys(HINTS).filter((id) => document.querySelector(`[data-help="${id}"]`)));
    setSent('idle');
  }, [help.drawerOpen]);

  if (!help.drawerOpen) return null;
  const page = help.page;
  const healthLabel: Record<Health, [string, string, string]> = {
    good: [t('Tout va bien', 'All good'), t('Les données se rafraîchissent normalement.', 'Data refreshes normally.'), 'text-go-2'],
    slow: [t('Connexion lente', 'Slow connection'), t('Les actions peuvent prendre quelques secondes.', 'Actions may take a few seconds.'), 'text-wait-2'],
    stale: [t('Données figées', 'Data not refreshing'), t('Reconnexion en cours… Les commandes continuent sur les tablettes des plateformes et dans Clover.', 'Reconnecting… Orders keep arriving on the platform tablets and in Clover.'), 'text-wait-2'],
    offline: [t('Hors ligne', 'Offline'), t('Vos changements sont gardés sur cet appareil et partiront au retour du réseau.', 'Your changes are kept on this device and will be sent when the network is back.'), 'text-stop-2'],
  };
  const [hTitle, hBody, hTone] = healthLabel[sup.health];

  return (
    <Drawer onClose={help.closeDrawer} width="md"
      title={<span className="flex items-center gap-3"><TakTak size={40} spinKey={help.spin} wave />{t('Aide de TakTak', 'TakTak help')}</span>}
      subtitle={pick(page.title, lang)}>
      <div className="space-y-5 p-5">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-extrabold tracking-wide text-ink uppercase"><CircleHelp className="size-4 text-brand" />{t('Cet écran', 'This screen')}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{pick(page.intro, lang)}</p>
          {page.tips?.map((tip, i) => <p key={i} className="mt-2 rounded-md bg-wait-soft px-3 py-2 text-sm text-wait-2">{pick(tip, lang)}</p>)}
          <Button className="mt-3 w-full" variant="brand" size="lg" icon={<PlayCircle className="size-5" />} onClick={help.startTour}>{t('Visite guidée de cet écran', 'Guided tour of this screen')}</Button>
          {onScreen.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {onScreen.map((id) => (
                <li key={id}>
                  <button type="button" className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised"
                    onClick={() => { const el = (document.querySelector(`[data-help="${id}"]`)?.firstElementChild as HTMLElement | null); help.closeDrawer(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => help.showMark(id, el), 250); }}>
                    <span className="flex-1"><span className="block text-sm font-bold text-ink">{pick(HINTS[id].title, lang)}</span><span className="line-clamp-1 text-[13px] text-ink-3">{pick(HINTS[id].body, lang)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-sm font-extrabold tracking-wide text-ink uppercase"><Monitor className="size-4 text-brand" />{t('Affichage de cet écran', 'This screen’s display')}</h3>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-ink-2">{t('Taille du texte', 'Text size')}</span>
              <Segmented<TextSize> value={display.text} onChange={(v) => setDisplay({ text: v })} options={[{ key: 'md', label: 'A' }, { key: 'lg', label: <span className="text-[1.1em]">A+</span> }, { key: 'xl', label: <span className="text-[1.2em]">A++</span> }]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-ink-2">{t('Espacement', 'Spacing')}</span>
              <Segmented<Density> value={display.density} onChange={(v) => setDisplay({ density: v })} options={[{ key: 'comfortable', label: t('Grand (tactile)', 'Roomy (touch)') }, { key: 'compact', label: t('Serré', 'Compact') }]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-ink-2">{t('Astuces de TakTak', 'TakTak’s tips')}</span>
              <Segmented<Tips> value={display.tips} onChange={(v) => setDisplay({ tips: v })} options={[{ key: 'full', label: t('Toutes', 'All') }, { key: 'light', label: t('Importantes', 'Important') }, { key: 'off', label: t('Aucune', 'None') }]} />
            </div>
            <Switch checked={display.reduceMotion} onChange={(v) => setDisplay({ reduceMotion: v })} label={t('Moins d’animations', 'Fewer animations')} />
            <button type="button" onClick={help.resetTips} className="min-h-10 text-sm font-semibold text-ink-3 underline-offset-4 hover:text-ink hover:underline">{t('Revoir toutes les astuces', 'Show every tip again')}</button>
          </div>
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-sm font-extrabold tracking-wide text-ink uppercase"><Wifi className="size-4 text-brand" />{t('État de la connexion', 'Connection status')}</h3>
          <div className="mt-2 rounded-lg border border-line bg-surface p-3">
            <div className={cn('text-[15px] font-extrabold', hTone)}>{hTitle}</div>
            <div className="text-sm text-ink-3">{hBody}</div>
            <div className="mt-1 text-xs text-ink-4">{t('Dernière mise à jour', 'Last refresh')} : {new Date(sup.lastRefresh).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            {sup.issues.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-ink-3">
                {sup.issues.slice(0, 8).map((i, n) => <li key={n} className="truncate" title={i.message}><span className="num text-ink-4">{new Date(i.lastAt).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}</span> · {i.message}{i.count > 1 ? ` ×${i.count}` : ''}</li>)}
              </ul>
            )}
          </div>
          <Textarea className="mt-2" rows={2} placeholder={t('Décrivez le problème (facultatif)…', 'Describe the problem (optional)…')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="mt-2 w-full" variant="outline" size="lg" icon={<Send className="size-4" />} loading={sent === 'sending'} disabled={sent === 'sent'}
            onClick={async () => { setSent('sending'); const ok = await flush(note.trim() || `Support report from ${help.page.match}`); setSent(ok ? 'sent' : 'failed'); if (ok) setNote(''); }}>
            {sent === 'sent' ? t('Envoyé — merci !', 'Sent — thank you!') : sent === 'failed' ? t('Pas envoyé — réessayer', 'Not sent — retry') : t('Envoyer un rapport à l’équipe', 'Send a report to the team')}
          </Button>
        </section>

        <section>
          <Button className="w-full" variant="soft" size="lg" icon={<Sparkles className="size-5 text-brand" />} onClick={() => { help.closeDrawer(); window.dispatchEvent(new Event('takatak:copilot')); }}>{t('Demander au copilote', 'Ask the co-pilot')}</Button>
          <p className="mt-3 text-xs leading-relaxed text-ink-4">{t('Raccourcis : ? aide · ⌘K chercher · ⌘S enregistrer maintenant · ⌘Z annuler · ⇧⌘Z rétablir', 'Shortcuts: ? help · ⌘K search · ⌘S save now · ⌘Z undo · ⇧⌘Z redo')}</p>
        </section>
      </div>
    </Drawer>
  );
}
