// One list of platform screens (screens.json) → one docker-compose file for N screens. Pure functions, no I/O:
// validateScreens() checks the list, buildCompose() builds the compose document, toYaml() writes it out.
// Per web screen: a Chromium with its web view and a persistent profile + an agent (agent.mjs) on the same network,
// so the agent reaches Chrome's debugging port on 127.0.0.1. Per Android screen (profile "android"): an Android
// container with the Play Store and a web view of its screen + agent/android.mjs on the same network (adb on 127.0.0.1).
// Values that must stay out of git (Food Hub token, view password, screen ids) are read from .env at run time.
// Guide: docs/PLATFORM_SCREENS_RELAY.md.

// Package names are the platforms' ORDER apps on Google Play (checked 2026-10-29): "DoorDash Order Manager",
// "Uber Eats Order Manager" (not the Uber "Manager" analytics app), "Skip - Partner".
export const PLATFORMS = Object.freeze({
  uber: { label: 'Uber Eats', startUrl: 'https://merchants.ubereats.com/manager/orders', package: 'com.uber.restaurants' },
  doordash: { label: 'DoorDash', startUrl: 'https://order.doordash.com/', package: 'com.dd.ddmerchant' },
  // Same start page as Food Hub's (FOODHUB_SCREEN_START_SKIP); Skip's live orders may only be on its Partner app (Android).
  skip: { label: 'Skip', startUrl: 'https://restaurants.skipthedishes.com/', package: 'ca.skipthedishes.dashboard' },
});
export const MODES = Object.freeze(['web', 'android']);
export const WEB_VIEW_PORT_BASE = 3100;      // host port of screen n's web view = 3100 + n (first screen = 3101)
export const ANDROID_VIEW_PORT_BASE = 6080;  // host port of Android screen n's web view = 6080 + n
export const CHROMIUM_IMAGE = 'lscr.io/linuxserver/chromium:latest';
// The Play Store needs a "google_apis_playstore" system image, which the public budtmo/docker-android images do NOT
// ship. The relay host builds this image once with Google's own scripts (the owner accepts the Android SDK licence):
//   github.com/google/android-emulator-container-scripts → emu-docker create <emulator zip> <google_apis_playstore x86_64 33 zip>
//   docker build -t foodhub/android-playstore:33 <dest>
// Pass another name with --android-image when the host built it under a different tag.
export const ANDROID_IMAGE = 'foodhub/android-playstore:33';
export const MAX_SCREENS = 99; // e.g. 18 DoorDash + 18 Uber Eats + 18 Skip = 54, one account each

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const ENV_REF_RE = /^SCREEN_ID_[A-Z0-9_]{1,40}$/;
// Anything that looks like a sign-in secret is refused, whatever the key is called.
const SECRET_KEY_RE = /(pass(word|wd)?|pwd|secret|token|api[_-]?key|credential|otp|2fa|sms[_-]?code|cookie|session)/i;
const SECRET_VALUE_RE = /(^|[^A-Za-z0-9])(pass(word|wd)?|pwd|token|secret|otp)\s*[:=]/i;
const USER_KEY_RE = /^(user(name)?|login|email|e-mail|account|phone|tel)$/i;

/** Service name from a screen id: "SCREEN_ID_UBER_1" → "uber-1", "doordash-2" stays. */
export function serviceName(id) {
  return String(id).replace(/^SCREEN_ID_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Food Hub's numbered screens ("Set up screens": s01, s02…): the id IS the screen's id in Food Hub, so it is written as
 * is and needs no .env line. Contract v2.1 in docs/ORDER_SCREENS_RESCUE.md.
 */
export const SLOT_ID_RE = /^s\d{2}$/;

/** What the agent's SCREEN_ID is set to: the slot id itself, or the .env variable that holds the Food Hub id. */
export const screenIdValue = (id) => (SLOT_ID_RE.test(id) ? id : `\${${envVarFor(id)}}`);

/** The .env variable that holds this screen's Food Hub id ("SCREEN_ID_UBER_1" stays; "uber-1" → "SCREEN_ID_UBER_1"). */
export function envVarFor(id) {
  return ENV_REF_RE.test(id) ? id : `SCREEN_ID_${serviceName(id).toUpperCase().replace(/-/g, '_')}`;
}

/** True for a bare secret-looking string: "password=…", "token: …", or a long opaque token (not an address). */
function hasCredential(value) {
  if (value == null) return false;
  if (typeof value === 'string') return SECRET_VALUE_RE.test(value) || (value.length > 60 && /^[A-Za-z0-9+/=_-]+$/.test(value));
  if (Array.isArray(value)) return value.some(hasCredential);
  if (typeof value === 'object') return Object.entries(value).some(([k, v]) => SECRET_KEY_RE.test(k) || USER_KEY_RE.test(k) || hasCredential(v));
  return false;
}

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'is not a valid address'; }
  if (u.protocol !== 'https:') return 'must start with https://';
  if (u.username || u.password) return 'must not carry a user name or password';
  return null;
}

