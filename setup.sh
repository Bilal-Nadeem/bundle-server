#!/bin/bash

# Bundle Server VPS Auto-Setup Script
# Sets up the Roblox Bundle Server with Nginx reverse proxy and SSL

set -e  # Exit on any error

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}   Roblox Bundle Server — VPS Setup${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# ── Configuration ─────────────────────────────────────────────────────────────

echo -e "${YELLOW}Please provide the following information:${NC}"
echo ""

read -p "Enter your domain/subdomain (e.g., bundles.example.com): " DOMAIN
read -p "Enter your email for SSL certificate: " EMAIL
read -p "Enter API key to protect the server (leave blank to disable auth): " API_KEY
read -p "Enter the port for the Node.js server (default: 3001): " NODE_PORT
NODE_PORT=${NODE_PORT:-3001}
read -p "Cache TTL in days (default: 30): " CACHE_TTL_DAYS
CACHE_TTL_DAYS=${CACHE_TTL_DAYS:-30}

echo ""
echo -e "${GREEN}Configuration Summary:${NC}"
echo "  Domain    : $DOMAIN"
echo "  Email     : $EMAIL"
echo "  API key   : ${API_KEY:-"(none — auth disabled)"}"
echo "  Port      : $NODE_PORT"
echo "  Cache TTL : ${CACHE_TTL_DAYS} days"
echo ""
read -p "Is this correct? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${RED}Setup cancelled.${NC}"
    exit 1
fi

# ── Clean up previous installation ────────────────────────────────────────────

echo ""
echo -e "${YELLOW}Checking for previous installation...${NC}"

if systemctl is-active --quiet bundle-server 2>/dev/null; then
    echo "Stopping existing bundle-server service..."
    systemctl stop bundle-server
fi

if systemctl is-enabled --quiet bundle-server 2>/dev/null; then
    systemctl disable bundle-server
fi

rm -f /etc/systemd/system/bundle-server.service
rm -f /etc/nginx/sites-enabled/bundle-server
rm -f /etc/nginx/sites-available/bundle-server
systemctl daemon-reload 2>/dev/null || true

echo -e "${GREEN}✓ Cleanup complete${NC}"

# ── [1/8] Update system ───────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[1/8] Updating system packages...${NC}"
apt update && apt upgrade -y

# ── [2/8] Node.js ─────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[2/8] Installing Node.js 20...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js: $(node -v)   npm: $(npm -v)"

# ── [3/8] Nginx ───────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[3/8] Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt install -y nginx
fi

# ── [4/8] Certbot ─────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[4/8] Installing Certbot...${NC}"
if ! command -v certbot &> /dev/null; then
    apt install -y certbot python3-certbot-nginx
fi

# ── [5/8] Project directory ───────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[5/8] Setting up project directory...${NC}"
PROJECT_DIR="/opt/bundle-server"
mkdir -p "$PROJECT_DIR"
cp -r "$(dirname "$0")"/* "$PROJECT_DIR/"
cd "$PROJECT_DIR"

# Write .env
cat > "$PROJECT_DIR/.env" <<EOF
PORT=$NODE_PORT
HOST=0.0.0.0
API_KEY=$API_KEY
CACHE_TTL_DAYS=$CACHE_TTL_DAYS
EOF

echo -e "${GREEN}✓ .env written${NC}"

# ── [6/8] Node dependencies ───────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[6/8] Installing Node.js dependencies...${NC}"
cd "$PROJECT_DIR"
npm install --omit=dev

# ── [7/8] Nginx ───────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[7/8] Configuring Nginx...${NC}"

cat > /etc/nginx/sites-available/bundle-server <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:$NODE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/bundle-server /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
systemctl enable nginx
echo -e "${GREEN}✓ Nginx configured for $DOMAIN${NC}"

# ── [8/8] systemd service ─────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[8/8] Creating systemd service...${NC}"

cat > /etc/systemd/system/bundle-server.service <<EOF
[Unit]
Description=Roblox Bundle Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=/usr/bin/node $PROJECT_DIR/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bundle-server

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bundle-server
systemctl start bundle-server

sleep 3

if systemctl is-active --quiet bundle-server; then
    echo -e "${GREEN}✓ bundle-server service started${NC}"
else
    echo -e "${RED}✗ Failed to start bundle-server${NC}"
    echo "Check logs with: journalctl -u bundle-server -f"
    exit 1
fi

# ── SSL ───────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}Obtaining SSL certificate...${NC}"
echo -e "${YELLOW}Make sure $DOMAIN DNS is pointing to this server's IP before continuing.${NC}"
read -p "Press Enter to continue with SSL setup or Ctrl+C to cancel..."

EXPAND_FLAG=""
if certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
    EXPAND_FLAG="--expand"
fi

certbot --nginx -d "$DOMAIN" --agree-tos --email "$EMAIL" --redirect --non-interactive $EXPAND_FLAG || {
    echo -e "${RED}SSL setup failed. Make sure DNS is pointing to this server.${NC}"
    echo -e "${YELLOW}Retry with: sudo certbot --nginx -d $DOMAIN${NC}"
}

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""
echo -e "${GREEN}Bundle server running at: https://$DOMAIN${NC}"
echo ""
echo -e "${YELLOW}Test it:${NC}"
echo "  curl https://$DOMAIN/health"
echo "  curl https://$DOMAIN/api/bundles/837009922 -H 'x-api-key: $API_KEY'"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  Status  : systemctl status bundle-server"
echo "  Logs    : journalctl -u bundle-server -f"
echo "  Restart : systemctl restart bundle-server"
echo "  Stop    : systemctl stop bundle-server"
echo ""
echo -e "${YELLOW}Update the server:${NC}"
echo "  cp -r /your/new/files/* $PROJECT_DIR/"
echo "  systemctl restart bundle-server"
echo ""
echo -e "${YELLOW}SSL auto-renews via certbot. Test renewal:${NC}"
echo "  certbot renew --dry-run"
