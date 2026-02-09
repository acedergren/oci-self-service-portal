#!/usr/bin/env bash
set -euo pipefail

# Exit codes:
#   0 = healthy
#   1 = warning
#   2 = critical
#   3 = error (missing cert / parse failure)

CERT_PATH="${1:-infrastructure/docker/phase9/certs/fullchain.pem}"
WARNING_DAYS="${WARNING_DAYS:-30}"
CRITICAL_DAYS="${CRITICAL_DAYS:-14}"

if [[ ! -f "$CERT_PATH" ]]; then
  echo "ERROR: certificate not found at $CERT_PATH"
  exit 3
fi

not_after_raw="$(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2-)"
if [[ -z "$not_after_raw" ]]; then
  echo "ERROR: unable to parse certificate expiry from $CERT_PATH"
  exit 3
fi

not_after_epoch="$(date -j -f "%b %e %T %Y %Z" "$not_after_raw" +%s 2>/dev/null || true)"
if [[ -z "$not_after_epoch" ]]; then
  # GNU date fallback
  not_after_epoch="$(date -d "$not_after_raw" +%s 2>/dev/null || true)"
fi

if [[ -z "$not_after_epoch" ]]; then
  echo "ERROR: unable to convert certificate expiry date ($not_after_raw) to epoch"
  exit 3
fi

now_epoch="$(date +%s)"
seconds_remaining="$((not_after_epoch - now_epoch))"
days_remaining="$((seconds_remaining / 86400))"

if (( days_remaining < 0 )); then
  echo "CRITICAL: certificate expired ${days_remaining#-} days ago ($not_after_raw)"
  exit 2
fi

if (( days_remaining < CRITICAL_DAYS )); then
  echo "CRITICAL: certificate expires in $days_remaining days ($not_after_raw)"
  exit 2
fi

if (( days_remaining < WARNING_DAYS )); then
  echo "WARNING: certificate expires in $days_remaining days ($not_after_raw)"
  exit 1
fi

echo "OK: certificate expires in $days_remaining days ($not_after_raw)"
