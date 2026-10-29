#!/usr/bin/env bash
# TAKATAK platform screens: the relay host in one command (run it in deploy/screens on a Linux server with Docker).
#   ./setup.sh                                        18 screens (s01-s18: 8 DoorDash, 6 Uber Eats, 4 Skip)
#   ./setup.sh --screens 54 --domain ecrans.on2go.ca  54 screens (18 DoorDash, 18 Uber Eats, 18 Skip) + https
#   ./setup.sh --screens 54 --only s19-s36 --domain ecrans2.on2go.ca   this server's share of the 54
#   ./setup.sh --dry-run                              check and write the files, start nothing
# Options: --foodhub https://foodhub.on2go.ca (Food Hub's address), --reset-list (start again from the example list).
# The agent token is asked once without echo (or read from FOODHUB_SCREENS_AGENT_TOKEN). No platform password is ever
# asked or stored here: you sign in inside each screen, once. Guide: docs/PLATFORM_SCREENS_RELAY.md.
set -euo pipefail
cd "$(dirname "$0")"

SCREENS=18; ONLY=""; DOMAIN=""; FOODHUB="https://foodhub.on2go.ca"; DRY=0; RESET=0
usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }
say() { printf '%s\n' "$*"; }
die() { printf 'ERREUR / ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --screens) SCREENS="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --domain) DOMAIN="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"; shift 2 ;;
    --foodhub) FOODHUB="${2:-}"; shift 2 ;;
    --reset-list) RESET=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "option inconnue / unknown option: $1" 2 ;;
  esac
done

