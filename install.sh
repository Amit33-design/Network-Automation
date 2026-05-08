#!/usr/bin/env bash
# NetDesign AI — one-line installer for Linux / macOS
# Usage:  curl -fsSL https://raw.githubusercontent.com/Amit33-design/Network-Automation/main/install.sh | bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[netdesign]${NC} $*"; }
ok()    { echo -e "${GREEN}[netdesign]${NC} $*"; }
warn()  { echo -e "${YELLOW}[netdesign]${NC} $*"; }
die()   { echo -e "${RED}[netdesign] ERROR:${NC} $*" >&2; exit 1; }

INSTALL_DIR="${NETDESIGN_DIR:-$HOME/.netdesign}"
REPO="https://raw.githubusercontent.com/Amit33-design/Network-Automation/main"
VERSION="${NETDESIGN_VERSION:-latest}"

# ── Pre-flight checks ──────────────────────────────────────────────────────────
info "NetDesign AI installer — version ${VERSION}"
echo ""

command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install from https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1      || die "Docker daemon is not running. Start Docker and retry."
command -v docker compose >/dev/null 2>&1 || \
  docker-compose version >/dev/null 2>&1  || \
  die "Docker Compose not found. Install Docker Desktop or 'docker compose' plugin."

COMPOSE_CMD="docker compose"
docker compose version >/dev/null 2>&1 || COMPOSE_CMD="docker-compose"

ok "Docker OK"

# ── Install directory ──────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
info "Installing to $INSTALL_DIR"

# ── Download compose file and env template ─────────────────────────────────────
curl -fsSL "$REPO/docker-compose.dist.yml" -o docker-compose.yml
curl -fsSL "$REPO/.env.example"            -o .env.example

# ── Generate .env with random secrets if not present ─────────────────────────
if [[ ! -f .env ]]; then
    info "Generating .env with random secrets..."
    cp .env.example .env

    _rand() { python3 -c "import secrets; print(secrets.token_hex($1))" 2>/dev/null \
                || openssl rand -hex "$1" 2>/dev/null \
                || head -c "$1" /dev/urandom | xxd -p | head -c $(($1*2)); }

    JWT_SECRET=$(_rand 32)
    POSTGRES_PASSWORD=$(_rand 16)
    REDIS_PASSWORD=$(_rand 16)
    VAULT_TOKEN=$(_rand 16)

    # Admin password — prompt or generate
    if [[ -t 0 ]]; then
        echo ""
        read -rsp "  Set admin password (leave blank to auto-generate): " ADMIN_PASS
        echo ""
        [[ -z "$ADMIN_PASS" ]] && ADMIN_PASS=$(_rand 12) && warn "  Admin password: $ADMIN_PASS  (save this!)"
    else
        ADMIN_PASS=$(_rand 12)
        warn "  Admin password: $ADMIN_PASS  (save this!)"
    fi

    sed -i.bak \
        -e "s|change_me_strong_password_here|${POSTGRES_PASSWORD}|" \
        -e "s|change_me_redis_password_here|${REDIS_PASSWORD}|" \
        -e "s|change_me_256bit_random_secret_here|${JWT_SECRET}|" \
        -e "s|change_me_admin_password_here|${ADMIN_PASS}|" \
        -e "s|change_me_vault_root_token_here|${VAULT_TOKEN}|" \
        -e "s|change_me_grafana_password_here|${JWT_SECRET:0:16}|" \
        .env
    rm -f .env.bak
    ok ".env created"
else
    warn ".env already exists — skipping secret generation"
fi

# ── License key (optional) ─────────────────────────────────────────────────────
if ! grep -q "^LICENSE_KEY=nd\." .env 2>/dev/null; then
    if [[ -t 0 ]]; then
        echo ""
        read -rp "  License key (leave blank for Community tier): " LICENSE_KEY
        if [[ -n "$LICENSE_KEY" ]]; then
            sed -i.bak "s|^LICENSE_KEY=.*|LICENSE_KEY=${LICENSE_KEY}|" .env
            rm -f .env.bak
            ok "License key saved"
        else
            warn "Running as Community tier (config gen + simulation only, no deploy)"
        fi
    fi
fi

# ── Pull images ───────────────────────────────────────────────────────────────
info "Pulling images (this may take a few minutes)..."
$COMPOSE_CMD pull

# ── Start services ─────────────────────────────────────────────────────────────
info "Starting NetDesign AI..."
$COMPOSE_CMD up -d

# ── Wait for API ───────────────────────────────────────────────────────────────
info "Waiting for API to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

echo ""
ok "╔══════════════════════════════════════════════════════════════╗"
ok "  NetDesign AI is running!"
ok ""
ok "  Web UI  → http://localhost:8080"
ok "  API     → http://localhost:8000/docs"
ok "  MCP SSE → http://localhost:8001/sse"
ok ""
ok "  Install dir: $INSTALL_DIR"
ok "  Manage:      cd $INSTALL_DIR && docker compose [up|down|logs|ps]"
ok "╚══════════════════════════════════════════════════════════════╝"
echo ""
