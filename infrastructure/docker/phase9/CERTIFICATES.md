# Certificate Management (Phase 9)

This runbook covers TLS certificate setup for the Nginx reverse proxy in
`infrastructure/docker/phase9`.

## Paths Used By Nginx

- Certificate chain: `TLS_CERT_PATH/fullchain.pem`
- Private key: `TLS_KEY_PATH/privkey.pem`
- DH params: `DH_PARAMS_PATH` (**required** — see below)

Default paths from `.env`:

- `TLS_CERT_PATH=./certs`
- `TLS_KEY_PATH=./certs`
- `DH_PARAMS_PATH=./certs/dhparam.pem`

### DH Parameters (Required Prerequisite)

The `docker-compose.yml` bind-mounts `DH_PARAMS_PATH` into nginx unconditionally.
If the file does not exist, Docker will either create an empty directory at the
mount path (Linux) or fail to start the container (macOS). **You must generate
this file before running `docker compose up`.**

```bash
mkdir -p infrastructure/docker/phase9/certs
openssl dhparam -out infrastructure/docker/phase9/certs/dhparam.pem 2048
```

> **Note**: DH param generation takes 5–30 seconds depending on hardware. This is a
> one-time operation — the file persists across container restarts.

## Development: Self-Signed Certificate

For local development only — browsers will show a warning.

```bash
mkdir -p infrastructure/docker/phase9/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infrastructure/docker/phase9/certs/privkey.pem \
  -out infrastructure/docker/phase9/certs/fullchain.pem \
  -subj "/CN=localhost"
```

> **Never use self-signed certificates in production.**

## Option 1: Let's Encrypt (Certbot)

1. Configure DNS so `TLS_DOMAIN` points to this host.
2. Set in `.env`:

- `TLS_DOMAIN=portal.example.com`
- `CERTBOT_EMAIL=ops@example.com`

3. Start nginx first (required for HTTP-01 challenge):

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml up -d nginx api frontend
```

4. Request the initial certificate:

```bash
docker compose --profile letsencrypt -f infrastructure/docker/phase9/docker-compose.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d "$TLS_DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos --non-interactive --no-eff-email
```

5. Copy certbot live files to nginx default paths:

```bash
cp "infrastructure/docker/phase9/certs/live/$TLS_DOMAIN/fullchain.pem" infrastructure/docker/phase9/certs/fullchain.pem
cp "infrastructure/docker/phase9/certs/live/$TLS_DOMAIN/privkey.pem" infrastructure/docker/phase9/certs/privkey.pem
```

6. Reload nginx:

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -s reload
```

7. Enable auto-renew service:

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml --profile letsencrypt up -d certbot
```

## Option 2: OCI Certificates Service

OCI Certificates Service can issue CA-signed certificates or manage imported ones
with automated lifecycle policies.

### Import an Existing Certificate

```bash
# Import a certificate into OCI Certificates
oci certs-mgmt certificate create-by-importing-config \
  --compartment-id "$COMPARTMENT_ID" \
  --name "portal-tls" \
  --cert-chain-pem-file ./certs/chain.pem \
  --certificate-pem-file ./certs/cert.pem \
  --private-key-pem-file ./certs/privkey.pem
```

### Issue via OCI Private CA

```bash
# List available certificate authorities
oci certs-mgmt certificate-authority list \
  --compartment-id "$COMPARTMENT_ID" \
  --all

# Create a certificate issued by your private CA
oci certs-mgmt certificate create-certificate-managed-externally-issued-by-internal-ca \
  --compartment-id "$COMPARTMENT_ID" \
  --name "portal-tls" \
  --certificate-authority-id "$CA_OCID" \
  --subject '{"commonName": "portal.example.com"}'
```

### Download and Deploy

```bash
# Get the certificate bundle
CERT_ID="ocid1.certificate.oc1..."
oci certs certificate-bundle get \
  --certificate-id "$CERT_ID" \
  --bundle-type CERTIFICATE_CONTENT_WITH_PRIVATE_KEY \
  --query 'data' --output json > /tmp/cert-bundle.json

# Extract PEM files from the JSON bundle
jq -r '."cert-chain-pem"' /tmp/cert-bundle.json > infrastructure/docker/phase9/certs/fullchain.pem
jq -r '."private-key-pem"' /tmp/cert-bundle.json > infrastructure/docker/phase9/certs/privkey.pem

# Clean up (contains private key material)
rm -f /tmp/cert-bundle.json
```

### Reload Nginx

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -t && \
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -s reload
```

### OCI Renewal Policy

