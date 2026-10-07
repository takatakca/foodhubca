// Is FOODHUB_PUBLIC_URL fit for the Clover App Market (and the delivery platforms)?
// Clover needs an HTTPS Site URL; its redirect and webhook URLs live under it, and a change of Site URL after
// approval goes back to Clover's review. A free "<ip>.sslip.io" address works for a first install, but the listing
// should go out on the company's own domain (e.g. https://foodhub.takatak.ca). Nothing here is hard-coded: every
// URL Food Hub shows is built from FOODHUB_PUBLIC_URL.
import { stripSlash } from './config';

export type PublicUrlProblem = 'unset' | 'not_https' | 'ip_address' | 'wildcard_dns' | 'local' | 'example' | 'clover_in_name' | 'path';

export interface PublicUrlCheck {
  url: string;
  host: string;
  /** Good enough for a Clover App Market submission. */
  ready: boolean;
  problems: PublicUrlProblem[];
}

const WILDCARD_DNS = /\.(sslip\.io|nip\.io|xip\.io|traefik\.me|localtest\.me)$/i;

export function publicUrlCheck(raw = process.env.FOODHUB_PUBLIC_URL): PublicUrlCheck {
  const url = raw ? stripSlash(raw.trim()) : '';
  const problems: PublicUrlProblem[] = [];
  let host = '';
  if (!raw) problems.push('unset');
  else {
    try {
      const u = new URL(url);
      host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:') problems.push('not_https');
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) problems.push('ip_address');
      if (WILDCARD_DNS.test(host)) problems.push('wildcard_dns');
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test')) problems.push('local');
      if (host.endsWith('.example') || host === 'example.com' || host.endsWith('.example.com')) problems.push('example');
      // Clover's listing rules: "Clover" may not appear in the app name, website name or support email domain.
      if (/clover/i.test(host)) problems.push('clover_in_name');
      if (u.pathname !== '/' && u.pathname !== '') problems.push('path');
    } catch {
      problems.push('not_https');
    }
  }
  return { url, host, ready: problems.length === 0, problems };
}

/** One line per problem, French and English, for Go-live and Settings → Clover app. */
export const PUBLIC_URL_PROBLEM_TEXT: Record<PublicUrlProblem, { fr: string; en: string }> = {
  unset: { fr: 'FOODHUB_PUBLIC_URL n’est pas défini (npm run setup).', en: 'FOODHUB_PUBLIC_URL is not set (npm run setup).' },
  not_https: { fr: 'L’adresse doit commencer par https://.', en: 'The address must start with https://.' },
  ip_address: { fr: 'Une adresse IP ne convient pas : utilisez un nom de domaine.', en: 'An IP address will not do: use a domain name.' },
  wildcard_dns: { fr: 'Adresse temporaire (sslip.io / nip.io) : pointez votre propre domaine, p. ex. foodhub.takatak.ca, vers le serveur.', en: 'Temporary address (sslip.io / nip.io): point your own domain, e.g. foodhub.takatak.ca, at the server.' },
  local: { fr: 'Adresse locale : Clover ne peut pas la joindre.', en: 'Local address: Clover cannot reach it.' },
  example: { fr: 'Adresse d’exemple : remplacez-la par votre domaine.', en: 'Example address: replace it with your domain.' },
  clover_in_name: { fr: 'Clover interdit le mot « Clover » dans le nom du site.', en: 'Clover does not allow the word “Clover” in the website name.' },
  path: { fr: 'Donnez seulement le domaine, sans chemin (https://foodhub.exemple.ca).', en: 'Give the domain only, without a path (https://foodhub.example.ca).' },
};
