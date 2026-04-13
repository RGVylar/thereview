#!/usr/bin/env bash
set -euo pipefail

# ── Deploy script for Debian 12 (LXC on Proxmox) ──────────────────────────────
# Run as root or with sudo

APP_DIR="/opt/thereview"
APP_USER="thereview"
DB_NAME="thereview"
DB_USER="thereview"
DB_PASS="thereview"  # Change in production!

echo "==> Creating system user..."
id -u $APP_USER &>/dev/null || useradd -r -m -s /bin/bash $APP_USER

echo "==> Installing system dependencies..."
apt-get update
apt-get install -y python3 python3-venv python3-pip postgresql caddy curl

echo "==> Setting up PostgreSQL..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true

echo "==> Setting up backend..."
mkdir -p $APP_DIR
cp -r backend $APP_DIR/
cd $APP_DIR/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# Edit .env with production values!

echo "==> Running migrations..."
cd $APP_DIR/backend
.venv/bin/alembic upgrade head

echo "==> Building frontend..."
cd $APP_DIR
cp -r frontend $APP_DIR/
cd $APP_DIR/frontend
# Requires Node.js 18+
npm install
npm run build

echo "==> Installing services..."
cp $APP_DIR/deploy/thereview-api.service /etc/systemd/system/
cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now thereview-api
systemctl restart caddy

echo "==> Done! Edit /opt/thereview/backend/.env and /etc/caddy/Caddyfile with your domain."
