# =============================================================================
# OCI AI Chat - Production Dockerfile
# =============================================================================
# Multi-stage build for the SvelteKit self-service portal.
#
# Build context: monorepo root (oci-genai-examples/)
#   docker build -f oci-ai-chat/Dockerfile -t oci-ai-chat .
#
# Run:
#   docker run -p 3000:3000 \
#     -v $HOME/.oci:/home/portal/.oci:ro \
#     -v /data/wallets:/wallets:ro \
#     oci-ai-chat
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: deps — install pnpm and all dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable

# Native build tools for better-sqlite3 (used by @acedergren/agent-state)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

# Copy only the workspace packages we need (package.json first for cache)
COPY agent-state/package.json ./agent-state/
COPY mcp-client/package.json ./mcp-client/
COPY oci-genai-provider/package.json ./oci-genai-provider/
COPY oci-genai-query/package.json ./oci-genai-query/
COPY oci-ai-chat/package.json ./oci-ai-chat/

# Install all dependencies (frozen lockfile for reproducibility)
# Use --filter to only install what oci-ai-chat needs
RUN pnpm install --frozen-lockfile \
    --filter oci-ai-chat... \
    --filter @acedergren/agent-state \
    --filter @acedergren/mcp-client \
    --filter @acedergren/oci-genai-provider \
    --filter @acedergren/oci-genai-query

# ---------------------------------------------------------------------------
# Stage 2: builder — build workspace packages then the SvelteKit app
# ---------------------------------------------------------------------------
FROM deps AS builder

WORKDIR /app

# Copy full source for workspace packages
COPY agent-state/ ./agent-state/
COPY mcp-client/ ./mcp-client/
COPY oci-genai-provider/ ./oci-genai-provider/
COPY oci-genai-query/ ./oci-genai-query/
COPY oci-ai-chat/ ./oci-ai-chat/

# Build workspace packages in dependency order
# (agent-state, mcp-client, oci-genai-query use tsc; oci-genai-provider uses tsup)
RUN pnpm --filter @acedergren/agent-state build && \
    pnpm --filter @acedergren/mcp-client build && \
    pnpm --filter @acedergren/oci-genai-provider build && \
    pnpm --filter @acedergren/oci-genai-query build

# Build the SvelteKit app (adapter-node outputs to build/)
RUN pnpm --filter oci-ai-chat build

# ---------------------------------------------------------------------------
# Stage 3: runner — production runtime with OCI CLI
# ---------------------------------------------------------------------------
# Using node:22-slim (Debian-based) because OCI CLI requires Python/pip
FROM node:22-slim AS runner

LABEL maintainer="Alexander Cedergren <alexander.cedergren@oracle.com>"
LABEL description="OCI AI Chat - Self-service portal with AI-driven cloud operations"

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
COPY --from=builder --chown=portal:nodejs /app/oci-ai-chat/build ./build
COPY --from=builder --chown=portal:nodejs /app/oci-ai-chat/package.json ./

# Copy node_modules from the builder
COPY --from=builder --chown=portal:nodejs /app/node_modules ./node_modules

# Copy built workspace packages (dist + package.json for module resolution)
COPY --from=builder --chown=portal:nodejs /app/agent-state/dist ./agent-state/dist
COPY --from=builder --chown=portal:nodejs /app/agent-state/package.json ./agent-state/

COPY --from=builder --chown=portal:nodejs /app/mcp-client/dist ./mcp-client/dist
COPY --from=builder --chown=portal:nodejs /app/mcp-client/package.json ./mcp-client/

COPY --from=builder --chown=portal:nodejs /app/oci-genai-provider/dist ./oci-genai-provider/dist
COPY --from=builder --chown=portal:nodejs /app/oci-genai-provider/package.json ./oci-genai-provider/

COPY --from=builder --chown=portal:nodejs /app/oci-genai-query/dist ./oci-genai-query/dist
COPY --from=builder --chown=portal:nodejs /app/oci-genai-query/package.json ./oci-genai-query/

# Volume mount points:
#   /app/data          - Persistent application data (SQLite, etc.)
#   /wallets           - Oracle Database wallet files
#   /home/portal/.oci  - OCI CLI configuration (config, key files)
VOLUME ["/app/data", "/wallets", "/home/portal/.oci"]

USER portal

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["node", "build"]
