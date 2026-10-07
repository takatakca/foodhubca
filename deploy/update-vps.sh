#!/usr/bin/env bash
# Update TAKATAK Food Hub on the server with a new release zip. Keys (.env.local) and data are kept.
#   sudo bash /opt/takatak-foodhub/deploy/update-vps.sh /root/foodhubca-main.zip   (GitHub → Code → Download ZIP, branch main)
set -euo pipefail
APP_DIR=/opt/takatak-foodhub
APP_USER=takatak
ZIP="${1:?Donnez le chemin du zip. / Give the zip path.}"
[ "$(id -u)" -eq 0 ] || { echo "Lancez-le avec sudo."; exit 1; }
TMP="$(mktemp -d)"
unzip -q "$ZIP" -d "$TMP"
SRC="$(dirname "$(find "$TMP" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | head -1)")"
cp "$APP_DIR/.env.local" "$TMP/env.backup"
rsync -a --delete --exclude node_modules --exclude .next --exclude .env.local --exclude .git --exclude data/media "$SRC/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
cd "$APP_DIR"
sudo -u "$APP_USER" -H npm ci --no-audit --no-fund --loglevel=error
sudo -u "$APP_USER" -H npm run build
systemctl restart takatak-foodhub
rm -rf "$TMP"
echo "✅ Mis à jour. Journal : journalctl -u takatak-foodhub -f"
echo "   Base de données : si la version contient un nouveau fichier SQL, collez supabase/INSTALL_ALL.sql dans Supabase (sans danger, plusieurs fois)."
