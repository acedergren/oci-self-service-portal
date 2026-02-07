# Phase 9 Infrastructure Documentation

## Overview

Phase 9 deploys the OCI Self-Service Portal as a multi-service Docker Compose stack on the existing **app01** OCI compute instance (eu-frankfurt-1), alongside the Langflow deployment. The architecture uses nginx for TLS termination, with Fastify (API) and SvelteKit (frontend) as internal-only services.

## Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Tunnel (app01-frankfurt)         │
│  portal.solutionsedge.io → localhost:443    │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  nginx:1.27-alpine (portal-nginx)           │
│  ┌─────────────────────────────────────┐    │
│  │  :80 → 301 redirect to HTTPS       │    │
│  │  :443/api/* → http://api:3001       │    │
│  │  :443/*     → http://frontend:3000  │    │
│  │  :443/health → http://api:3001      │    │
│  └─────────────────────────────────────┘    │
│  TLS: fullchain.pem + privkey.pem + DH      │
│  Security headers, rate limiting, H2C block  │
└──────────┬──────────────┬───────────────────┘
           │              │
    portal-network (bridge)
           │              │
           ▼              ▼
┌──────────────┐  ┌───────────────┐
│ portal-api   │  │ portal-front  │
│ Fastify 5    │  │ SvelteKit     │
│ :3001 (int)  │  │ :3000 (int)   │
│ node:22-alp  │  │ node:22-alp   │
│ UID 1001     │  │ UID 1001      │
└──────┬───────┘  └───────────────┘
       │
       ▼
┌──────────────────────────┐
│  Oracle ADB 26AI         │
│  via wallet at /wallets  │
│  + OCI CLI config        │
└──────────────────────────┘
```

## Docker Compose Services

### Location
`infrastructure/docker/phase9/`

### Services

| Service | Image | Ports | Health Check | Resources |
|---------|-------|-------|-------------|-----------|
| **nginx** | `nginx:1.27-alpine` | 80, 443 (host) | `wget --spider http://localhost:80/nginx-health` | 256m / 0.25 CPU |
| **api** | `Dockerfile.api` (multi-stage) | 3001 (internal) | `curl -f http://localhost:3001/health` | 2g / 1.0 CPU |
| **frontend** | `Dockerfile.frontend` (multi-stage) | 3000 (internal) | `curl -f http://localhost:3000/api/health` | 1g / 0.5 CPU |
| **certbot** | `certbot/certbot:latest` | none | none | (optional profile) |

### Startup Order
1. `api` starts first (no dependencies)
2. `frontend` waits for `api` health check
3. `nginx` waits for both `api` and `frontend` health checks

### Container Hardening
All containers enforce:
- `read_only: true` — immutable root filesystem
- `no-new-privileges: true` — prevents privilege escalation
- `tmpfs` mounts for writable directories (with size limits)
- Non-root user: `portal` (UID 1001, GID 1001)
- Named volumes for persistent data only

### Resource Limits (configurable via `.env`)
```bash
API_MEMORY_LIMIT=2g       # Fastify backend
API_CPU_LIMIT=1.0
FRONTEND_MEMORY_LIMIT=1g  # SvelteKit frontend
FRONTEND_CPU_LIMIT=0.5
```

## Dockerfiles

### Dockerfile.api (Multi-stage)
```
Stage 1 (deps):    node:22-alpine + corepack + python3/make/g++ → pnpm install
Stage 2 (builder): Build packages/shared → Build apps/api → dist/
Stage 3 (runner):  node:22-alpine + curl → ENTRYPOINT ["node", "dist/server.js"]
```

### Dockerfile.frontend (Multi-stage)
```
Stage 1 (deps):    node:22-alpine + corepack + python3/make/g++ → pnpm install
Stage 2 (builder): Build packages/shared → Build apps/frontend (adapter-node) → build/
Stage 3 (runner):  node:22-alpine + curl → ENTRYPOINT ["node", "build"]
```

**Build context**: Both Dockerfiles use monorepo root (`../../..`) as context because `packages/shared/` is a sibling dependency resolved during build.

## Nginx Configuration

### File: `infrastructure/docker/phase9/nginx.conf`

### Key Features
- **TLS termination**: TLS 1.2+ only, strong cipher suites, DH params for forward secrecy
- **Session caching**: 10m shared cache, tickets disabled for forward secrecy
- **Security headers**: Defined at `server` level (not per-location) to avoid nginx header-redefinition:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (restrictive)
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Opener-Policy: same-origin`
- **Rate limiting**: `limit_req_zone` at 10 req/s (burst 20) as defence-in-depth with Fastify `@fastify/rate-limit`
- **H2C smuggling prevention**: All locations set `proxy_set_header Upgrade ""` to block Upgrade header
- **SSE/streaming**: `/api/` location has `proxy_buffering off`, `X-Accel-Buffering no`, `proxy_cache off` for AI chat streaming
- **Health endpoints**: Both HTTP `/nginx-health` and HTTPS `/health` suppress access logs

### Proxy Directive Order (consistent across all locations)
1. `proxy_pass`
2. `proxy_http_version 1.1`
3. `Connection ""`
4. `Host $host`
5. Forwarding headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`)
6. `Upgrade ""` (H2C block)
7. Timeouts
8. Location-specific (buffering, cache)

## TLS / Certificates

### Quick Reference
```bash
# Variable
TLS_CERTS_DIR=./certs  # Directory containing all cert files

# Required files in TLS_CERTS_DIR:
#   fullchain.pem  — TLS certificate chain
#   privkey.pem    — Private key
#   dhparam.pem    — DH parameters for forward secrecy
```

### Development (self-signed)
```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=localhost"
openssl dhparam -out certs/dhparam.pem 2048
```

### Production (Let's Encrypt)
```bash
# Enable certbot profile
docker compose --profile letsencrypt up -d

# Required env vars:
TLS_DOMAIN=portal.solutionsedge.io
CERTBOT_EMAIL=ops@solutionsedge.io
```

The certbot service runs a 12-hour renewal loop, copies renewed certs to the shared volume, and nginx picks them up on the next reload.

See `infrastructure/docker/phase9/CERTIFICATES.md` for the full certificate guide.

## Feature Flag Migration

### SvelteKit → Fastify Proxy
The frontend includes a proxy layer in `src/lib/server/feature-flags.ts` that gradually routes traffic from SvelteKit API routes to Fastify.

| Variable | Default | Purpose |
|----------|---------|---------|
| `FASTIFY_ENABLED` | `false` | Master switch for proxy |
| `FASTIFY_URL` | `http://localhost:3001` | Fastify backend URL |
| `FASTIFY_PROXY_ROUTES` | `""` (all `/api/*`) | Comma-separated route prefixes |

### Migration Stages
1. **Off** (`FASTIFY_ENABLED=false`): All requests handled by SvelteKit
2. **Selective** (`FASTIFY_ENABLED=true`, `FASTIFY_PROXY_ROUTES=/api/health,/api/metrics`): Only listed routes proxy
3. **Expand**: Add routes progressively (`/api/sessions,/api/v1/`)
4. **Full** (`FASTIFY_ENABLED=true`, `FASTIFY_PROXY_ROUTES=` empty): All `/api/*` routes proxy
5. **Remove**: Delete SvelteKit API routes entirely

### Permanent Exclusions
- `/api/auth/*` is **never** proxied — Better Auth OIDC callbacks require SvelteKit cookie handling

### Proxy Behavior
- Intercepts **after** request tracing (X-Request-Id), **before** SvelteKit auth/DB init
- Forwards `X-Request-Id` header for distributed trace correlation
- Returns `502 {"error": "Backend unavailable"}` when Fastify is unreachable
- Adds `X-Proxied-By: sveltekit` response header

See `docs/FEATURE_FLAG.md` for the full migration guide.

## Git Hooks

### Location: `.githooks/`

Auto-installed via `"prepare": "git config core.hooksPath .githooks"` in root `package.json`. Runs on `pnpm install`.

### Pre-commit Hook
Triggers on: `git commit` with staged `.ts`, `.js`, `.svelte`, `.tsx` files

| Check | Scope | Fail Behavior |
|-------|-------|---------------|
| ESLint | Changed workspaces only | Blocks commit |
| TypeScript (`tsc --noEmit`) | Changed workspaces only | Blocks commit |
| Prettier | Staged files only | Blocks commit |

**Workspace scoping**: Only runs checks for packages that have staged changes (e.g., if you only changed `apps/api/`, only `@portal/api` is linted). This keeps the hook fast.

### Pre-push Hook
Triggers on: `git push` for commits in the push range

| Check | Scope | Fail Behavior |
|-------|-------|---------------|
| Semgrep | Changed directories | Blocks push |
| CodeQL | Full JS database | Blocks push |
| Test suite (`pnpm test`) | All workspaces | Blocks push |
| CodeRabbit | Note only | Does not block |

**Emergency bypass**: `git push --no-verify`

### Required Tools
- `semgrep` — `brew install semgrep` (v1.146.0+)
- `codeql` — `brew install codeql` (v2.24.0+)
- `claude` — for CodeRabbit skill integration (optional)

## CI/CD Considerations

### Build Order
```
packages/shared (tsc)
    ├── apps/api (tsc)        ← can run in parallel
    └── apps/frontend (vite)  ← can run in parallel
```

### GitHub Packages Authentication
`@acedergren/oci-genai-provider` is published to GitHub Packages. CI needs:
```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Semgrep Baseline
Two known false positives in `packages/shared/src/server/`:
1. **`crypto.ts:78,109`**: `gcm-no-tag-length` — default 16-byte (128-bit) GCM tag is maximum strength. Annotated with `// nosemgrep`.
2. **`oracle/migrations.ts:28`**: `path-join-resolve-traversal` — filenames are regex-validated AND resolved path is checked with `startsWith()`. Annotated with `// nosemgrep`.

### CodeQL
- Query suite: `javascript-security-extended`
- Current findings: **0** on clean codebase (26 TypeScript files analyzed)

## ESLint Monorepo Fix

The root `eslint.config.js` uses `**/` prefix on all ignore patterns:
```javascript
ignores: ['**/build/', '**/.svelte-kit/', '**/node_modules/', '**/dist/', '**/.vercel/', '**/.wrangler/']
```

Without `**/`, ESLint flat config patterns only match at the config root. Since workspace `lint` scripts run from `apps/api/`, `dist/` wouldn't match `apps/api/dist/`.

## Deployment to app01

### Prerequisites
1. OCI Bastion session to app01 (`10.0.3.113`)
2. Docker + Docker Compose V2 installed on app01
3. Oracle wallet at `/data/wallets/` on app01
4. OCI CLI config at `~/.oci/` on app01
5. TLS certificates in `certs/` directory

### Deploy Commands
```bash
# Transfer files to app01
scp -r . ubuntu@10.0.3.113:/opt/portal/