# ---------- 1. what was asked ----------
case "$SCREENS" in 18|54) ;; *) die "--screens 18 ou 54 / --screens 18 or 54" 2 ;; esac
if [ -n "$ONLY" ] && ! printf '%s' "$ONLY" | grep -Eq '^s[0-9]{2}-s[0-9]{2}$'; then die "--only ressemble à s19-s36 / --only looks like s19-s36" 2; fi
if [ -n "$DOMAIN" ] && ! printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'; then die "--domain est un nom comme ecrans.on2go.ca / --domain is a name like ecrans.on2go.ca" 2; fi
printf '%s' "$FOODHUB" | grep -Eq '^https://[a-z0-9.-]+(:[0-9]+)?$' || die "--foodhub est une adresse https sans chemin / --foodhub is an https address without a path" 2
START=1; [ -n "$ONLY" ] && START=$((10#${ONLY:1:2}))

# ---------- 2. tools ----------
HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then HAVE_DOCKER=1; fi
if [ "$HAVE_DOCKER" = 0 ] && [ "$DRY" = 0 ]; then
  die "Docker et « docker compose » sont requis. Ubuntu : https://docs.docker.com/engine/install/ubuntu/ / Docker with the compose plugin is required."
fi
# The generator needs Node 20+; without it on the server, it runs in a throwaway Node container.
NODE=(node)
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  [ "$HAVE_DOCKER" = 1 ] || die "Node 20+ ou Docker est requis pour générer la liste / Node 20+ or Docker is needed to generate the list."
  NODE=(docker run --rm -i -u "$(id -u):$(id -g)" -v "$(cd .. && pwd):/d" -w /d/screens node:22-alpine node)
fi

# ---------- 3. the list of screens ----------
if [ -f screens.json ] && [ "$RESET" = 0 ]; then
  say "• screens.json existe déjà : gardé tel quel (--reset-list pour repartir de l'exemple) / kept as is."
else
  cp "screens.$SCREENS.example.json" screens.json
  say "• screens.json = screens.$SCREENS.example.json"
fi

# ---------- 4. https for --domain, three cases ----------
#   ports 80/443 free         → Caddy in the compose file gets and renews the certificate (PROXY=caddy)
#   a Traefik holds them      → Coolify / Dokploy: one route file in its dynamic folder, like deploy/install-vps.sh;
#                               the gateway then listens on the Docker bridge so Traefik's container reaches it (traefik)
#   something else holds them → nothing automatic: route the domain to the gateway yourself (manual)
PROXY=none; GW_HOST=127.0.0.1
if [ -n "$DOMAIN" ]; then
  PROXY=caddy
  if command -v ss >/dev/null 2>&1 && [ -n "$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null)" ]; then
    PROXY=manual
    TRAEFIK_ID=""
    [ "$HAVE_DOCKER" = 1 ] && TRAEFIK_ID="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | awk 'tolower($0) ~ /traefik|coolify-proxy/ {print $1; exit}' || true)"
    if [ -n "$TRAEFIK_ID" ] && [ -f ../traefik-detect.mjs ]; then
      eval "$(docker inspect "$TRAEFIK_ID" | "${NODE[@]}" ../traefik-detect.mjs)"
      if [ -n "${TRAEFIK_DYNAMIC_DIR:-}" ]; then
        PROXY=traefik
        GW_HOST="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n 1 || true)"
        [ -n "$GW_HOST" ] || GW_HOST=172.17.0.1
        say "• Traefik détecté (Coolify ?) : route https://$DOMAIN ajoutée dans $TRAEFIK_DYNAMIC_DIR ; passerelle sur $GW_HOST:3100."
        say "  Traefik found (Coolify?): route https://$DOMAIN added in its dynamic folder; gateway on $GW_HOST:3100."
      fi
    fi
    if [ "$PROXY" = manual ]; then
      say "• Les ports 80/443 sont pris par un autre programme : reliez vous-même https://$DOMAIN à 127.0.0.1:3100."
      say "  Ports 80/443 are taken by another program: route https://$DOMAIN to 127.0.0.1:3100 yourself."
    fi
  fi
fi

GEN=(generate.mjs screens.json)
[ -n "$ONLY" ] && GEN+=(--only "$ONLY")
[ "$PROXY" = caddy ] && GEN+=(--domain "$DOMAIN")
[ "$GW_HOST" != 127.0.0.1 ] && GEN+=(--gateway-host "$GW_HOST")
"${NODE[@]}" "${GEN[@]}"

# ---------- 5. .env: created once, never printed; only empty values are filled on a second run ----------
env_get() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
env_set() { # KEY VALUE: replace the line or add it (awk: no escaping trouble with any value)
  local tmp; tmp="$(mktemp .env.XXXXXX)"
  if [ -f .env ] && grep -q "^$1=" .env; then
    K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"] "=" } index($0, k) == 1 { print k ENVIRON["V"]; next } { print }' .env > "$tmp"
  else
    { [ -f .env ] && cat .env; printf '%s=%s\n' "$1" "$2"; } > "$tmp"
  fi
  chmod 600 "$tmp"; mv "$tmp" .env
}
if [ -z "$(env_get FOODHUB_SCREENS_AGENT_TOKEN)" ]; then
  TOKEN="${FOODHUB_SCREENS_AGENT_TOKEN:-}"
  if [ -z "$TOKEN" ] && [ -t 0 ]; then
    say "Jeton des écrans : la même valeur que FOODHUB_SCREENS_AGENT_TOKEN dans Coolify (Food Hub). Rien ne s'affiche en tapant."
    say "Screens token: the same value as FOODHUB_SCREENS_AGENT_TOKEN in Coolify (Food Hub). Nothing shows while typing."
    read -r -s -p "> " TOKEN; echo
  fi
  [ "${#TOKEN}" -ge 24 ] || die "le jeton doit avoir au moins 24 caractères (openssl rand -hex 24) / the token needs 24+ characters."
  printf '%s' "$TOKEN" | grep -Eq '^[A-Za-z0-9._~+/=-]+$' || die "le jeton contient des caractères interdits / the token has invalid characters."
fi
umask 077
if [ ! -f .env ]; then
  cp .env.example .env
  env_set FOODHUB_URL "$FOODHUB"
  env_set FOODHUB_ORIGIN "$FOODHUB"
fi
chmod 600 .env
[ -n "$(env_get FOODHUB_URL)" ] || env_set FOODHUB_URL "$FOODHUB"
[ -n "$(env_get FOODHUB_ORIGIN)" ] || env_set FOODHUB_ORIGIN "$FOODHUB"
if [ -n "${TOKEN:-}" ]; then env_set FOODHUB_SCREENS_AGENT_TOKEN "$TOKEN"; unset TOKEN; fi
[ -n "$(env_get SCREENS_VIEW_USER)" ] || env_set SCREENS_VIEW_USER ecrans
NEW_PASSWORD=""
if [ -z "$(env_get SCREENS_VIEW_PASSWORD)" ]; then
  NEW_PASSWORD="$(openssl rand -hex 12 2>/dev/null || od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
  env_set SCREENS_VIEW_PASSWORD "$NEW_PASSWORD"
fi
chmod 600 .env

# ---------- 6. size of the server ----------
WEB=$(grep -cE '^      SUBFOLDER:' docker-compose.yml || true)
COUNTS="$("${NODE[@]}" -e '
  const list = JSON.parse(require("fs").readFileSync("screens.json", "utf8"));
  const all = Array.isArray(list) ? list : list.screens;
  const [lo, hi] = (process.argv[1] || "s01-s99").match(/\d+/g).map(Number);
  const n = { doordash: 0, uber: 0, skip: 0 };
  for (const s of all) { const k = /^s\d{2}$/.test(s.id) ? Number(s.id.slice(1)) : 0; if (!k || (k >= lo && k <= hi)) n[s.platform]++; }
  console.log(`${n.doordash} DoorDash, ${n.uber} Uber Eats, ${n.skip} Skip`);
' "${ONLY:-s01-s99}")"
if [ -r /proc/meminfo ]; then
  MEM_GB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1048576 }' /proc/meminfo)
  NEED_GB=$(( (WEB * 6 + 9) / 10 + 2 ))
  if [ "$MEM_GB" -lt "$NEED_GB" ]; then
    say "• ATTENTION : $WEB écrans demandent environ $NEED_GB Go de mémoire ; ce serveur en a $MEM_GB. Prenez-en un plus gros, ou répartissez avec --only."
    say "  WARNING: $WEB screens need about $NEED_GB GB of memory; this server has $MEM_GB. Use a bigger one, or split with --only."
  fi
fi

if [ "$DRY" = 1 ]; then
  say ""
  say "Essai seulement (--dry-run) : rien n'est démarré. / Dry run: nothing started."
else
  # ---------- 7. start and wait for the gateway ----------
  docker compose up -d --build
  if command -v curl >/dev/null 2>&1; then
    for _ in $(seq 1 60); do
      if curl -fsS http://127.0.0.1:3100/healthz >/dev/null 2>&1; then OK=1; break; fi
      sleep 2
    done
  fi
  [ "${OK:-0}" = 1 ] && say "• La passerelle répond. / The gateway answers." \
    || say "• La passerelle ne répond pas encore : docker compose logs gateway / The gateway is not answering yet."
fi

# ---------- 8. the Traefik route (Coolify on this server) ----------
if [ "$PROXY" = traefik ]; then
  ROUTE="$TRAEFIK_DYNAMIC_DIR/takatak-screens-${DOMAIN//./-}.yml"
  SVC="takatak-screens-${DOMAIN//./-}"
  ROUTE_BODY="$(cat <<TRAEFIK
# TAKATAK platform screens (deploy/screens/setup.sh): https://$DOMAIN → the screens gateway. Delete this file to remove.
http:
  routers:
    $SVC:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: ["$TRAEFIK_HTTPS_EP"]
      service: $SVC
      priority: 10000
      tls:
        certResolver: "$TRAEFIK_RESOLVER"
    $SVC-http:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: ["$TRAEFIK_HTTP_EP"]
      service: $SVC
      priority: 10000
      middlewares: ["$SVC-https"]
  middlewares:
    $SVC-https:
      redirectScheme:
        scheme: https
        permanent: true
  services:
    $SVC:
      loadBalancer:
        servers:
          - url: "http://$GW_HOST:3100"
TRAEFIK
)"
  if [ "$DRY" = 1 ]; then
    say "• (essai) la route Traefik serait écrite dans $ROUTE / (dry run) the Traefik route would go to $ROUTE"
  else
    printf '%s\n' "$ROUTE_BODY" > "$ROUTE" && chmod 644 "$ROUTE" \
      || die "écriture impossible dans $TRAEFIK_DYNAMIC_DIR (lancez avec sudo) / cannot write the route (run with sudo)."
    # Traefik's container reaches the gateway on the Docker bridge; nothing else can.
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
      for net in 172.16.0.0/12 10.0.0.0/8 192.168.0.0/16; do ufw allow from "$net" to any port 3100 proto tcp >/dev/null; done
    fi
  fi
