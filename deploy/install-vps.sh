#!/usr/bin/env bash
# TAKATAK Food Hub — one-command install on your own Linux server (Contabo VPS, Ubuntu 22.04 / 24.04 or Debian 12).
#
#   unzip foodhubca-main.zip                      # GitHub → takatakca/foodhubca → Code → Download ZIP (branch main)
#   sudo bash foodhubca-main/deploy/install-vps.sh                      # free address <ip>.sslip.io
#   sudo bash foodhubca-main/deploy/install-vps.sh foodhub.takatak.ca   # your own sub-domain
# On Coolify (Docker) use the Dockerfile instead: docs/BACK_ONLINE_TODAY.md, Part B.
#
# What it does: Node 22 + Caddy (automatic HTTPS), copies the app to /opt/takatak-foodhub, asks YOU for the keys
# (npm run setup — typed on the server, never in a chat), builds, starts it as a service that restarts by itself,
# opens the firewall (SSH, 80, 443) and schedules the daily jobs. Safe to run again: keys already saved are kept.
set -euo pipefail

APP_DIR=/opt/takatak-foodhub
APP_USER=takatak
PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${1:-}"

say()  { printf '\n\033[1;38;5;208m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Lancez-le avec sudo (ou en root). / Run it with sudo."
[ -f "$SRC_DIR/package.json" ] || fail "Lancez le script depuis le dossier dézippé. / Run it from the unzipped folder."
command -v apt-get >/dev/null || fail "Ubuntu ou Debian requis. / Ubuntu or Debian required."

say "1/8 Paquets de base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg unzip rsync ufw debian-keyring debian-archive-keyring apt-transport-https >/dev/null

say "2/8 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

say "3/8 Adresse publique"
IP="$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ -z "$DOMAIN" ]; then DOMAIN="${IP//./-}.sslip.io"; fi
echo "Adresse : https://$DOMAIN   (IP du serveur : $IP)"
if [[ "$DOMAIN" != *.sslip.io ]]; then
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
  [ "$RESOLVED" = "$IP" ] || echo "⚠ $DOMAIN ne pointe pas encore vers $IP (DNS : enregistrement A). Le HTTPS s'activera dès que ce sera fait."
fi
# A Traefik already on this server (Coolify, Dokploy, …) keeps ports 80/443: Food Hub is added to it as one route
# (one file in its dynamic folder) instead of installing Caddy. Nothing else in that Traefik is changed.
PROXY_MODE=caddy
BIND_HOST=127.0.0.1
TRAEFIK_ID=""
if command -v docker >/dev/null; then
  TRAEFIK_ID="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | awk 'tolower($0) ~ /traefik|coolify-proxy/ {print $1; exit}')"
fi
if [ -n "$TRAEFIK_ID" ]; then
  PROXY_MODE=traefik
  eval "$(docker inspect "$TRAEFIK_ID" | node "$SRC_DIR/deploy/traefik-detect.mjs")"
  [ -n "$TRAEFIK_DYNAMIC_DIR" ] && [ -d "$TRAEFIK_DYNAMIC_DIR" ] || fail "Un Traefik occupe les ports 80/443 mais son dossier de configuration dynamique est introuvable. / A Traefik holds ports 80/443 but its dynamic config folder was not found."
  # Food Hub listens on the Docker bridge address: reachable by Traefik's container, not from the internet.
  BIND_HOST="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  [ -n "$BIND_HOST" ] || BIND_HOST=172.17.0.1
  # Panels often use 3000 themselves (Dokploy): take a quiet port.
  for p in 3077 3177 3277 3377; do
    if ! ss -ltn "sport = :$p" | grep -q LISTEN && ! docker ps --format '{{.Ports}}' | grep -q ":$p->"; then PORT=$p; break; fi
  done
  echo "Traefik détecté (conteneur $TRAEFIK_ID) → route ajoutée dans $TRAEFIK_DYNAMIC_DIR, Food Hub sur $BIND_HOST:$PORT"
else
  for p in 80 443; do
    if ss -ltnp "sport = :$p" | grep -q LISTEN && ! ss -ltnp "sport = :$p" | grep -q caddy; then
      fail "Le port $p est déjà utilisé par un autre programme (site web existant ?). Arrêtez-le ou installez Food Hub sur un autre serveur."
    fi
  done
fi

if [ "$PROXY_MODE" = caddy ]; then
  say "4/8 Caddy (HTTPS automatique)"
  if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
else
  say "4/8 HTTPS par le Traefik existant"
fi

say "5/8 Copie de l'application dans $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .next --exclude .env.local --exclude .git --exclude data/media "$SRC_DIR/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
cd "$APP_DIR"
sudo -u "$APP_USER" -H npm ci --no-audit --no-fund --loglevel=error

say "6/8 Vos clés (tapées ici, sur votre serveur — jamais dans un clavardage)"
ENV_FILE="$APP_DIR/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
FOODHUB_PUBLIC_URL=https://$DOMAIN
FOODHUB_TRUST_PROXY=true
NEXT_PUBLIC_SUPABASE_URL=https://pcjfahhlozsseqqevimi.supabase.co
FOODHUB_TIMEZONE=America/Toronto
FOODHUB_WATCH_INTERVAL_S=30
LIVE_CONNECTORS_GLOBAL_ENABLED=false
ENV
  chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
fi
sed -i "s#^FOODHUB_PUBLIC_URL=.*#FOODHUB_PUBLIC_URL=https://$DOMAIN#" "$ENV_FILE"
grep -q "^FOODHUB_TRUST_PROXY=" "$ENV_FILE" || echo "FOODHUB_TRUST_PROXY=true" >> "$ENV_FILE"
echo "Supabase → Project Settings → API : copiez la clé « service_role » quand on vous la demande (la URL est déjà remplie)."
sudo -u "$APP_USER" -H npm run setup </dev/tty
chmod 600 "$ENV_FILE"

say "7/8 Construction et service"
sudo -u "$APP_USER" -H npm run build
AFTER_EXTRA=""; [ "$PROXY_MODE" = traefik ] && AFTER_EXTRA="docker.service"
cat > /etc/systemd/system/takatak-foodhub.service <<UNIT
[Unit]
Description=TAKATAK Food Hub
After=network-online.target $AFTER_EXTRA
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p $PORT -H $BIND_HOST
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now takatak-foodhub >/dev/null
systemctl restart takatak-foodhub

if [ "$PROXY_MODE" = caddy ]; then
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:$PORT
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
CADDY
systemctl enable --now caddy >/dev/null
systemctl reload caddy || systemctl restart caddy
else
cat > "$TRAEFIK_DYNAMIC_DIR/takatak-foodhub.yml" <<TRAEFIK
# TAKATAK Food Hub — added by deploy/install-vps.sh. Delete this file to remove the route.
http:
  routers:
    takatak-foodhub:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: ["$TRAEFIK_HTTPS_EP"]
      service: takatak-foodhub
      priority: 10000
      middlewares: ["takatak-foodhub-headers"]
      tls:
        certResolver: "$TRAEFIK_RESOLVER"
    takatak-foodhub-http:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: ["$TRAEFIK_HTTP_EP"]
      service: takatak-foodhub
      priority: 10000
      middlewares: ["takatak-foodhub-https"]
  middlewares:
    takatak-foodhub-https:
      redirectScheme:
        scheme: https
        permanent: true
    takatak-foodhub-headers:
      headers:
        stsSeconds: 31536000
        contentTypeNosniff: true
        referrerPolicy: "strict-origin-when-cross-origin"
  services:
    takatak-foodhub:
      loadBalancer:
        servers:
          - url: "http://$BIND_HOST:$PORT"
TRAEFIK
chmod 644 "$TRAEFIK_DYNAMIC_DIR/takatak-foodhub.yml"
fi

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
if [ "$PROXY_MODE" = traefik ]; then
  # Traefik's container reaches Food Hub on the Docker bridge; nothing else can.
  for net in 172.16.0.0/12 10.0.0.0/8 192.168.0.0/16; do ufw allow from "$net" to any port "$PORT" proto tcp >/dev/null; done
fi
ufw --force enable >/dev/null

say "8/8 Tâches planifiées"
CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
cat > /etc/cron.d/takatak-foodhub <<CRON
# TAKATAK Food Hub — the Watchtower itself runs inside the app every 30 s (instrumentation.ts).
SHELL=/bin/sh
*/5 * * * * $APP_USER curl -fsS -m 60 -H "Authorization: Bearer $CRON_SECRET" http://$BIND_HOST:$PORT/api/foodhub/cron/sync >/dev/null 2>&1
* * * * *   $APP_USER curl -fsS -m 50 -H "Authorization: Bearer $CRON_SECRET" http://$BIND_HOST:$PORT/api/foodhub/cron/watch >/dev/null 2>&1
5 8 * * *   $APP_USER curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" http://$BIND_HOST:$PORT/api/foodhub/cron/reports >/dev/null 2>&1
CRON
chmod 600 /etc/cron.d/takatak-foodhub

sleep 4
if curl -fsS -o /dev/null "http://$BIND_HOST:$PORT/login"; then STATUS="en marche"; else STATUS="ne répond pas encore — voir : journalctl -u takatak-foodhub -n 50"; fi
HTTPS_OK="non — vérifiez dans 1 minute"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS -o /dev/null -m 10 "https://$DOMAIN/login"; then HTTPS_OK="oui"; break; fi
  sleep 5
done
cat <<DONE

✅ TAKATAK Food Hub : $STATUS  ·  HTTPS public : $HTTPS_OK  ·  ($PROXY_MODE)
   Ouvrez  https://$DOMAIN  → « Créer le compte propriétaire » avec votre courriel → entrez le code.

   À donner aux plateformes (aussi dans Réglages → Plateformes et Clover) :
   Uber Eats  webhook  https://$DOMAIN/api/foodhub/webhooks/uber-eats
              redirect https://$DOMAIN/api/foodhub/uber-connect/callback
   DoorDash   webhook  https://$DOMAIN/api/foodhub/webhooks/doordash
   Skip       webhook  https://$DOMAIN/api/foodhub/webhooks/skip/orders   (+ 5 autres dans l'écran Plateformes)
   Clover     webhook  https://$DOMAIN/api/foodhub/webhooks/clover

   Mise à jour plus tard :  sudo bash $APP_DIR/deploy/update-vps.sh nouveau.zip
   Journal               :  journalctl -u takatak-foodhub -f
DONE
