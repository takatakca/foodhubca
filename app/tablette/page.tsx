import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { TakatakMark } from '@/components/brand/takatak-mark';
import { TABLET_RELEASES_PAGE, tabletDownload } from '@/lib/foodhub/tablet-app';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Application tablette cuisine · Kitchen tablet app — Food Hub',
  robots: { index: false, follow: false },
};

// Public page (proxy.ts PUBLIC_PATHS): the owner opens it on a kitchen tablet, downloads the Food Hub tablet app
// (apps/kitchen-tablet, built by .github/workflows/android-tablet.yml) and follows the steps. French first, then English.
export default async function TablettePage() {
  const dl = await tabletDownload();
  const href = dl.kind === 'none' ? null : dl.url;
  const version = dl.kind === 'release' ? dl.release.version : null;
  const size = dl.kind === 'release' && dl.release.sizeBytes ? `${(dl.release.sizeBytes / 1_048_576).toFixed(1)} Mo / MB` : null;

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 font-extrabold tracking-tight">
          <TakatakMark size="sm" />
          Food Hub · Tablette cuisine / Kitchen tablet
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-8">
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <h1 className="text-2xl font-extrabold">Application tablette cuisine</h1>
          <p className="mt-1 text-ink-3">Kitchen tablet app</p>
          {href ? (
            <a href={href} className="mt-5 inline-flex min-h-14 items-center gap-2 rounded-xl bg-brand px-7 text-lg font-extrabold text-white" rel="noopener">
              <Download className="size-6" aria-hidden />
              Télécharger l’application · Download the app (APK)
            </a>
          ) : (
            <p className="mt-5 rounded-xl bg-wait-soft px-4 py-3 font-semibold">
              La première version n’est pas encore publiée. · The first version is not published yet.
            </p>
          )}
          <p className="mt-3 text-sm text-ink-3">
            {version ? `Version ${version}` : 'Android 8 ou plus récent · Android 8 or newer'}{size ? ` · ${size}` : ''} ·{' '}
            <a className="underline" href={TABLET_RELEASES_PAGE} rel="noopener">Toutes les versions · All versions</a>
          </p>
        </section>

        <section lang="fr" className="space-y-4">
          <h2 className="text-xl font-extrabold">Ce qu’elle fait</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Affiche l’écran cuisine Food Hub en plein écran, toujours allumé.</li>
            <li>Sonne fort à chaque nouvelle commande, même écran éteint, jusqu’à ce qu’on touche l’écran.</li>
            <li>Imprime chaque nouvelle commande sur l’imprimante thermique de la tablette (une seule fois), et un court billet « ANNULÉE » si une commande imprimée est annulée.</li>
          </ul>
          <h2 className="text-xl font-extrabold">Installer</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Sur la tablette, ouvrez cette page dans Chrome (<b>foodhub.on2go.ca/tablette</b>) et touchez <b>Télécharger</b>.</li>
            <li>Autorisez les sources inconnues : Android demande d’autoriser Chrome à installer des applications (Réglages → Applications → Chrome → <i>Installer des applications inconnues</i> → Autoriser). Si Play Protect avertit, touchez <i>Installer quand même</i>.</li>
            <li>Ouvrez le fichier <b>foodhub-tablet.apk</b> et touchez <b>Installer</b>, puis <b>Ouvrir</b>.</li>
            <li>Autorisez les notifications et, pour une imprimante Bluetooth, les <i>Appareils à proximité</i>.</li>
            <li>Connectez-vous avec le code de la tablette : une tablette enregistrée montre l’écran NIP — touchez votre nom et entrez votre NIP. Nouvelle tablette : un gérant se connecte une fois et l’enregistre dans Réglages → Tablettes. (La connexion Google ne marche pas dans l’application : utilisez le code reçu par courriel ou texto.)</li>
            <li>Jumelez l’imprimante dans les réglages Bluetooth d’Android (allumez-la, touchez son nom ; le code de jumelage est dans son manuel, souvent 0000 ou 1234).</li>
            <li>Dans l’application, touchez ⚙ (coin en bas à droite) : <b>Imprimante</b> → Bluetooth → choisissez-la (ou Réseau : son adresse IP, port 9100), papier <b>58</b> ou <b>80 mm</b>, puis <b>Enregistrer</b> et <b>Impression test</b>.</li>
            <li>Laissez la tablette branchée et touchez <b>Optimisation de la batterie</b> dans les réglages de l’application pour la désactiver : la tablette continue d’écouter les commandes écran éteint.</li>
          </ol>
          <p className="rounded-xl border border-line bg-surface p-4">
            <b>Pas d’imprimante ici ?</b> Clover continue d’imprimer par Clover. Là où une imprimante Clover imprime déjà les commandes, laissez l’impression Clover et désactivez <i>Impression automatique</i> dans l’application : la tablette sonne quand même.
          </p>
          <p className="text-sm text-ink-3">
            Imprimantes compatibles : ESC/POS 58 ou 80 mm en Bluetooth « classique » (SPP) ou en réseau (port 9100). Les imprimantes Bluetooth LE seulement et les imprimantes USB ne sont pas prises en charge.
            Mise à jour : si Android refuse d’installer la nouvelle version par-dessus l’ancienne, désinstallez l’ancienne d’abord (il faudra refaire les réglages).
          </p>
        </section>

        <section lang="en" className="space-y-4 border-t border-line pt-8">
          <h2 className="text-xl font-extrabold">What it does</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Shows the Food Hub kitchen screen full screen, always on.</li>
            <li>Rings loudly on every new order, even with the screen off, until someone taps the screen.</li>
            <li>Prints every new order on the tablet’s thermal printer (once), and a short “CANCELLED” ticket when a printed order is cancelled.</li>
          </ul>
          <h2 className="text-xl font-extrabold">Install</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>On the tablet, open this page in Chrome (<b>foodhub.on2go.ca/tablette</b>) and tap <b>Download</b>.</li>
            <li>Allow unknown sources: Android asks to let Chrome install apps (Settings → Apps → Chrome → <i>Install unknown apps</i> → Allow). If Play Protect warns, tap <i>Install anyway</i>.</li>
            <li>Open <b>foodhub-tablet.apk</b>, tap <b>Install</b>, then <b>Open</b>.</li>
            <li>Allow notifications and, for a Bluetooth printer, <i>Nearby devices</i>.</li>
            <li>Sign in with the tablet code: an enrolled tablet shows the PIN screen — tap your name and enter your PIN. New tablet: a manager signs in once and enrols it in Settings → Tablets. (Google sign-in does not work inside the app: use the code sent by email or text.)</li>
            <li>Pair the printer in Android’s Bluetooth settings (turn it on, tap its name; the pairing code is in its manual, often 0000 or 1234).</li>
            <li>In the app, tap ⚙ (bottom right corner): <b>Printer</b> → Bluetooth → pick it (or Network: its IP address, port 9100), paper <b>58</b> or <b>80 mm</b>, then <b>Save</b> and <b>Test print</b>.</li>
            <li>Keep the tablet plugged in and tap <b>Battery optimisation</b> in the app settings to turn it off: the tablet keeps listening for orders with the screen off.</li>
          </ol>
          <p className="rounded-xl border border-line bg-surface p-4">
            <b>No printer here?</b> Clover keeps printing through Clover. Where a Clover printer already prints the orders, keep Clover printing and turn <i>Auto-print</i> off in the app: the tablet still rings.
          </p>
          <p className="text-sm text-ink-3">
            Printers that work: ESC/POS 58 or 80 mm, Bluetooth “Classic” (SPP) or network (port 9100). Bluetooth-LE-only and USB printers are not supported.
            Updating: if Android refuses to install the new version over the old one, uninstall the old one first (the settings must be entered again).
          </p>
        </section>
      </main>
    </div>
  );
}
