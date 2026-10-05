import type { Metadata } from 'next';
import Link from 'next/link';
import { legalInfo, LEGAL_PATHS } from '@/lib/foodhub/legal';
import { Divider, H1, H2, LangBlock, LangSwitch, P, UL } from '../prose';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Soutien · Support — TAKATAK Food Hub' };

// Support page: the "Support URL" of the Clover App Market listing.
export default function SupportPage() {
  const i = legalInfo();
  const email = i.supportEmail;
  return (
    <article>
      <H1>Soutien · Support</H1>
      <P>{i.appName} — {i.company}</P>
      <LangSwitch />

      <LangBlock id="fr">
        <H2>Nous joindre</H2>
        <UL>
          <li>Courriel : {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : '[à compléter — FOODHUB_SUPPORT_EMAIL]'}</li>
          {i.supportPhone && <li>Téléphone : {i.supportPhone}</li>}
          <li>Réponse en français ou en anglais, en général le jour ouvrable suivant. Pour une commande en cours, utilisez la tablette de la plateforme en attendant notre réponse.</li>
        </UL>
        <H2>Ce qu’il faut nous dire</H2>
        <UL>
          <li>Le nom du restaurant et l’identifiant marchand Clover (Clover → Paramètres → Compte).</li>
          <li>La plateforme et le numéro de commande concernés, l’heure, et ce que vous avez vu à l’écran.</li>
        </UL>
        <H2>Brancher l’application Clover</H2>
        <UL>
          <li>Installez « TAKATAK Food Hub » depuis le Clover App Market, puis ouvrez-la une fois : votre caisse est alors branchée.</li>
          <li>Un nouveau restaurant reste « en attente » jusqu’à ce que le propriétaire de Food Hub l’approuve — aucune commande n’est envoyée avant.</li>
          <li>Pour débrancher : désinstallez l’application dans Clover. Vos jetons d’accès sont supprimés dès que Clover nous en avise.</li>
        </UL>
        <P>Voir aussi notre <Link className="underline" href={LEGAL_PATHS.privacy}>politique de confidentialité</Link> et nos <Link className="underline" href={LEGAL_PATHS.terms}>conditions d’utilisation</Link>.</P>
      </LangBlock>

      <Divider />

      <LangBlock id="en">
        <H2>Contact us</H2>
        <UL>
          <li>Email: {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : '[to be completed — FOODHUB_SUPPORT_EMAIL]'}</li>
          {i.supportPhone && <li>Phone: {i.supportPhone}</li>}
          <li>We answer in French or English, usually by the next business day. For an order in progress, use the platform’s tablet while you wait for our answer.</li>
        </UL>
        <H2>What to tell us</H2>
        <UL>
          <li>The restaurant name and the Clover merchant ID (Clover → Settings → Account).</li>
          <li>The platform and order number concerned, the time, and what you saw on screen.</li>
        </UL>
        <H2>Connecting the Clover app</H2>
        <UL>
          <li>Install “TAKATAK Food Hub” from the Clover App Market, then open it once: your register is then connected.</li>
          <li>A new restaurant stays “pending” until the Food Hub owner approves it — no orders are sent before that.</li>
          <li>To disconnect: uninstall the app in Clover. Your access tokens are deleted as soon as Clover notifies us.</li>
        </UL>
        <P>See also our <Link className="underline" href={LEGAL_PATHS.privacy}>privacy policy</Link> and <Link className="underline" href={LEGAL_PATHS.terms}>terms of use</Link>.</P>
      </LangBlock>
    </article>
  );
}
