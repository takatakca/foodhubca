'use client';

// First sign-in on a screen: TakTak spins in, says hello, lets the person pick the language and text size, and offers
// the guided tour. Shown once per person (help state), never on top of a new-order pop-up (it sits under it).
import { useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Modal } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/tabs';
import { useDisplay, type TextSize } from '@/lib/ui/display';
import { useI18n } from '@/lib/i18n/client';
import { TakTak } from './taktak';
import { useHelp } from './help-provider';

export function Welcome({ name }: { name: string }) {
  const help = useHelp();
  const { t, lang, setLang } = useI18n();
  const [display, setDisplay] = useDisplay();
  const [spin, setSpin] = useState(0);
  useEffect(() => { if (!help.welcomed) { const tm = setTimeout(() => setSpin(1), 250); return () => clearTimeout(tm); } }, [help.welcomed]);
  if (help.welcomed) return null;
  const first = name.split(/\s+/)[0] || name;
  return (
    <Modal size="md" onClose={help.setWelcomed}>
      <div className="flex flex-col items-center text-center">
        <TakTak size={104} spinKey={spin} wave mood="party" className="taktak-bob" />
        <h2 className="mt-3 text-2xl font-extrabold text-ink">{t(`Bonjour ${first} ! Je suis TakTak.`, `Hi ${first}! I’m TakTak.`)}</h2>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">{t('Je vous montre chaque bouton la première fois que vous le touchez, et je suis toujours en bas à droite si vous avez une question. Rien ne part vers les plateformes sans que vous le sachiez.', 'I explain each button the first time you tap it, and I’m always at the bottom right if you have a question. Nothing goes to the platforms without you knowing.')}</p>
        <div className="mt-5 grid w-full max-w-sm gap-3 text-left">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-ink-2">{t('Langue', 'Language')}</span>
            <Segmented<'fr' | 'en'> value={lang} onChange={setLang} options={[{ key: 'fr', label: 'Français' }, { key: 'en', label: 'English' }]} />
          </div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-ink-2">{t('Taille du texte', 'Text size')}</span>
            <Segmented<TextSize> value={display.text} onChange={(v) => setDisplay({ text: v })} options={[{ key: 'md', label: 'A' }, { key: 'lg', label: 'A+' }, { key: 'xl', label: 'A++' }]} />
          </div>
        </div>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <Button variant="brand" size="xl" icon={<PlayCircle className="size-6" />} onClick={() => { help.setWelcomed(); help.startTour(); }}>{t('Visite guidée (1 minute)', 'Guided tour (1 minute)')}</Button>
          <Button variant="ghost" size="lg" onClick={help.setWelcomed}>{t('Plus tard — je toucherai TakTak au besoin', 'Later — I’ll tap TakTak when I need it')}</Button>
        </div>
      </div>
    </Modal>
  );
}
