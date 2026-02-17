#!/bin/bash
# Block edits to sensitive files: .env, keys, wallets, credentials
# Triggered by PreToolUse on Edit/Write tools
set -e

INPUT=$(cat)

# Extract the file path from tool input
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
else
  # Fail-closed: if jq is unavailable, we cannot verify the file is safe
  echo "BLOCKED: jq is required for sensitive-file detection but not installed" >&2
  exit 2
fi

# Nothing to check if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Get just the filename for pattern matching
BASENAME=$(basename "$FILE_PATH")

# Block patterns: .env files, private keys, wallets, credential files
# Allow template/example files — they contain no real secrets
if echo "$BASENAME" | grep -qiE '\.(example|sample|template)$'; then
  exit 0
fi

if echo "$BASENAME" | grep -qiE '^\.env(\.|$)'; then
  echo "BLOCKED: Refusing to edit .env file: $BASENAME" >&2
  echo "Store secrets in OCI Vault, not in dotenv files." >&2
  exit 2
fi

if echo "$BASENAME" | grep -qiE '\.(pem|key|p12|pfx|jks|keystore)$'; then
  echo "BLOCKED: Refusing to edit key/certificate file: $BASENAME" >&2
  exit 2
fi

if echo "$FILE_PATH" | grep -qiE 'wallet|credential'; then
  echo "BLOCKED: Refusing to edit wallet/credential file: $FILE_PATH" >&2
  exit 2
fi

if echo "$BASENAME" | grep -qiE '^(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$'; then
  echo "BLOCKED: Refusing to edit SSH key file: $BASENAME" >&2
  exit 2
fi

exit 0