/**
 * Validate the list. Returns { screens } (normalized) or { errors: [string] }. Never throws on bad input.
 * Each screen: id (letters, digits, - _), platform (uber|doordash|skip), name (≤ 60), mode (web|android),
 * startUrl (https, web only; default per platform), package (Android only; default per platform).
 */
export function validateScreens(input) {
  const errors = [];
  const list = Array.isArray(input) ? input : input && Array.isArray(input.screens) ? input.screens : null;
  if (!list) return { errors: ['the file must contain {"screens": [ … ]}'] };
  if (list.length === 0) return { errors: ['the list is empty'] };
  if (list.length > MAX_SCREENS) return { errors: [`at most ${MAX_SCREENS} screens per host`] };
  const seenIds = new Set(); const seenNames = new Set(); const screens = [];
  list.forEach((raw, i) => {
    const at = `screen ${i + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${at}: must be an object`); return; }
    if (hasCredential(raw)) { errors.push(`${at}: carries a user name, password, token or code — refused. The owner signs in inside the screen.`); return; }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!ID_RE.test(id)) errors.push(`${at}: id must be 2–64 letters, digits, - or _`);
    else if (seenIds.has(id.toLowerCase())) errors.push(`${at}: id "${id}" is used twice`);
    seenIds.add(id.toLowerCase());
    const platform = typeof raw.platform === 'string' ? raw.platform.trim().toLowerCase() : '';
    if (!PLATFORMS[platform]) errors.push(`${at}: platform must be one of ${Object.keys(PLATFORMS).join(', ')}`);
    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60) errors.push(`${at}: name is required (≤ 60 characters)`);
    else if (seenNames.has(name.toLowerCase())) errors.push(`${at}: name "${name}" is used twice`);
    seenNames.add(name.toLowerCase());
    const mode = raw.mode == null ? 'web' : String(raw.mode).trim().toLowerCase();
    if (!MODES.includes(mode)) errors.push(`${at}: mode must be web or android`);
    const p = PLATFORMS[platform];
    let startUrl = null, pkg = null;
    if (mode === 'web') {
      startUrl = typeof raw.startUrl === 'string' && raw.startUrl.trim() ? raw.startUrl.trim() : p?.startUrl ?? null;
      const bad = startUrl ? checkUrl(startUrl) : 'startUrl is required';
      if (bad) errors.push(`${at}: startUrl ${bad}`);
      if (raw.package != null) errors.push(`${at}: package is only for mode android`);
    } else {
      pkg = typeof raw.package === 'string' && raw.package.trim() ? raw.package.trim() : p?.package ?? null;
      if (!pkg || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(pkg)) errors.push(`${at}: package must be an Android package name (e.g. com.example.app)`);
      if (raw.startUrl != null) errors.push(`${at}: startUrl is only for mode web`);
    }
    const unknown = Object.keys(raw).filter((k) => !['id', 'platform', 'name', 'mode', 'startUrl', 'package'].includes(k));
    if (unknown.length) errors.push(`${at}: unknown field(s) ${unknown.join(', ')}`);
    screens.push({ id, platform, name, mode, startUrl, package: pkg });
  });
  return errors.length ? { errors } : { screens };
}

