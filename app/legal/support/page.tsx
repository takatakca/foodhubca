import type { Metadata } from 'next';
import Link from 'next/link';
import { legalInfo, LEGAL_PATHS } from '@/lib/foodhub/legal';
import { Divider, Faq, H1, H2, LangBlock, LangSwitch, P, UL } from '../prose';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Soutien · Support — TAKATAK Food Hub' };

// Support page: the "Support website" of the Clover App Market listing (Clover asks for a support site with FAQs,
// the privacy policy, the terms, an email and a phone number).
export default function SupportPage() {
  const i = legalInfo();
  const email = i.supportEmail;
  const phone = i.supportPhone;
  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null;
  return (
    <article>
      <H1>Soutien · Support</H1>
      <P>{i.appName} — {i.company}</P>
      <LangSwitch />

      <LangBlock id="fr">
        <H2>Nous joindre</H2>
        <UL>
          <li>Courriel : {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : '[à compléter — FOODHUB_SUPPORT_EMAIL]'}</li>
          <li>Téléphone : {phone && tel ? <a className="underline" href={tel}>{phone}</a> : '[à compléter — FOODHUB_SUPPORT_PHONE]'}</li>
          <li>Heures : {i.supportHours.fr}. Réponse en français ou en anglais, en général le jour ouvrable même.</li>
          <li>Pour une commande en cours, utilisez la tablette de la plateforme en attendant notre réponse.</li>
        </UL>
        <H2>Ce qu’il faut nous dire</H2>
        <UL>
          <li>Le nom du restaurant et l’identifiant marchand Clover (Clover → Paramètres → Compte, ou la page d’accueil de l’application).</li>
          <li>La plateforme et le numéro de commande concernés, l’heure, et ce que vous avez vu à l’écran.</li>
        </UL>

        <H2>Questions fréquentes</H2>
        <Faq q="Comment brancher ma caisse Clover ?">
          Installez « TAKATAK Food Hub » depuis le Clover App Market, puis ouvrez-la depuis votre tableau de bord Clover. Food Hub lit le profil de votre caisse (en lecture seule) et affiche sa page d’accueil. Un nouveau restaurant reste « en attente » jusqu’à ce que notre équipe l’approuve — aucune commande n’est envoyée à votre caisse avant.
        </Faq>
        <Faq q="De quel forfait et de quel matériel Clover ai-je besoin ?">
          Un forfait Clover qui comprend l’inventaire et les commandes, et un appareil Clover relié à une imprimante de commandes pour les billets de cuisine. Vous gardez vos propres comptes marchands Uber Eats, DoorDash ou SkipTheDishes.
        </Faq>
        <Faq q="Comment vérifier que tout fonctionne ?">
          Une fois approuvé, appuyez sur « Envoyer une commande test » dans la page d’accueil de l’application : une commande TEST est créée dans Clover, s’imprime à la cuisine et se ferme payée. Rien n’est envoyé aux plateformes.
        </Faq>
        <Faq q="Qu’est-ce que Food Hub écrit dans ma caisse ?">
          Les commandes de livraison (avec un type de commande par plateforme), leurs billets de cuisine, et leur paiement avec un mode de paiement au nom de la plateforme. Sur votre demande seulement : une étiquette d’imprimante de cuisine sur des articles. Food Hub ne traite aucun paiement par carte.
        </Faq>
        <Faq q="Les commandes de livraison faussent-elles mes ventes en magasin ?">
          Non. Elles sont payées avec le mode de paiement de leur plateforme : votre fermeture de caisse les sépare des ventes en magasin.
        </Faq>
        <Faq q="Combien ça coûte ?">
          L’application est gratuite pour les restaurants approuvés. Tout frais futur serait facturé uniquement par la facturation du Clover App Market, jamais en dehors.
        </Faq>
        <Faq q="Comment me débrancher et supprimer mes données ?">
          Désinstallez l’application dans Clover : vos jetons d’accès sont supprimés dès que Clover nous en avise et plus rien n’est envoyé à votre caisse. Pour obtenir ou supprimer vos autres données, écrivez-nous (voir la <Link className="underline" href={LEGAL_PATHS.privacy}>politique de confidentialité</Link>).
        </Faq>
        <P>Voir aussi notre <Link className="underline" href={LEGAL_PATHS.privacy}>politique de confidentialité</Link> et nos <Link className="underline" href={LEGAL_PATHS.terms}>conditions d’utilisation</Link>.</P>
      </LangBlock>

      <Divider />

      <LangBlock id="en">
        <H2>Contact us</H2>
        <UL>
          <li>Email: {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : '[to be completed — FOODHUB_SUPPORT_EMAIL]'}</li>
          <li>Phone: {phone && tel ? <a className="underline" href={tel}>{phone}</a> : '[to be completed — FOODHUB_SUPPORT_PHONE]'}</li>
          <li>Hours: {i.supportHours.en}. We answer in French or English, usually the same business day.</li>
          <li>For an order in progress, use the platform’s tablet while you wait for our answer.</li>
        </UL>
        <H2>What to tell us</H2>
        <UL>
          <li>The restaurant name and the Clover merchant ID (Clover → Settings → Account, or the app’s welcome page).</li>
          <li>The platform and order number concerned, the time, and what you saw on screen.</li>
        </UL>

        <H2>Frequently asked questions</H2>
        <Faq q="How do I connect my Clover register?">
          Install “TAKATAK Food Hub” from the Clover App Market, then open it from your Clover dashboard. Food Hub reads your register’s profile (read-only) and shows its welcome page. A new restaurant stays “pending” until our team approves it — no order is sent to your register before that.
        </Faq>
        <Faq q="Which Clover plan and hardware do I need?">
          A Clover plan that includes Inventory and Orders, and a Clover device connected to an order printer for kitchen tickets. You keep your own Uber Eats, DoorDash or SkipTheDishes merchant accounts.
        </Faq>
        <Faq q="How do I check that everything works?">
          Once approved, press “Send a test order” on the app’s welcome page: a TEST order is created in Clover, prints in the kitchen and closes as paid. Nothing is sent to the platforms.
        </Faq>
        <Faq q="What does Food Hub write to my register?">
          Delivery orders (with an order type per platform), their kitchen tickets, and their payment with a tender named after the platform. Only when you ask: a kitchen printer label on items. Food Hub never processes card payments.
        </Faq>
        <Faq q="Do delivery orders distort my in-store sales?">
          No. They are paid with their platform’s tender, so your closeout keeps them apart from in-store sales.
        </Faq>
        <Faq q="How much does it cost?">
          The app is free for approved restaurants. Any future fee would be billed only through Clover App Market billing, never outside it.
        </Faq>
        <Faq q="How do I disconnect and delete my data?">
          Uninstall the app in Clover: your access tokens are deleted as soon as Clover notifies us and nothing more is sent to your register. To get or delete your other data, write to us (see the <Link className="underline" href={LEGAL_PATHS.privacy}>privacy policy</Link>).
        </Faq>
        <P>See also our <Link className="underline" href={LEGAL_PATHS.privacy}>privacy policy</Link> and <Link className="underline" href={LEGAL_PATHS.terms}>terms of use</Link>.</P>
      </LangBlock>
    </article>
  );
}
