# Observability Stack

Docker Compose setup for Grafana and Tempo distributed tracing.

## Quick Start

```bash
# Start the observability stack
cd apps/api/docker
docker compose -f docker-compose.observability.yml up -d

# View logs
docker compose -f docker-compose.observability.yml logs -f

# Stop the stack
docker compose -f docker-compose.observability.yml down
```

## Services

### Grafana (Port 3001)

- **URL**: http://localhost:3001
- **Auth**: Anonymous auth enabled (dev mode)
- **Datasource**: Tempo pre-configured

### Tempo (Ports 4317, 4318, 3200)

- **OTLP gRPC**: http://localhost:4317
- **OTLP HTTP**: http://localhost:4318
- **Tempo API**: http://localhost:3200

## API Configuration

Set the following environment variable in your API `.env`:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Security Features

Both services run with security hardening:

- Read-only root filesystem
- No privilege escalation (`no-new-privileges:true`)
- Tmpfs mounts for runtime directories
- Config files mounted read-only

## Data Persistence

Volumes persist data across container restarts:

- `tempo-data`: Trace storage (WAL and blocks)
- `grafana-data`: Grafana dashboards and settings

## Trace Retention

Tempo is configured with 48-hour trace retention (configurable in `tempo/tempo.yml`).