fi

# ---------- 9. what to do next ----------
ADDRESS="${DOMAIN:+https://$DOMAIN/}"
say ""
say "=============================================================="
say " $WEB écrans sur ce serveur : $COUNTS"
say "=============================================================="
if [ -n "$ADDRESS" ]; then
  case "$PROXY" in
    caddy|traefik) say "1. DNS : un enregistrement A de $DOMAIN vers l'adresse IP de ce serveur (le certificat https arrive tout seul)." ;;
    *) say "1. Reliez $ADDRESS à 127.0.0.1:3100 dans votre proxy (un seul domaine pour tous les écrans)." ;;
  esac
else
  say "1. Donnez une adresse https aux écrans : relancez avec --domain ecrans.on2go.ca, ou reliez-la à 127.0.0.1:3100 dans Coolify."
fi
say "2. Food Hub → Magasins → Écrans des plateformes → « Préparer les écrans » :"
say "     $COUNTS ; numéro de départ : $START ; adresse du serveur relais : ${ADDRESS:-https://<votre domaine>/}"
say "3. Coolify → Food Hub → FOODHUB_SCREENS_VIEW_HOSTS : ajoutez ${DOMAIN:-<votre domaine>} (séparés par des virgules s'il y a plusieurs serveurs)."
say "4. Ouvrez chaque écran dans Food Hub et connectez-vous une fois avec le courriel et le mot de passe de CE compte."
say ""
say "Mot de passe pour VOIR les écrans (pas un mot de passe de plateforme) : utilisateur « $(env_get SCREENS_VIEW_USER) »"
if [ -n "$NEW_PASSWORD" ]; then say "   mot de passe : $NEW_PASSWORD   (noté dans .env, protégé ; gardez-le dans votre gestionnaire de mots de passe)"
else say "   mot de passe : celui déjà dans .env (inchangé)"; fi
say ""
say "Next (EN): DNS or Coolify route → Food Hub « Set up screens » ($COUNTS, start number $START) → FOODHUB_SCREENS_VIEW_HOSTS → sign in once in each screen."
