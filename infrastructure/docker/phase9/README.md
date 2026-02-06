# Phase 9: Multi-Service Docker Deployment

This directory contains Docker configurations for the Phase 9 Fastify backend migration.

## Architecture

```
┌─────────────────────────────────────────────┐
│           docker-compose.yml                │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐      ┌──────────────┐   │
│  │  frontend    │─────▶│     api      │   │
│  │  (SvelteKit) │      │  (Fastify)   │   │
│  │  Port 5173   │      │  Port 3001   │   │
│  └──────────────┘      └──────────────┘   │
│         │                      │           │
│         │                      │           │
│         └──────────────────────┘           │
│              Shared Network                │
│                                             │
│  External: Oracle Autonomous Database      │
└─────────────────────────────────────────────┘
```

## Services

### 1. Frontend (SvelteKit)
- **Port**: 5173 (development), 3000 (production with adapter-node)
- **Dependencies**: api service
- **Environment**:
  - `API_URL=http://api:3001` - Internal Docker network communication
  - `PUBLIC_API_URL=http://localhost:3001` - Browser-side API access

### 2. API (Fastify)
- **Port**: 3001
- **Dependencies**: Oracle ADB (external)
- **Environment**:
  - `DATABASE_URL` - Oracle connection string
  - `BETTER_AUTH_SECRET` - Auth session encryption key
  - `OCI_REGION` - Oracle Cloud region
  - `LOG_LEVEL=info` - Pino logging level

### 3. Database (Oracle Autonomous Database)
- **Type**: External managed service (not containerized)
- **Connection**: Via wallet files mounted at `/wallets`
- **Services**: `langflowdb_high`, `langflowdb_medium`, `langflowdb_low`

## Files

- `Dockerfile.frontend` - Multi-stage build for SvelteKit app
- `Dockerfile.api` - Multi-stage build for Fastify backend
- `docker-compose.yml` - Orchestrates frontend + api services
- `docker-compose.dev.yml` - Development overrides with hot-reload
- `.dockerignore.frontend` - Frontend build context exclusions
- `.dockerignore.api` - API build context exclusions

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
# Build and start
docker compose up -d

# Check health
docker compose ps
curl http://localhost:3001/health
curl http://localhost:5173/api/health

# View metrics
curl http://localhost:3001/metrics
```

## Health Checks

Both services implement health check endpoints:
- **API**: `GET /health` - Returns database connectivity status
- **Frontend**: `GET /api/health` - Proxies to API health check

## Volumes

- `api_data:/app/data` - Persistent API data (SQLite fallbacks, logs)
- `frontend_data:/app/.svelte-kit` - Frontend build cache
- `/data/wallets:/wallets:ro` - Oracle wallet (read-only, host mount)
- `~/.oci:/home/portal/.oci:ro` - OCI CLI config (read-only, host mount)

## Network

Services communicate via a custom bridge network:
- **Name**: `portal-network`
- **Driver**: bridge
- **Internal DNS**: Services accessible by service name (e.g., `http://api:3001`)

## Security

- Non-root users (UID 1001)
- Read-only wallet mounts
- No hardcoded secrets (all via environment variables)
- Resource limits (2GB memory, 1.0 CPU per service)
- Health checks with automatic restarts

## Migration Path

This configuration supports incremental migration:

1. **Phase 9.0**: Both services run, frontend still uses `/api/*` routes internally
2. **Phase 9.1**: Frontend switches to `fetch('http://api:3001/*')` for direct API calls
3. **Phase 9.2**: Remove SvelteKit API routes, all logic in Fastify
4. **Phase 9.3**: Add Nginx reverse proxy for production routing

## Troubleshooting

### API won't start
```bash
# Check database connectivity
docker compose exec api sh -c 'curl http://localhost:3001/health'

# View logs
docker compose logs api

# Check environment
docker compose exec api env | grep DATABASE
```

### Frontend can't reach API
```bash
# Test internal network
docker compose exec frontend sh -c 'curl http://api:3001/health'

# Check DNS resolution
docker compose exec frontend nslookup api
```

### Build failures
```bash
# Clean build cache
docker compose build --no-cache

# Check build context
docker compose build --progress=plain
```

## Performance

Expected resource usage:
- **API**: ~200MB memory, 0.1-0.5 CPU
- **Frontend**: ~150MB memory, 0.1-0.3 CPU
- **Total**: ~350MB memory, 0.2-0.8 CPU

Startup times:
- **API**: ~3-5 seconds (database connection pool init)
- **Frontend**: ~2-3 seconds (SvelteKit server startup)