Configure an OCI lifecycle rule to auto-renew certificates issued by a private CA.
For imported certificates, set a reminder at 30 days before expiry and re-import manually.

## Auto-Renewal Strategy

### Docker Certbot Service (Recommended)

The `certbot` service in `docker-compose.yml` (profile `letsencrypt`) runs a
renewal loop every 12 hours. Enable it:

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml --profile letsencrypt up -d certbot
```

The loop copies renewed certs to the nginx paths automatically. Nginx must be
reloaded to pick up the new keypair — add a post-renewal hook:

```bash
# Inside the certbot container entrypoint, after certbot renew:
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -s reload
```

### Host-Level Cron (Alternative)

If not using the Docker certbot service, schedule a cron job on the host:

```cron
# /etc/cron.d/portal-cert-renew
# Attempt renewal twice daily (Let's Encrypt recommends this cadence)
0 2,14 * * * root certbot renew --webroot -w /var/www/certbot --quiet --deploy-hook "docker exec portal-nginx nginx -s reload" >> /var/log/certbot-renew.log 2>&1
```

### OCI Certificates

For certificates managed by OCI private CA, renewal is handled by the OCI
lifecycle policy. For imported certificates, re-import before expiry and
redeploy using the download steps above.

### Key Rule

**Always reload nginx after cert replacement** — nginx caches the keypair in
memory and will not read the new files until signalled.

## Monitoring And Alerting

Minimum required checks:

1. TLS endpoint health (`https://<domain>/health`) every 1 minute.
2. Certificate expiry days remaining daily.
3. Alert thresholds:

- Warning: `< 30` days
- Critical: `< 14` days
- Emergency: `< 7` days

Example expiry check:

```bash
openssl x509 -in infrastructure/docker/phase9/certs/fullchain.pem -noout -enddate
```

Automatable expiry check (returns non-zero on warning/critical):

```bash
infrastructure/docker/phase9/check-certificate-expiry.sh infrastructure/docker/phase9/certs/fullchain.pem
```

Custom thresholds:

```bash
WARNING_DAYS=45 CRITICAL_DAYS=21 infrastructure/docker/phase9/check-certificate-expiry.sh
```

Recommended alert destinations:

- Pager (critical/emergency)
- Slack/Teams (warning)
- Ticket creation for `< 30` day warning

## Emergency Procedures (Expired Certificate)

If the TLS certificate has expired, HTTPS connections will fail with
`ERR_CERT_DATE_INVALID`. Follow these steps in order:

### 1. Confirm Expiry

```bash
# Check from the host
openssl s_client -connect localhost:443 -servername portal.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates

# Or check the cert file directly
openssl x509 -in infrastructure/docker/phase9/certs/fullchain.pem -noout -enddate
```

### 2. Immediate Fix: Force Certbot Renewal

```bash
# Force renewal (skip the "not yet due" check)
docker compose -f infrastructure/docker/phase9/docker-compose.yml --profile letsencrypt run --rm certbot \
  renew --force-renewal --webroot -w /var/www/certbot

# Copy renewed certs
TLS_DOMAIN="portal.example.com"  # or from .env
cp "infrastructure/docker/phase9/certs/live/$TLS_DOMAIN/fullchain.pem" infrastructure/docker/phase9/certs/fullchain.pem
cp "infrastructure/docker/phase9/certs/live/$TLS_DOMAIN/privkey.pem" infrastructure/docker/phase9/certs/privkey.pem

# Reload nginx
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -t && \
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -s reload
```

### 3. Fallback: Generate Temporary Self-Signed Certificate

If certbot cannot renew (DNS issue, rate limit, etc.), restore HTTPS with a
self-signed cert while the root cause is resolved:

```bash
openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
  -keyout infrastructure/docker/phase9/certs/privkey.pem \
  -out infrastructure/docker/phase9/certs/fullchain.pem \
  -subj "/CN=portal.example.com"

docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -s reload
```

> **Warning**: Self-signed certs trigger browser warnings. Replace with a
> CA-signed cert as soon as possible.

### 4. Post-Incident

1. Verify the new cert is valid: `check-certificate-expiry.sh`
2. Investigate why auto-renewal failed (check certbot logs, DNS, rate limits)
3. Confirm the cron job or certbot container is running
4. File an incident report documenting root cause and remediation

## Rotation Checklist

1. Install new `fullchain.pem` and `privkey.pem`.
2. Validate syntax:

```bash
docker compose -f infrastructure/docker/phase9/docker-compose.yml exec nginx nginx -t
```

3. Reload nginx.
4. Verify external TLS handshake and expiry date.
5. Confirm monitoring alerts are cleared.
