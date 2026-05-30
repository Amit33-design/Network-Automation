# ============================================================================
# NetDesign AI — React frontend (Vite build → Nginx static serve)
# Replaces the legacy vanilla index.html served previously by docker-compose.
# ============================================================================

# ── Stage 1: build the React app ───────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install deps from lockfile (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Build
COPY . .
RUN npm run build

# ── Stage 2: serve with Nginx ──────────────────────────────────────────────
FROM nginx:alpine AS serve
LABEL maintainer="Amit Tiwari <atiwari824@gmail.com>"
LABEL description="NetDesign AI — React frontend"

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
