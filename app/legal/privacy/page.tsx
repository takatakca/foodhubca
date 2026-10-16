import type { Metadata } from 'next';
import { legalInfo } from '@/lib/foodhub/legal';
import { Divider, H1, H2, LangBlock, LangSwitch, P, UL } from '../prose';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Politique de confidentialité · Privacy policy — TAKATAK Food Hub' };

// Privacy policy (French first — Charter of the French language; Québec Law 25 and PIPEDA topics covered).
// DRAFT until FOODHUB_LEGAL_APPROVED=true: it describes what the code actually does (orders, Clover, phone lines,
// texts, direct orders, couriers), but the owner and a legal adviser must confirm it before the app is submitted to
// the Clover App Market. Company, address, phone, email and officer come from FOODHUB_* env (lib/foodhub/legal.ts).
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
        <P>{i.appName} (« Food Hub ») est le logiciel de gestion des commandes de {i.company} ({i.address}). Il réunit sur un seul écran les commandes Uber Eats, DoorDash, SkipTheDishes et Too Good To Go, les envoie à la caisse Clover du restaurant, garde les menus et les ruptures de stock à jour sur chaque plateforme et rapproche les paiements des plateformes. Il gère aussi les commandes directes des restaurants (site Web, téléphone et Clover Online Ordering), leurs lignes téléphoniques (assistant téléphonique automatisé et messagerie vocale), les textos envoyés aux clients (confirmation, suivi de livraison, lien de paiement) et la page de nos livreurs. La présente politique s’applique au site Web de Food Hub, à ces lignes téléphoniques et textos, à la page des livreurs et à l’application Clover « TAKATAK Food Hub ».</P>

        <H2>2. Renseignements que nous traitons</H2>
        <UL>
          <li><b>Marchands Clover qui branchent l’application :</b> identifiant, nom, adresse et ville du marchand, inventaire (articles, catégories, modificateurs, prix, stock), commandes et paiements que Food Hub crée dans Clover, commandes Clover Online Ordering (avec le nom du client), paiements et remboursements enregistrés dans Clover, ventes du jour pour le rapprochement, et les jetons d’accès Clover (conservés uniquement sur notre serveur, jamais affichés ni transmis à des tiers). À l’ouverture de l’application, Food Hub fait aussi un relevé en lecture seule de la caisse (nombre d’articles, de catégories, de types de commande, de modes de paiement et d’appareils) et lit l’état de l’abonnement à l’application dans le Clover App Market, pour préremplir la page d’accueil.</li>
          <li><b>Commandes des plateformes de livraison :</b> prénom ou nom du client, numéro de téléphone fourni par la plateforme (souvent un numéro relais), adresse de livraison si la plateforme la transmet, contenu de la commande, instructions spéciales, montants, état de la commande et renseignements sur le livreur.</li>
          <li><b>Appels téléphoniques et messagerie vocale :</b> numéro de l’appelant, transcription de l’appel (la parole est convertie en texte), commande ou demande faite pendant l’appel, durée et issue de l’appel et, lorsque l’appelant laisse un message, l’enregistrement de la messagerie vocale et sa transcription. L’appelant peut faire le 0 pour parler à une personne.</li>
          <li><b>Clients des commandes directes</b> (site Web, téléphone, Clover Online Ordering) : nom, numéro de téléphone, adresse de livraison, contenu et montant de la commande, état du paiement et textos envoyés (confirmation, suivi de livraison, lien de paiement). Le paiement se fait sur la page de paiement sécurisée de Clover.</li>
          <li><b>Livreurs :</b> nom, numéro de téléphone, disponibilité (en service ou non), cuisines desservies, livraisons confiées et leur état. Pour une livraison confiée à DoorDash Drive, Uber Direct ou SkipTheDishes, nous recevons du service de livraison les renseignements sur le livreur et l’état de la livraison.</li>
          <li><b>Équipe du restaurant :</b> nom, courriel ou numéro de cellulaire (pour les codes de connexion), rôle, NIP de gérant (conservé sous forme hachée, jamais en clair), journal des actions et des tentatives de connexion, et l’état des tablettes de cuisine.</li>
          <li><b>Nous ne demandons jamais de numéro de carte de paiement</b>, ni en ligne ni au téléphone. Les paiements sont traités par Clover et par les plateformes ; Food Hub n’enregistre dans Clover que le mode de paiement et le montant.</li>
        </UL>

        <H2>3. Pourquoi nous les utilisons</H2>
        <UL>
          <li>Recevoir, accepter, préparer, livrer et suivre les commandes, et les envoyer à la caisse et à l’imprimante de la cuisine.</li>
          <li>Répondre aux appels, prendre les commandes au téléphone, transmettre les messages vocaux au restaurant et envoyer aux clients les textos liés à leur commande.</li>
          <li>Publier les menus, les prix, les heures et les ruptures de stock sur les plateformes que le restaurant a branchées.</li>
          <li>Vérifier les paiements des plateformes, préparer les rapports et le registre interne (sans rien approuver ni comptabiliser automatiquement).</li>
          <li>Assurer la sécurité du service (connexion, journal d’activité, détection d’anomalies).</li>
        </UL>
        <P>Nous ne vendons aucun renseignement personnel et ne les utilisons pas à des fins publicitaires.</P>

        <H2>4. Avec qui nous les partageons</H2>
        <UL>
          <li>Les plateformes que le restaurant a branchées (Uber Eats, DoorDash, SkipTheDishes / Just Eat Takeaway, Too Good To Go) et Clover, uniquement pour traiter les commandes, les paiements et les menus.</li>
          <li>Les services de livraison que le restaurant utilise pour ses commandes directes (DoorDash Drive, Uber Direct, SkipTheDishes) : nom et numéro du client, adresse de livraison et contenu de la commande, uniquement pour effectuer la livraison.</li>
          <li>Nos fournisseurs techniques, liés par des obligations de confidentialité :
            <UL>
              <li>hébergement du serveur (Contabo) et base de données (Supabase) ;</li>
              <li>Twilio : appels, conversion de la parole en texte, enregistrements de la messagerie vocale et textos (connexion, commandes, liens de paiement) ;</li>
              <li>Google, par l’intermédiaire de Twilio : reconnaissance de la parole et voix de l’assistant téléphonique ;</li>
              <li>Anthropic (Claude) : l’assistant téléphonique, qui comprend la demande de l’appelant et y répond, et, si le propriétaire l’active, l’assistant d’analyse, qui reçoit un résumé des données de l’entreprise. Ni l’un ni l’autre n’approuve de remboursement ou de paiement ;</li>
              <li>envoi des courriels (Resend, ou le serveur de courriel de l’entreprise hébergé chez MochaHost) ;</li>
              <li>alertes de l’équipe dans sa messagerie d’équipe (par exemple Slack, Microsoft Teams, Google Chat ou Discord), si le restaurant les active.</li>
            </UL>
          </li>
          <li>Les autorités, lorsque la loi l’exige.</li>
        </UL>

        <H2>5. Où sont conservés les renseignements</H2>
        <P>La base de données est hébergée à Montréal (Canada). Le serveur de l’application et les services de Twilio, d’Anthropic et de Google traitent les renseignements aux États-Unis. Clover, les plateformes et les services de livraison les traitent selon leurs propres politiques.</P>

        <H2>6. Durée de conservation</H2>
        <P>Nous conservons les renseignements le temps nécessaire aux fins ci-dessus. Sur demande, nous supprimons vos renseignements (y compris les transcriptions d’appels et les enregistrements de la messagerie vocale) dans les 30 jours, sauf les données de vente que nos obligations comptables et fiscales nous obligent à garder (en général six ans). Les jetons d’accès Clover d’un marchand sont supprimés lorsque Clover nous avise de la désinstallation de l’application, ou sur demande.</P>

        <H2>7. Sécurité</H2>
        <P>L’accès est réservé aux membres de l’équipe autorisés (codes de connexion à usage unique, rôles et permissions), les échanges se font en HTTPS, les secrets restent sur le serveur et chaque action importante est journalisée. En cas d’incident de confidentialité présentant un risque de préjudice sérieux, nous avisons la Commission d’accès à l’information et les personnes concernées.</P>

        <H2>8. Vos droits</H2>
        <P>Vous pouvez demander l’accès à vos renseignements, leur rectification, leur suppression, leur portabilité, retirer votre consentement ou demander la fin de leur diffusion, et nous adresser une plainte, en écrivant à notre responsable de la protection des renseignements personnels (coordonnées à la section 11). Nous répondons par écrit dans les 30 jours. Au téléphone, faites le 0 pour parler à une personne. Si vous n’êtes pas satisfait de notre réponse, vous pouvez vous adresser à la Commission d’accès à l’information du Québec ou au Commissariat à la protection de la vie privée du Canada.</P>

        <H2>9. Témoins (cookies)</H2>
        <P>Food Hub n’utilise que des témoins nécessaires à son fonctionnement : un témoin de session signé (connexion), un témoin de tablette de cuisine et un témoin de langue. Aucun témoin publicitaire ni outil de mesure d’audience de tiers n’est utilisé.</P>

        <H2>10. Marchands et utilisateurs aux États-Unis</H2>
        <P>Pour un marchand situé aux États-Unis, nous agissons comme fournisseur de services de ce marchand : nous traitons les renseignements de ses clients uniquement pour fournir le service, nous ne les vendons pas et ne les partageons pas à des fins de publicité ciblée. Les droits que vous accordent les lois de votre État (accès, correction, suppression) s’exercent en nous écrivant à l’adresse ci-dessous ; nous répondons dans les délais que ces lois prévoient.</P>

        <H2>11. Responsable et coordonnées</H2>
        <P>Responsable de la protection des renseignements personnels : {officerFr}. Courriel : {contactFr}{i.supportPhone ? ` · Téléphone : ${i.supportPhone}` : ''}. Adresse : {i.company}, {i.address}.</P>

        <H2>12. Modifications</H2>
        <P>Nous publierons toute modification sur cette page, avec sa date de mise à jour.</P>
      </LangBlock>

      <Divider />

      <LangBlock id="en">
        <H2>1. Who we are</H2>
        <P>{i.appName} (“Food Hub”) is the order-management software of {i.company} ({i.address}). It brings Uber Eats, DoorDash, SkipTheDishes and Too Good To Go orders onto one screen, sends them to the restaurant’s Clover POS, keeps menus and sold-out items up to date on each platform and reconciles platform payouts. It also handles the restaurants’ direct orders (website, phone and Clover Online Ordering), their phone lines (automated phone assistant and voicemail), the texts sent to customers (confirmation, delivery tracking, payment link) and our couriers’ page. This policy covers the Food Hub website, these phone lines and texts, the couriers’ page and the “TAKATAK Food Hub” Clover app. The French version prevails.</P>

        <H2>2. Information we process</H2>
        <UL>
          <li><b>Clover merchants who connect the app:</b> merchant ID, name, address and city, inventory (items, categories, modifiers, prices, stock), the orders and payments Food Hub creates in Clover, Clover Online Ordering orders (with the customer’s name), payments and refunds recorded in Clover, daily sales for reconciliation, and Clover access tokens (kept only on our server, never displayed or shared with third parties). When the app is opened, Food Hub also takes a read-only snapshot of the register (number of items, categories, order types, tenders and devices) and reads the app’s Clover App Market subscription status, to pre-fill the welcome page.</li>
          <li><b>Delivery platform orders:</b> customer first name or name, the phone number provided by the platform (often a relay number), delivery address when the platform sends it, order contents, special instructions, amounts, order status and courier details.</li>
          <li><b>Phone calls and voicemail:</b> the caller’s number, the call transcript (speech is converted to text), the order or request made during the call, the call’s length and outcome and, when the caller leaves a message, the voicemail recording and its transcript. Callers can press 0 to speak with a person.</li>
          <li><b>Direct-order customers</b> (website, phone, Clover Online Ordering): name, phone number, delivery address, order contents and amount, payment status and the texts sent (confirmation, delivery tracking, payment link). Payment happens on Clover’s secure payment page.</li>
          <li><b>Couriers:</b> name, phone number, availability (on shift or not), kitchens served, deliveries assigned and their status. For a delivery handed to DoorDash Drive, Uber Direct or SkipTheDishes, we receive the courier details and the delivery status from that delivery service.</li>
          <li><b>Restaurant team:</b> name, email or mobile number (for sign-in codes), role, manager PIN (stored hashed), activity and sign-in log, and kitchen tablet status.</li>
          <li><b>We never ask for payment card numbers</b>, online or by phone. Payments are processed by Clover and the platforms; Food Hub only records the tender type and amount in Clover.</li>
        </UL>

        <H2>3. Why we use it</H2>
        <UL>
          <li>To receive, accept, prepare, deliver and track orders, and send them to the register and the kitchen printer.</li>
          <li>To answer calls, take phone orders, pass voicemails on to the restaurant and send customers the texts about their order.</li>
          <li>To publish menus, prices, hours and sold-out items on the platforms the restaurant connected.</li>
          <li>To check platform payouts and prepare reports and the internal ledger (nothing is approved or posted automatically).</li>
          <li>To keep the service secure (sign-in, activity log, anomaly detection).</li>
        </UL>
        <P>We do not sell personal information and do not use it for advertising.</P>

        <H2>4. Who we share it with</H2>
        <UL>
          <li>The platforms the restaurant connected (Uber Eats, DoorDash, SkipTheDishes / Just Eat Takeaway, Too Good To Go) and Clover, only to process orders, payments and menus.</li>
          <li>The delivery services the restaurant uses for its direct orders (DoorDash Drive, Uber Direct, SkipTheDishes): the customer’s name and number, delivery address and order contents, only to make the delivery.</li>
          <li>Our technical providers, bound by confidentiality:
            <UL>
              <li>server hosting (Contabo) and database (Supabase);</li>
              <li>Twilio: calls, speech-to-text, voicemail recordings and texts (sign-in, orders, payment links);</li>
              <li>Google, through Twilio: speech recognition and the phone assistant’s voices;</li>
              <li>Anthropic (Claude): the phone assistant, which understands and answers the caller’s request, and, if the owner turns it on, the analysis assistant, which receives a summary of business data. Neither one approves refunds or payments;</li>
              <li>email delivery (Resend, or the company’s own mail server hosted by MochaHost);</li>
              <li>team alerts in the team’s chat (for example Slack, Microsoft Teams, Google Chat or Discord), when the restaurant turns them on.</li>
            </UL>
          </li>
          <li>Authorities, when the law requires it.</li>
        </UL>

        <H2>5. Where it is stored</H2>
        <P>The database is hosted in Montréal (Canada). The application server and the Twilio, Anthropic and Google services process information in the United States. Clover, the platforms and the delivery services process it under their own policies.</P>

        <H2>6. How long we keep it</H2>
        <P>We keep information for as long as needed for the purposes above. On request, we delete your information (including call transcripts and voicemail recordings) within 30 days, except the sales data our accounting and tax obligations require us to keep (generally six years). A merchant’s Clover access tokens are deleted when Clover notifies us that the app was uninstalled, or on request.</P>

        <H2>7. Security</H2>
        <P>Access is limited to authorized team members (one-time sign-in codes, roles and permissions), traffic uses HTTPS, secrets stay on the server and every important action is logged. If a confidentiality incident presents a risk of serious injury, we notify the Commission d’accès à l’information and the people concerned.</P>

        <H2>8. Your rights</H2>
        <P>You may ask to access, correct, delete or port your information, withdraw consent or ask us to stop disseminating it, and make a complaint, by writing to our privacy officer (contact details in section 11). We answer in writing within 30 days. On the phone, press 0 to speak with a person. If you are not satisfied with our answer, you may contact the Commission d’accès à l’information du Québec or the Office of the Privacy Commissioner of Canada.</P>

        <H2>9. Cookies</H2>
        <P>Food Hub only uses cookies it needs to work: a signed session cookie (sign-in), a kitchen-tablet cookie and a language cookie. No advertising cookies and no third-party analytics are used.</P>

        <H2>10. Merchants and users in the United States</H2>
        <P>For a merchant located in the United States, we act as that merchant’s service provider: we process its customers’ information only to provide the service, we do not sell it and we do not share it for targeted advertising. You may exercise the rights your state’s laws give you (access, correction, deletion) by writing to us at the address below; we answer within the time those laws allow.</P>

        <H2>11. Privacy officer and contact</H2>
        <P>Person in charge of the protection of personal information: {officerEn}. Email: {contactEn}{i.supportPhone ? ` · Phone: ${i.supportPhone}` : ''}. Address: {i.company}, {i.address}.</P>

        <H2>12. Changes</H2>
        <P>We will post any change on this page with its update date.</P>
      </LangBlock>
    </article>
  );
}
