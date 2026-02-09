# Phase 9: Multi-Service Docker Deployment

This directory contains production Docker deployment assets for:

- Nginx TLS termination and reverse proxy
- Fastify API service
- SvelteKit frontend service
- Optional Certbot auto-renewal profile (Let's Encrypt)

## Architecture

```
Internet
   |
   v
nginx (80/443, TLS termination, security headers, rate limit)
   |                    \
   |                     \-- /.well-known/acme-challenge/* (certbot webroot)
   v
frontend:3000 (SvelteKit) -----> api:3001 (Fastify) -----> Oracle ADB
```

## Services

### 1. Nginx Reverse Proxy

- Ports: `80` and `443`
- Responsibilities:
  - TLS 1.2+/1.3 termination
  - HSTS and proxy-level security headers
  - API/frontend request routing
  - ACME HTTP-01 challenge path for Let's Encrypt

### 2. Frontend (SvelteKit)

- Internal port: `3000`
- Browser traffic comes via nginx (`https://<host>/`)

### 3. API (Fastify)

- Internal port: `3001`
- Browser/API traffic comes via nginx (`https://<host>/api/*`)
- Includes:
  - `@fastify/helmet` security headers
  - CSP nonce support
  - Secure cookie parsing aligned with Better Auth

### 4. Certbot (optional profile: `letsencrypt`)

- Runs certificate renewal loop
- Uses shared `certbot-www` webroot and `certs` storage path
- Enabled with:

```bash
docker compose --profile letsencrypt up -d certbot
```

### 5. Database (Oracle Autonomous Database)

- **Type**: External managed service (not containerized)
- **Connection**: Via wallet files mounted at `/wallets`

## Files

- `Dockerfile.frontend` - Multi-stage build for SvelteKit app
- `Dockerfile.api` - Multi-stage build for Fastify backend
- `docker-compose.yml` - Orchestrates nginx + frontend + api (+ certbot profile)
- `docker-compose.dev.yml` - Development overrides with hot-reload
- `nginx.conf` - TLS and reverse proxy configuration
- `CERTIFICATES.md` - Certificate provisioning, rotation, and alerting runbook
- `check-certificate-expiry.sh` - Certificate expiry threshold check for monitoring

## Prerequisites

Before starting services, generate the required TLS files:

```bash
mkdir -p infrastructure/docker/phase9/certs

# Generate DH parameters (required — nginx mount fails without this file)
openssl dhparam -out infrastructure/docker/phase9/certs/dhparam.pem 2048

# Generate self-signed cert for development (or provide your own)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infrastructure/docker/phase9/certs/privkey.pem \
  -out infrastructure/docker/phase9/certs/fullchain.pem \
  -subj "/CN=localhost"
```

See [CERTIFICATES.md](CERTIFICATES.md) for production certificate options (Let's Encrypt, OCI Certificates).

## Usage

### Development

```bash
# Start services with hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# View logs
docker compose logs -f api
docker compose logs -f frontend
```

### Production

```bash
# Build and start (nginx + api + frontend)
docker compose up -d

# Check health
docker compose ps
curl -k https://localhost/health
curl -k https://localhost/api/health

# View metrics
curl -k https://localhost/api/metrics
```

## Health Checks

- **Nginx**: `GET /nginx-health` on port `80`
- **API**: `GET /health` via nginx proxy (`/health`)
- **Frontend**: `GET /api/health` via nginx proxy

## Volumes

- `api_data:/app/data` - Persistent API data (SQLite fallbacks, logs)
- `frontend_data:/app/.svelte-kit` - Frontend build cache
- `/data/wallets:/wallets:ro` - Oracle wallet (read-only, host mount)
- `~/.oci:/home/portal/.oci:ro` - OCI CLI config (read-only, host mount)
- `./certs` - TLS cert/key store
- `./certbot-www` - ACME challenge webroot

## Network

Services communicate via a custom bridge network:

- **Name**: `portal-network`
- **Driver**: bridge
- **Internal DNS**: Services accessible by service name (e.g., `http://api:3001`)

## Security

- TLS 1.2+ with strong ciphers
- HSTS + proxy security headers
- API security headers via Helmet + CSP nonce support
- Secure cookie policy aligned across Better Auth and Fastify
- Webhook signing secrets encrypted at rest (`WEBHOOK_ENCRYPTION_KEY`)

See [CERTIFICATES.md](CERTIFICATES.md) for certificate provisioning and alerting policy.

## Troubleshooting

### Nginx won't start

```bash
# Validate nginx config
docker compose exec nginx nginx -t

# Check TLS files exist (all three are required)
ls -l infrastructure/docker/phase9/certs/fullchain.pem \
     infrastructure/docker/phase9/certs/privkey.pem \
     infrastructure/docker/phase9/certs/dhparam.pem
```

If `dhparam.pem` is missing, generate it:

```bash
openssl dhparam -out infrastructure/docker/phase9/certs/dhparam.pem 2048
```

### Frontend can't reach API

```bash
# Test internal network
docker compose exec frontend sh -c 'curl http://api:3001/health'
```

### Certificate renewal issues

```bash
# Run certbot manually
docker compose --profile letsencrypt run --rm certbot renew --webroot -w /var/www/certbot

# Reload nginx after cert update
docker compose exec nginx nginx -s reload
```