# On app01:
cd /opt/portal/infrastructure/docker/phase9
cp .env.example .env
# Edit .env with production values (secrets from OCI Vault)
docker compose up -d --build
docker compose logs -f
```

### Health Verification
```bash
# nginx health
curl -k https://localhost/health

# API health (direct)
docker exec portal-api curl -f http://localhost:3001/health

# Frontend health (direct)
docker exec portal-frontend curl -f http://localhost:3000/api/health

# Full stack
docker compose ps
```

### Rollback
```bash
# Stop current stack
docker compose down

# Revert to previous image
docker compose up -d --no-build  # uses cached images

# Or redeploy from specific commit
git checkout <previous-commit>
docker compose up -d --build
```

## Environment Variables Reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ORACLE_USER` | Yes | — | Database username |
| `ORACLE_PASSWORD` | Yes | — | Database password (from OCI Vault) |
| `ORACLE_DSN` | Yes | — | TNS connect string |
| `ORACLE_WALLET_LOCATION` | Yes | — | Path to wallet inside container |
| `ORACLE_WALLET_PASSWORD` | Yes | — | Wallet password (from OCI Vault) |
| `BETTER_AUTH_SECRET` | Yes | — | Auth session signing key (min 32 chars) |
| `WEBHOOK_ENCRYPTION_KEY` | Yes | — | AES-256-GCM key for webhook secrets |
| `OIDC_CLIENT_ID` | Yes | — | OCI IAM OIDC client ID |
| `OIDC_CLIENT_SECRET` | Yes | — | OCI IAM OIDC client secret |
| `OCI_REGION` | Yes | `eu-frankfurt-1` | OCI region |
| `TLS_CERTS_DIR` | No | `./certs` | Directory with TLS cert/key/DH files |
| `HTTPS_PORT` | No | `443` | Host HTTPS port |
| `HTTP_PORT` | No | `80` | Host HTTP port |
| `API_MEMORY_LIMIT` | No | `2g` | API container memory limit |
| `API_CPU_LIMIT` | No | `1.0` | API container CPU limit |
| `FRONTEND_MEMORY_LIMIT` | No | `1g` | Frontend container memory limit |
| `FRONTEND_CPU_LIMIT` | No | `0.5` | Frontend container CPU limit |
| `FASTIFY_ENABLED` | No | `false` | Feature flag for Fastify proxy |
| `FASTIFY_URL` | No | `http://localhost:3001` | Fastify backend URL |
| `FASTIFY_PROXY_ROUTES` | No | `""` | Comma-separated route prefixes |
| `SENTRY_DSN` | No | `""` | Sentry error tracking DSN |
| `LOG_LEVEL` | No | `info` | Pino log level |

## Files Inventory

```
infrastructure/docker/phase9/
├── docker-compose.yml          # Production stack (239 lines)
├── docker-compose.dev.yml      # Development overrides (hot reload, debug)
├── Dockerfile.api              # Fastify API multi-stage build (111 lines)
├── Dockerfile.frontend         # SvelteKit multi-stage build (103 lines)
├── nginx.conf                  # Reverse proxy + TLS + security (179 lines)
├── .env.example                # Environment variable template (105 lines)
├── CERTIFICATES.md             # TLS certificate generation guide
└── certbot-www/                # Certbot webroot for ACME challenges

.githooks/
├── pre-commit                  # Lint + type check + format (staged files)
├── pre-push                    # Semgrep + CodeQL + tests (pushed commits)
└── install.sh                  # One-time setup script

docs/
├── FEATURE_FLAG.md             # Feature flag migration guide
└── PHASE9_INFRASTRUCTURE.md    # This document
```
