# Observability Stack: Grafana + Tempo

Complete observability stack for CloudNow with distributed tracing via Grafana Tempo and visualization via Grafana.

## Services

### Tempo (Distributed Tracing)

Grafana Tempo is a scalable distributed tracing backend that stores traces efficiently on disk.

**Ports:**
- `3200`: Tempo HTTP API (health checks, query UI)
- `4317`: OpenTelemetry Protocol (OTLP) gRPC receiver
- `4318`: OpenTelemetry Protocol (OTLP) HTTP receiver

**Features:**
- Scalable trace ingestion with rate limiting (10k/sec default)
- Local storage backend for development
- Service graph generation from traces
- Span metrics extraction

### Grafana

Web interface for visualization and querying traces, metrics, and logs.

**Ports:**
- `3000`: Grafana UI (http://localhost:3000)
- Default credentials: `admin` / `admin`

**Pre-configured Datasources:**
- **Tempo** (default): Distributed tracing backend
- **Prometheus** (optional): Metrics (not included in compose)
- **Loki** (optional): Logs (not included in compose)

## Quick Start

### Start the stack

```bash
cd infrastructure/docker/observability
docker compose up -d
```

### Access Grafana

Open http://localhost:3000 in your browser.

1. Log in with `admin` / `admin`
2. Navigate to **Explore** to query Tempo traces
3. Select **Tempo** datasource to visualize traces

### Send traces to Tempo

Configure your application to export traces to Tempo via OTLP:

```typescript
// OTLP HTTP exporter example
const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces'
});

const tracerProvider = new BasicTracerProvider();
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
```

Or via gRPC:

```typescript
const exporter = new OTLPTraceExporter({
  url: 'grpc://localhost:4317'
});
```

### Stop the stack

```bash
docker compose down
```

## Configuration Files

- **docker-compose.yml**: Service definitions, ports, health checks, volumes
- **tempo/tempo-config.yaml**: Tempo backend configuration (storage, ingestion, querying)
- **grafana/datasources/tempo.yaml**: Grafana datasource auto-provisioning (Tempo connection)

## Architecture

```
Application
    ↓ (OTLP traces)
Tempo Receiver (port 4317/4318)
    ↓
Tempo Storage (/var/tempo)
    ↓
Grafana
    ↓ (HTTP API)
Browser UI (port 3000)
```

## Volumes

- **tempo-storage**: Tempo trace data and WAL
- **grafana-storage**: Grafana dashboards, users, and settings

## Health Checks

Both services include health checks:

- **Tempo**: `curl http://localhost:3200/status`
- **Grafana**: `curl http://localhost:3000/api/health`

Docker will mark services as unhealthy if checks fail 3+ times in 30s.

## Troubleshooting

### Tempo not receiving traces

1. Verify Tempo is running: `docker compose ps`
2. Check logs: `docker compose logs tempo`
3. Test connectivity: `curl http://localhost:3200/status`
4. Verify OTLP receiver is enabled in `tempo-config.yaml`

### Grafana can't connect to Tempo

1. Verify both services are in same network: `docker network ls`
2. Check datasource connection in Grafana settings
3. Ensure Tempo is running: `docker compose logs grafana` for connection errors

### High memory usage

Adjust Tempo storage settings in `tempo-config.yaml`:
- Reduce `max_block_duration` to flush traces more frequently
- Reduce `trace_idle_period` to archive completed traces sooner
- Enable compression in WAL

## Production Considerations

For production deployments:

1. **Persistence**: Use external object storage (S3, GCS) instead of local disks
2. **Scaling**: Deploy multiple Tempo instances with distributed hash ring
3. **Retention**: Configure `compacted_block_retention` per your data volume
4. **Security**: Add authentication, TLS, and network policies
5. **Monitoring**: Monitor Tempo itself with Prometheus metrics
6. **Backup**: Regular backups of trace data and Grafana configurations

## Further Documentation

- [Tempo Documentation](https://grafana.com/docs/tempo/)
- [Grafana Documentation](https://grafana.com/docs/grafana/)
- [OpenTelemetry Protocol](https://opentelemetry.io/docs/reference/specification/protocol/)
