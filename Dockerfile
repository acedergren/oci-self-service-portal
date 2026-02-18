# =============================================================================
# OCI Self-Service Portal - Production Dockerfile (Frontend)
# =============================================================================
# Multi-stage build for the SvelteKit self-service portal frontend.
#
# Build context: monorepo root
#   docker build -t oci-self-service-portal .
#
# Run:
#   docker run -p 3000:3000 \
#     -v $HOME/.oci:/home/portal/.oci:ro \
#     -v /data/wallets:/wallets:ro \
#     oci-self-service-portal
#
# For Fastify API, use: infrastructure/docker/phase9/Dockerfile.api
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: deps — install pnpm and all dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable

# Native build tools for oracledb native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

# Copy package.json files for workspace packages
COPY packages/shared/package.json ./packages/shared/
COPY apps/frontend/package.json ./apps/frontend/

# Install dependencies for frontend and shared
RUN pnpm install --frozen-lockfile \
    --filter @portal/frontend... \
    --filter @portal/shared

# ---------------------------------------------------------------------------
# Stage 2: builder — build shared package then SvelteKit app
# ---------------------------------------------------------------------------
FROM deps AS builder

WORKDIR /app

# Copy shared package source and build first (dependency of frontend)
COPY packages/shared/ ./packages/shared/
RUN pnpm --filter @portal/shared build

# Copy frontend source and build
COPY apps/frontend/ ./apps/frontend/
RUN pnpm --filter @portal/frontend build

# ---------------------------------------------------------------------------
# Stage 3: runner — production runtime with OCI CLI
# ---------------------------------------------------------------------------
# Using node:22-slim (Debian-based) because OCI CLI requires Python/pip
FROM node:22-slim AS runner

LABEL maintainer="Alexander Cedergren <alexander.cedergren@oracle.com>"
LABEL description="OCI Self-Service Portal - SvelteKit Frontend"

# Install OCI CLI and curl (for health checks)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        curl \
    && python3 -m pip install --break-system-packages oci-cli \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache

# Verify OCI CLI installation
RUN oci --version

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m -s /bin/bash portal

# Create volume mount points
RUN mkdir -p /app/data /wallets /home/portal/.oci && \
    chown -R portal:nodejs /app/data /home/portal/.oci

# Copy built SvelteKit app
COPY --from=builder --chown=portal:nodejs /app/apps/frontend/build ./build
COPY --from=builder --chown=portal:nodejs /app/apps/frontend/package.json ./

# Copy node_modules from the builder
COPY --from=builder --chown=portal:nodejs /app/node_modules ./node_modules

# Copy built shared package (for runtime imports)
COPY --from=builder --chown=portal:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=portal:nodejs /app/packages/shared/package.json ./packages/shared/

# Volume mount points:
#   /app/data          - Persistent application data (audit logs)
#   /wallets           - Oracle Database wallet files
#   /home/portal/.oci  - OCI CLI configuration (config, key files)
VOLUME ["/app/data", "/wallets", "/home/portal/.oci"]

USER portal

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["node", "build"]
