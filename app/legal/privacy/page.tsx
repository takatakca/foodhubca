import type { Metadata } from 'next';
import { legalInfo } from '@/lib/foodhub/legal';
import { Divider, H1, H2, LangBlock, LangSwitch, P, UL } from '../prose';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Politique de confidentialité · Privacy policy — TAKATAK Food Hub' };

// Privacy policy (French first — Charter of the French language; Québec Law 25 and PIPEDA topics covered).
// DRAFT until FOODHUB_LEGAL_APPROVED=true: it describes what the code actually does, but the owner and a
// legal adviser must confirm it before the app is submitted to the Clover App Market.
export default function PrivacyPage() {
  const i = legalInfo();
  const contactFr = i.supportEmail ?? '[courriel à compléter — FOODHUB_SUPPORT_EMAIL]';
  const contactEn = i.supportEmail ?? '[email to be completed — FOODHUB_SUPPORT_EMAIL]';
  const officerFr = i.privacyOfficer || `la personne ayant la plus haute autorité au sein de ${i.company}`;
  const officerEn = i.privacyOfficer || `the person with the highest authority within ${i.company}`;
  return (
    <article>
      <H1>Politique de confidentialité · Privacy policy</H1>
      <P>{i.appName} — {i.company}. Mise à jour · Updated : {i.updated}</P>
      <LangSwitch />

      <LangBlock id="fr">
        <H2>1. Qui sommes-nous</H2>
        <P>{i.appName} (« Food Hub ») est le logiciel de gestion des commandes de {i.company} ({i.address}). Il réunit sur un seul écran les commandes Uber Eats, DoorDash, SkipTheDishes et Too Good To Go, les envoie à la caisse Clover du restaurant, garde les menus et les ruptures de stock à jour sur chaque plateforme et rapproche les paiements des plateformes. La présente politique s’applique au site Web de Food Hub et à l’application Clover « TAKATAK Food Hub ».</P>

        <H2>2. Renseignements que nous traitons</H2>
        <UL>
          <li><b>Marchands Clover qui branchent l’application :</b> identifiant et nom du marchand, inventaire (articles, catégories, modificateurs, prix, stock), commandes et paiements que Food Hub crée dans Clover, ventes du jour pour le rapprochement, et les jetons d’accès Clover (conservés uniquement sur notre serveur, jamais affichés ni transmis à des tiers).</li>
          <li><b>Commandes des plateformes de livraison :</b> prénom ou nom du client, numéro de téléphone fourni par la plateforme (souvent un numéro relais), adresse de livraison si la plateforme la transmet, contenu de la commande, instructions spéciales, montants, état de la commande et renseignements sur le livreur.</li>
          <li><b>Équipe du restaurant :</b> nom, courriel ou numéro de cellulaire (pour les codes de connexion), rôle, NIP de gérant (conservé sous forme hachée, jamais en clair), journal des actions et des tentatives de connexion, et l’état des tablettes de cuisine.</li>
          <li><b>Nous ne recevons aucun numéro de carte de paiement.</b> Les paiements sont traités par Clover et par les plateformes ; Food Hub n’enregistre dans Clover que le mode de paiement et le montant.</li>
        </UL>

        <H2>3. Pourquoi nous les utilisons</H2>
        <UL>
          <li>Recevoir, accepter, préparer et suivre les commandes, et les envoyer à la caisse et à l’imprimante de la cuisine.</li>
          <li>Publier les menus, les prix, les heures et les ruptures de stock sur les plateformes que le restaurant a branchées.</li>
          <li>Vérifier les paiements des plateformes, préparer les rapports et le registre interne (sans rien approuver ni comptabiliser automatiquement).</li>
          <li>Assurer la sécurité du service (connexion, journal d’activité, détection d’anomalies).</li>
        </UL>
        <P>Nous ne vendons aucun renseignement personnel et ne les utilisons pas à des fins publicitaires.</P>

        <H2>4. Avec qui nous les partageons</H2>
        <UL>
          <li>Les plateformes que le restaurant a branchées (Uber Eats, DoorDash, SkipTheDishes / Just Eat Takeaway, Too Good To Go) et Clover, uniquement pour traiter les commandes et les menus.</li>
          <li>Nos fournisseurs techniques, liés par des obligations de confidentialité : hébergement du serveur (Contabo), base de données (Supabase), envoi des courriels de connexion (Resend), envoi des textos de connexion si activé (Twilio) et, si le propriétaire l’active, l’assistant d’analyse Claude (Anthropic), qui reçoit un résumé des données de l’entreprise et ne prend aucune décision.</li>
          <li>Les autorités, lorsque la loi l’exige.</li>
        </UL>

        <H2>5. Où sont conservés les renseignements</H2>
        <P>Nos fournisseurs peuvent conserver ou traiter les renseignements à l’extérieur du Québec, notamment aux États-Unis ou dans l’Union européenne. Avant de communiquer des renseignements à l’extérieur du Québec, nous évaluons si leur protection y est adéquate, comme l’exige la Loi sur la protection des renseignements personnels dans le secteur privé.</P>

        <H2>6. Durée de conservation</H2>
        <P>Nous conservons les renseignements le temps nécessaire aux fins ci-dessus et pour respecter nos obligations comptables et fiscales (en général six ans pour les données de vente), puis nous les détruisons ou les rendons anonymes. Lorsqu’un marchand désinstalle l’application Clover, ses jetons d’accès sont supprimés dès que Clover nous en avise.</P>

        <H2>7. Sécurité</H2>
        <P>L’accès est réservé aux membres de l’équipe autorisés (codes de connexion à usage unique, rôles et permissions), les échanges se font en HTTPS, les secrets restent sur le serveur et chaque action importante est journalisée. En cas d’incident de confidentialité présentant un risque de préjudice sérieux, nous avisons la Commission d’accès à l’information et les personnes concernées.</P>

        <H2>8. Vos droits</H2>
        <P>Vous pouvez demander l’accès à vos renseignements, leur rectification, leur portabilité, retirer votre consentement ou demander la fin de leur diffusion, en écrivant à notre responsable de la protection des renseignements personnels. Si vous n’êtes pas satisfait de notre réponse, vous pouvez vous adresser à la Commission d’accès à l’information du Québec ou au Commissariat à la protection de la vie privée du Canada.</P>

        <H2>9. Responsable et coordonnées</H2>
        <P>Responsable de la protection des renseignements personnels : {officerFr}. Courriel : {contactFr}{i.supportPhone ? ` · Téléphone : ${i.supportPhone}` : ''}. Adresse : {i.company}, {i.address}.</P>

        <H2>10. Modifications</H2>
        <P>Nous publierons toute modification sur cette page, avec sa date de mise à jour.</P>
      </LangBlock>

      <Divider />

      <LangBlock id="en">
        <H2>1. Who we are</H2>
        <P>{i.appName} (“Food Hub”) is the order-management software of {i.company} ({i.address}). It brings Uber Eats, DoorDash, SkipTheDishes and Too Good To Go orders onto one screen, sends them to the restaurant’s Clover POS, keeps menus and sold-out items up to date on each platform and reconciles platform payouts. This policy covers the Food Hub website and the “TAKATAK Food Hub” Clover app. The French version prevails.</P>

        <H2>2. Information we process</H2>
        <UL>
          <li><b>Clover merchants who connect the app:</b> merchant ID and name, inventory (items, categories, modifiers, prices, stock), the orders and payments Food Hub creates in Clover, daily sales for reconciliation, and Clover access tokens (kept only on our server, never displayed or shared with third parties).</li>
          <li><b>Delivery platform orders:</b> customer first name or name, the phone number provided by the platform (often a relay number), delivery address when the platform sends it, order contents, special instructions, amounts, order status and courier details.</li>
          <li><b>Restaurant team:</b> name, email or mobile number (for sign-in codes), role, manager PIN (stored hashed), activity and sign-in log, and kitchen tablet status.</li>
          <li><b>We never receive payment card numbers.</b> Payments are processed by Clover and the platforms; Food Hub only records the tender type and amount in Clover.</li>
        </UL>

        <H2>3. Why we use it</H2>
        <UL>
          <li>To receive, accept, prepare and track orders, and send them to the register and the kitchen printer.</li>
          <li>To publish menus, prices, hours and sold-out items on the platforms the restaurant connected.</li>
          <li>To check platform payouts and prepare reports and the internal ledger (nothing is approved or posted automatically).</li>
          <li>To keep the service secure (sign-in, activity log, anomaly detection).</li>
        </UL>
        <P>We do not sell personal information and do not use it for advertising.</P>

        <H2>4. Who we share it with</H2>
        <UL>
          <li>The platforms the restaurant connected (Uber Eats, DoorDash, SkipTheDishes / Just Eat Takeaway, Too Good To Go) and Clover, only to process orders and menus.</li>
          <li>Our technical providers, bound by confidentiality: server hosting (Contabo), database (Supabase), sign-in emails (Resend), sign-in text messages when enabled (Twilio) and, if the owner turns it on, the Claude analysis assistant (Anthropic), which receives a summary of business data and makes no decisions.</li>
          <li>Authorities, when the law requires it.</li>
        </UL>

        <H2>5. Where it is stored</H2>
        <P>Our providers may store or process information outside Québec, including in the United States or the European Union. Before information is communicated outside Québec, we assess whether it will be adequately protected, as Québec’s private-sector privacy act requires.</P>

        <H2>6. How long we keep it</H2>
        <P>We keep information for as long as needed for the purposes above and to meet our accounting and tax obligations (generally six years for sales data), then destroy or anonymize it. When a merchant uninstalls the Clover app, its access tokens are deleted as soon as Clover notifies us.</P>

        <H2>7. Security</H2>
        <P>Access is limited to authorized team members (one-time sign-in codes, roles and permissions), traffic uses HTTPS, secrets stay on the server and every important action is logged. If a confidentiality incident presents a risk of serious injury, we notify the Commission d’accès à l’information and the people concerned.</P>

        <H2>8. Your rights</H2>
        <P>You may ask to access, correct or port your information, withdraw consent or ask us to stop disseminating it by writing to our privacy officer. If you are not satisfied with our answer, you may contact the Commission d’accès à l’information du Québec or the Office of the Privacy Commissioner of Canada.</P>

        <H2>9. Privacy officer and contact</H2>
        <P>Person in charge of the protection of personal information: {officerEn}. Email: {contactEn}{i.supportPhone ? ` · Phone: ${i.supportPhone}` : ''}. Address: {i.company}, {i.address}.</P>

        <H2>10. Changes</H2>
        <P>We will post any change on this page with its update date.</P>
      </LangBlock>
    </article>
  );
}
