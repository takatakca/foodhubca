import type { Metadata } from 'next';
import Link from 'next/link';
import { legalInfo, LEGAL_PATHS } from '@/lib/foodhub/legal';
import { Divider, H1, H2, LangBlock, LangSwitch, P, UL } from '../prose';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conditions d’utilisation · Terms of use — TAKATAK Food Hub' };

// Terms of use / end-user licence (French first; the French version prevails — Charter of the French language).
// DRAFT until FOODHUB_LEGAL_APPROVED=true: the owner and a legal adviser must confirm it before submission.
export default function TermsPage() {
  const i = legalInfo();
  const contactFr = i.supportEmail ?? '[courriel à compléter — FOODHUB_SUPPORT_EMAIL]';
  const contactEn = i.supportEmail ?? '[email to be completed — FOODHUB_SUPPORT_EMAIL]';
  return (
    <article>
      <H1>Conditions d’utilisation · Terms of use</H1>
      <P>{i.appName} — {i.company}. Mise à jour · Updated : {i.updated}</P>
      <LangSwitch />

      <LangBlock id="fr">
        <H2>1. Le service</H2>
        <P>{i.company} (« nous ») fournit {i.appName} (« le service »), un logiciel qui reçoit les commandes des plateformes de livraison, les envoie à la caisse Clover, publie les menus et les disponibilités sur les plateformes et prépare des rapports. En installant l’application Clover ou en utilisant le service, le marchand (« vous ») accepte les présentes conditions.</P>

        <H2>2. Accès et approbation</H2>
        <P>Le service est réservé aux restaurants que nous approuvons. Un marchand qui installe l’application depuis Clover reste « en attente » tant que nous n’avons pas approuvé son branchement ; aucune commande ne lui est envoyée pendant ce temps. Vous êtes responsable des comptes de votre équipe et de la confidentialité de leurs codes et NIP.</P>

        <H2>3. Vos responsabilités</H2>
        <UL>
          <li>L’exactitude de vos menus, prix, taxes, allergènes, heures et disponibilités.</li>
          <li>Le respect des conditions des plateformes (Uber Eats, DoorDash, SkipTheDishes, Too Good To Go) et de Clover, et des lois applicables, y compris en matière d’alimentation, de taxes et de protection des renseignements personnels.</li>
          <li>La vérification des commandes reçues et la décision de les accepter ou de les refuser.</li>
        </UL>

        <H2>4. Paiements et finances</H2>
        <P>Le service ne traite aucun paiement par carte. Les paiements sont traités par Clover et par les plateformes, selon leurs propres conditions. Les fonctions d’analyse et d’assistance (y compris l’intelligence artificielle) signalent des écarts et proposent des actions, mais n’approuvent aucun montant, ne comptabilisent aucune écriture et ne règlent aucun litige financier : chaque décision revient au propriétaire.</P>

        <H2>5. Disponibilité</H2>
        <P>Nous faisons des efforts raisonnables pour que le service soit disponible et fiable, mais il dépend aussi de Clover, des plateformes, d’Internet et de nos fournisseurs. Gardez une solution de rechange (par exemple les tablettes des plateformes) pour les pannes.</P>

        <H2>6. Frais</H2>
        <P>L’application Clover est offerte sans frais aux restaurants approuvés. Si des frais s’appliquaient un jour à l’application Clover, ils seraient indiqués dans sa fiche du Clover App Market et facturés uniquement par la facturation de Clover, jamais en dehors.</P>

        <H2>7. Propriété intellectuelle et licence</H2>
        <P>Nous vous accordons une licence non exclusive, non transférable et révocable d’utiliser le service pour votre restaurant pendant la durée de votre branchement. Vos données restent les vôtres ; vous nous permettez de les traiter pour fournir le service, comme le décrit notre <Link href={LEGAL_PATHS.privacy} className="underline">politique de confidentialité</Link>.</P>

        <H2>8. Responsabilité</H2>
        <P>Dans la mesure permise par la loi, le service est fourni « tel quel » et notre responsabilité totale se limite aux sommes que vous nous avez payées pour le service au cours des douze derniers mois. Nous ne sommes pas responsables des pertes indirectes, des commandes perdues en raison d’une panne d’un tiers, ni des décisions prises par les plateformes. Rien dans les présentes ne limite les droits que la loi vous accorde et auxquels on ne peut renoncer.</P>

        <H2>9. Fin du service</H2>
        <P>Vous pouvez désinstaller l’application Clover ou nous demander de débrancher votre restaurant en tout temps ; vos jetons Clover sont alors supprimés. Nous pouvons suspendre ou mettre fin au service en cas de non-respect des présentes conditions ou avec un préavis raisonnable. Sur demande, nous vous remettons ou supprimons vos données, sous réserve de nos obligations légales de conservation.</P>

        <H2>10. Droit applicable et langue</H2>
        <P>Les présentes conditions sont régies par les lois du Québec et les lois fédérales du Canada qui s’y appliquent. Les tribunaux du district judiciaire de Montréal sont compétents. La version française prévaut ; la version anglaise est fournie pour information.</P>

        <H2>11. Marques de commerce</H2>
        <P>Clover est une marque de Fiserv, Inc. ; Uber Eats, DoorDash, SkipTheDishes et Too Good To Go appartiennent à leurs propriétaires respectifs. {i.appName} est un logiciel indépendant : il n’est ni conçu, ni commandité, ni approuvé par ces entreprises.</P>

        <H2>12. Nous joindre</H2>
        <P>{contactFr}{i.supportPhone ? ` · ${i.supportPhone}` : ''} · {i.company}, {i.address}</P>
      </LangBlock>

      <Divider />

      <LangBlock id="en">
        <H2>1. The service</H2>
        <P>{i.company} (“we”) provides {i.appName} (“the service”), software that receives delivery platform orders, sends them to the Clover POS, publishes menus and availability on the platforms and prepares reports. By installing the Clover app or using the service, the merchant (“you”) accepts these terms. The French version prevails; this English version is provided for information.</P>

        <H2>2. Access and approval</H2>
        <P>The service is reserved for restaurants we approve. A merchant who installs the app from Clover stays “pending” until we approve the connection; no orders are sent to it in the meantime. You are responsible for your team’s accounts and for keeping their codes and PINs confidential.</P>

        <H2>3. Your responsibilities</H2>
        <UL>
          <li>The accuracy of your menus, prices, taxes, allergens, hours and availability.</li>
          <li>Complying with the terms of the platforms (Uber Eats, DoorDash, SkipTheDishes, Too Good To Go) and Clover, and with applicable laws, including food, tax and privacy laws.</li>
          <li>Checking the orders you receive and deciding to accept or reject them.</li>
        </UL>

        <H2>4. Payments and finances</H2>
        <P>The service does not process card payments. Payments are processed by Clover and the platforms under their own terms. Analysis and assistance features (including artificial intelligence) flag discrepancies and suggest actions, but never approve amounts, post entries or settle financial disputes: every decision belongs to the owner.</P>

        <H2>5. Availability</H2>
        <P>We make reasonable efforts to keep the service available and reliable, but it also depends on Clover, the platforms, the Internet and our providers. Keep a fallback (for example the platforms’ tablets) for outages.</P>

        <H2>6. Fees</H2>
        <P>The Clover app is free for approved restaurants. If a fee ever applied to the Clover app, it would be shown on its Clover App Market listing and billed only through Clover’s billing, never outside it.</P>

        <H2>7. Intellectual property and licence</H2>
        <P>We grant you a non-exclusive, non-transferable, revocable licence to use the service for your restaurant while it is connected. Your data stays yours; you allow us to process it to provide the service, as described in our <Link href={LEGAL_PATHS.privacy} className="underline">privacy policy</Link>.</P>

        <H2>8. Liability</H2>
        <P>To the extent permitted by law, the service is provided “as is” and our total liability is limited to the amounts you paid us for the service in the last twelve months. We are not liable for indirect losses, orders lost because of a third-party outage, or decisions made by the platforms. Nothing here limits rights the law gives you that cannot be waived.</P>

        <H2>9. Ending the service</H2>
        <P>You may uninstall the Clover app or ask us to disconnect your restaurant at any time; your Clover tokens are then deleted. We may suspend or end the service if these terms are not respected, or with reasonable notice. On request, we return or delete your data, subject to our legal retention obligations.</P>

        <H2>10. Governing law and language</H2>
        <P>These terms are governed by the laws of Québec and the federal laws of Canada that apply there. The courts of the judicial district of Montréal have jurisdiction. The French version prevails.</P>

        <H2>11. Trademarks</H2>
        <P>Clover is a trademark of Fiserv, Inc.; Uber Eats, DoorDash, SkipTheDishes and Too Good To Go belong to their respective owners. {i.appName} is independent software: it is not made, sponsored or endorsed by those companies.</P>

        <H2>12. Contact us</H2>
        <P>{contactEn}{i.supportPhone ? ` · ${i.supportPhone}` : ''} · {i.company}, {i.address}</P>
      </LangBlock>
    </article>
  );
}
