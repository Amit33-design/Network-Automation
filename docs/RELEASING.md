# Releasing — publish Docker images to GHCR

NetDesign AI ships pre-built, multi-arch (amd64 + arm64) container images to the
GitHub Container Registry (GHCR). Publishing is fully automated by
[`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) —
**no image is published until a release tag exists.**

## Images

| Image | Built from | Contents |
|-------|-----------|----------|
| `ghcr.io/amit33-design/network-automation/api` | `Dockerfile.release` | FastAPI backend + MCP server + Celery worker (one image, command-switched) |
| `ghcr.io/amit33-design/network-automation/frontend` | `Dockerfile.frontend` | React/Vite build served by Nginx |

## Cut a release (publishes the images)

The workflow triggers on any tag matching `v*.*.*`:

```bash
# from an up-to-date main (recommended)
git checkout main && git pull
git tag v1.0.0
git push origin v1.0.0
```

This runs the workflow, which will:
1. Log in to GHCR with the repo's `GITHUB_TOKEN`.
2. Build + push `api:v1.0.0`, `api:latest`, `frontend:v1.0.0`, `frontend:latest` (amd64 + arm64).
3. Create a GitHub Release attaching `docker-compose.dist.yml`, `install.sh`, `install.bat`, `.env.example`.

You can also publish on demand without a tag via **Actions → Build & Publish Docker
Images → Run workflow** (`workflow_dispatch`, set the `version` input).

## After publishing — make packages public (first release only)

GHCR packages default to **private**. To let users `docker pull` without auth, set each
package to public once:

1. GitHub → your profile/org → **Packages** → `network-automation/api` → **Package settings**
   → **Change visibility** → **Public**. Repeat for `…/frontend`.

(Or keep them private and have users `docker login ghcr.io` with a PAT.)

## Verify the download works

```bash
docker pull ghcr.io/amit33-design/network-automation/api:latest
docker pull ghcr.io/amit33-design/network-automation/frontend:latest

# full stack from the published images:
curl -fsSL https://raw.githubusercontent.com/Amit33-design/Network-Automation/main/docker-compose.dist.yml -o docker-compose.yml
cp .env.example .env
docker compose up -d
docker compose ps          # all services healthy
```

- Web UI → http://localhost:8080
- API + Swagger → http://localhost:8000/docs
- MCP (SSE) → http://localhost:8001/sse

## Versioning

Use semantic version tags (`vMAJOR.MINOR.PATCH`). `:latest` always tracks the most
recent `v*.*.*` tag. Pin `NETDESIGN_VERSION` in `.env` to deploy a specific version:

```bash
echo "NETDESIGN_VERSION=v1.0.0" >> .env
docker compose -f docker-compose.dist.yml up -d
```