/** Compose document (plain object) for the validated screens. Deterministic: same list → same document. */
export function buildCompose(screens, opts = {}) {
  const tz = opts.timezone ?? 'America/Toronto';
  const services = {};
  const volumes = {};
  let web = 0, android = 0;
  for (const s of screens) {
    const svc = serviceName(s.id);
    const agentEnv = { FOODHUB_URL: '${FOODHUB_URL}', FOODHUB_SCREENS_AGENT_TOKEN: '${FOODHUB_SCREENS_AGENT_TOKEN}', SCREEN_ID: screenIdValue(s.id) };
    if (s.mode === 'web') {
      web++;
      services[svc] = {
        image: CHROMIUM_IMAGE, restart: 'unless-stopped', shm_size: '1gb', security_opt: ['seccomp:unconfined'],
        environment: {
          PUID: '1000', PGID: '1000', TZ: tz, CUSTOM_USER: '${SCREENS_VIEW_USER}', PASSWORD: '${SCREENS_VIEW_PASSWORD}',
          TITLE: s.name, CHROME_CLI: `--remote-debugging-port=9222 ${s.startUrl}`,
          // The web view answers under /<screen>/ (e.g. /s01/), so one https address serves every screen:
          // https://screens.<domain>/s01/ → 127.0.0.1:3101, path kept as is (no prefix stripping).
          SUBFOLDER: `/${svc}/`,
        },
        volumes: [`./profiles/${svc}:/config`],
        // A numbered screen keeps its number on every host (s19 → 3119), so a list can be split across hosts.
        ports: [`127.0.0.1:${WEB_VIEW_PORT_BASE + (SLOT_ID_RE.test(s.id) ? Number(s.id.slice(1)) : web)}:3001`],
      };
      services[`${svc}-agent`] = {
        build: './agent', restart: 'unless-stopped', network_mode: `service:${svc}`,
        environment: { ...agentEnv, SCREEN_START_URL: s.startUrl },
      };
    } else {
      android++;
      // Google's emulator image: /dev/kvm only (never privileged), the device's data in a NAMED volume (a bind mount
      // would hide the image's own files), the adb key shared with the agent (or adbd answers "unauthorized").
      // ADBKEY is the private adb key, read from the shell: ADBKEY="$(cat adbkey)" docker compose --profile android up -d
      services[svc] = {
        image: opts.androidImage ?? ANDROID_IMAGE, restart: 'unless-stopped', profiles: ['android'], shm_size: '2gb',
        devices: ['/dev/kvm:/dev/kvm'],
        environment: ['ADBKEY', `TZ=${tz}`],
        volumes: [`${svc}-data:/data`],
        ports: [`127.0.0.1:${ANDROID_VIEW_PORT_BASE + android}:8554`],
      };
      volumes[`${svc}-data`] = {};
      services[`${svc}-agent`] = {
        build: { context: './agent', dockerfile: 'Dockerfile.android' }, restart: 'unless-stopped', profiles: ['android'], network_mode: `service:${svc}`,
        environment: { ...agentEnv, ANDROID_PACKAGE: s.package, ADB_HOST: '127.0.0.1' },
        volumes: ['./adbkey:/home/node/.android/adbkey:ro'],
      };
    }
  }
  // One address for every web screen: the gateway (gateway/gateway.mjs) routes /sNN/ to each screen with its path kept,
  // lets only Food Hub frame them (FOODHUB_ORIGIN) and asks the view password once. Point the host's https domain at it.
  const webScreens = screens.filter((s) => s.mode === 'web').map((s) => serviceName(s.id));
  if (webScreens.length) {
    services.gateway = {
      build: './gateway', restart: 'unless-stopped',
      environment: {
        SCREENS: webScreens.join(','), FOODHUB_ORIGIN: '${FOODHUB_ORIGIN}',
        SCREENS_VIEW_USER: '${SCREENS_VIEW_USER}', SCREENS_VIEW_PASSWORD: '${SCREENS_VIEW_PASSWORD}',
      },
      ports: [`127.0.0.1:${WEB_VIEW_PORT_BASE}:8080`],
    };
  }
  return { services, volumes, counts: { web, android } };
}

