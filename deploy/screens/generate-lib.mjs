// One list of platform screens (screens.json) → one docker-compose file for N screens. Pure functions, no I/O:
// validateScreens() checks the list, buildCompose() builds the compose document, toYaml() writes it out.
// Per web screen: a Chromium with its web view and a persistent profile + an agent (agent.mjs) on the same network,
// so the agent reaches Chrome's debugging port on 127.0.0.1. Per Android screen (profile "android"): an Android
// container with the Play Store and a web view of its screen + agent/android.mjs on the same network (adb on 127.0.0.1).
// Values that must stay out of git (Food Hub token, view password, screen ids) are read from .env at run time.
// Guide: docs/PLATFORM_SCREENS_RELAY.md.

export const PLATFORMS = Object.freeze({
  uber: { label: 'Uber Eats', startUrl: 'https://merchants.ubereats.com/manager/orders', package: 'com.ubercab.restaurantmanager' },
  doordash: { label: 'DoorDash', startUrl: 'https://order.doordash.com/', package: 'com.doordash.merchant' },
  skip: { label: 'Skip', startUrl: 'https://partner.skipthedishes.com/', package: 'com.skipthedishes.partner' },
});
export const MODES = Object.freeze(['web', 'android']);
export const WEB_VIEW_PORT_BASE = 3100;      // host port of screen n's web view = 3100 + n (first screen = 3101)
export const ANDROID_VIEW_PORT_BASE = 6080;  // host port of Android screen n's web view = 6080 + n
export const CHROMIUM_IMAGE = 'lscr.io/linuxserver/chromium:latest';
export const ANDROID_IMAGE = 'budtmo/docker-android:emulator_14.0';
export const MAX_SCREENS = 50;

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
  let web = 0, android = 0;
  for (const s of screens) {
    const svc = serviceName(s.id); const envVar = envVarFor(s.id);
    const agentEnv = { FOODHUB_URL: '${FOODHUB_URL}', FOODHUB_SCREENS_AGENT_TOKEN: '${FOODHUB_SCREENS_AGENT_TOKEN}', SCREEN_ID: `\${${envVar}}` };
    if (s.mode === 'web') {
      web++;
      services[svc] = {
        image: CHROMIUM_IMAGE, restart: 'unless-stopped', shm_size: '1gb', security_opt: ['seccomp:unconfined'],
        environment: {
          PUID: '1000', PGID: '1000', TZ: tz, CUSTOM_USER: '${SCREENS_VIEW_USER}', PASSWORD: '${SCREENS_VIEW_PASSWORD}',
          TITLE: s.name, CHROME_CLI: `--remote-debugging-port=9222 ${s.startUrl}`,
        },
        volumes: [`./profiles/${svc}:/config`],
        ports: [`127.0.0.1:${WEB_VIEW_PORT_BASE + web}:3001`],
      };
      services[`${svc}-agent`] = {
        build: './agent', restart: 'unless-stopped', network_mode: `service:${svc}`,
        environment: { ...agentEnv, SCREEN_START_URL: s.startUrl },
      };
    } else {
      android++;
      services[svc] = {
        image: ANDROID_IMAGE, restart: 'unless-stopped', profiles: ['android'], privileged: true, shm_size: '2gb',
        devices: ['/dev/kvm:/dev/kvm'],
        environment: { EMULATOR_DEVICE: 'Samsung Galaxy S10', WEB_VNC: 'true', TZ: tz, WEB_VNC_PASSWORD: '${SCREENS_VIEW_PASSWORD}' },
        volumes: [`./profiles/${svc}:/root/android_emulator`],
        ports: [`127.0.0.1:${ANDROID_VIEW_PORT_BASE + android}:6080`],
      };
      services[`${svc}-agent`] = {
        build: { context: './agent', dockerfile: 'Dockerfile.android' }, restart: 'unless-stopped', profiles: ['android'], network_mode: `service:${svc}`,
        environment: { ...agentEnv, ANDROID_PACKAGE: s.package, ADB_HOST: '127.0.0.1' },
      };
    }
  }
  return { services, counts: { web, android } };
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
    ...screens.map((s) => `#   ${serviceName(s.id)} = ${PLATFORMS[s.platform].label} "${s.name}" (${s.mode}) → .env ${envVarFor(s.id)}`),
    '',
  ].join('\n');
  return `${head}services:\n${yamlNode(doc.services, 2)}\n`;
}

/** The .env lines a host needs for this list (names only, no values). */
export function envTemplate(screens) {
  const lines = [
    '# Copy to .env on the relay host (never commit .env). Names only here.',
    'FOODHUB_URL=https://foodhub.on2go.ca',
    '# Same value as FOODHUB_SCREENS_AGENT_TOKEN on Food Hub (Coolify). 24+ random characters: openssl rand -hex 24',
    'FOODHUB_SCREENS_AGENT_TOKEN=',
    '# Web-view sign-in of the relay host itself (not a platform password).',
    'SCREENS_VIEW_USER=',
    'SCREENS_VIEW_PASSWORD=',
    '# Screen ids shown in Food Hub → Stores → Platform screens → edit (one per screen).',
    ...screens.map((s) => `${envVarFor(s.id)}=`),
  ];
  return lines.join('\n') + '\n';
}

/** Validate + build + serialize in one go. Returns { yaml, env, screens, counts } or { errors }. */
export function generate(input, opts = {}) {
  const v = validateScreens(input);
  if ('errors' in v) return v;
  const doc = buildCompose(v.screens, opts);
  return { yaml: toYaml(doc, { source: opts.source, screens: v.screens }), env: envTemplate(v.screens), screens: v.screens, counts: doc.counts };
}