const yamlScalar = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_./:@-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^\d/.test(s) ? s : JSON.stringify(s);
};
function yamlNode(v, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) return v.map((x) => `${pad}- ${typeof x === 'object' ? yamlNode(x, indent + 2).trimStart() : yamlScalar(x)}`).join('\n');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => (x && typeof x === 'object' ? `${pad}${k}:\n${yamlNode(x, indent + 2)}` : `${pad}${k}: ${yamlScalar(x)}`)).join('\n');
  return `${pad}${yamlScalar(v)}`;
}

/** Serialize the compose document as YAML, with the header that explains it. */
export function toYaml(doc, { source = 'screens.json', screens = [] } = {}) {
  const head = [
    `# Generated by deploy/screens/generate.mjs from ${source} — do not edit by hand, edit the list and run it again.`,
    `# ${doc.counts.web} web screen(s), ${doc.counts.android} Android screen(s). Values come from .env (never commit it).`,
    '# Android screens are in the compose profile "android": docker compose --profile android up -d (needs a Linux host with KVM).',
    `# One address for all web screens: point the https domain (e.g. https://ecrans.on2go.ca) at the gateway, 127.0.0.1:${WEB_VIEW_PORT_BASE}.`,
    ...screens.map((s) => `#   ${serviceName(s.id)} = ${PLATFORMS[s.platform].label} "${s.name}" (${s.mode}) → ${SLOT_ID_RE.test(s.id) ? `Food Hub screen ${s.id}` : `.env ${envVarFor(s.id)}`}`),
    '',
  ].join('\n');
  const vols = Object.keys(doc.volumes ?? {}).length ? `volumes:\n${yamlNode(doc.volumes, 2)}\n` : '';
  return `${head}services:\n${yamlNode(doc.services, 2)}\n${vols}`;
}

/** The .env lines a host needs for this list (names only, no values). */
export function envTemplate(screens) {
  const lines = [
    '# Copy to .env on the relay host (never commit .env). Names only here.',
    'FOODHUB_URL=https://foodhub.on2go.ca',
    '# Food Hub address(es) allowed to show the screens in a frame (the gateway). Comma-separated https origins.',
    'FOODHUB_ORIGIN=https://foodhub.on2go.ca',
    '# Same value as FOODHUB_SCREENS_AGENT_TOKEN on Food Hub (Coolify). 24+ random characters: openssl rand -hex 24',
    'FOODHUB_SCREENS_AGENT_TOKEN=',
    '# Web-view sign-in of the relay host itself (not a platform password).',
    'SCREENS_VIEW_USER=',
    'SCREENS_VIEW_PASSWORD=',
    ...(screens.some((s) => !SLOT_ID_RE.test(s.id)) ? ['# Screen ids shown in Food Hub → Stores → Platform screens → edit (one per screen).'] : []),
    ...screens.filter((s) => !SLOT_ID_RE.test(s.id)).map((s) => `${envVarFor(s.id)}=`),
    ...(screens.some((s) => SLOT_ID_RE.test(s.id)) ? ['# Numbered screens (s01, s02…) use their own id: nothing to fill in for them.'] : []),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Keep only the numbered screens in a range, "s19-s36" (one relay host's share of a big list). Other ids are kept.
 * Returns the list unchanged when the range is empty, or null when it is not a range.
 */
export function pickRange(input, range) {
  const r = String(range ?? '').trim();
  if (!r) return input;
  const m = /^s(\d{2})-s(\d{2})$/.exec(r);
  if (!m || Number(m[1]) > Number(m[2])) return null;
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  const list = Array.isArray(input) ? input : input?.screens;
  if (!Array.isArray(list)) return input;
  const kept = list.filter((s) => !SLOT_ID_RE.test(String(s?.id ?? '')) || (Number(String(s.id).slice(1)) >= lo && Number(String(s.id).slice(1)) <= hi));
  return Array.isArray(input) ? kept : { ...input, screens: kept };
}

/** Validate + build + serialize in one go. Returns { yaml, env, screens, counts } or { errors }. */
export function generate(input, opts = {}) {
  const v = validateScreens(input);
  if ('errors' in v) return v;
  const doc = buildCompose(v.screens, opts);
  return { yaml: toYaml(doc, { source: opts.source, screens: v.screens }), env: envTemplate(v.screens), screens: v.screens, counts: doc.counts };
}
