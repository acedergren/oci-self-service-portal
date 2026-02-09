#!/bin/bash
# Pre-write: validate Oracle migration filenames follow NNN-name.sql pattern
# and that version numbers are sequential
set -e

INPUT=$(cat)

# Extract file path
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
else
  FILE_PATH=""
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check files in the migrations directory
if ! echo "$FILE_PATH" | grep -q '/oracle/migrations/'; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

# Skip non-SQL files (e.g., migrations.ts)
if ! echo "$BASENAME" | grep -qE '\.sql$'; then
  exit 0
fi

# Validate filename format: NNN-kebab-name.sql
if ! echo "$BASENAME" | grep -qE '^[0-9]{3}-[a-zA-Z0-9_-]+\.sql$'; then
  echo "BLOCKED: Invalid migration filename: $BASENAME" >&2
  echo "Expected format: NNN-name.sql (e.g., 009-notifications.sql)" >&2
  exit 2
fi

# Extract version number from new file
NEW_VERSION=$(echo "$BASENAME" | grep -oE '^[0-9]+')

# Find highest existing migration version
MIGRATIONS_DIR=$(dirname "$FILE_PATH")
if [ -d "$MIGRATIONS_DIR" ]; then
  HIGHEST=$(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | xargs -I{} basename {} | grep -oE '^[0-9]+' | sort -n | tail -1)
  if [ -n "$HIGHEST" ]; then
    EXPECTED=$((HIGHEST + 1))
    EXPECTED_PADDED=$(printf "%03d" "$EXPECTED")
    if [ "$NEW_VERSION" != "$EXPECTED_PADDED" ] && [ "$NEW_VERSION" != "$(printf '%03d' "$HIGHEST")" ]; then
      # Allow overwriting existing or creating next sequential
      if [ "$((10#$NEW_VERSION))" -gt "$((EXPECTED))" ]; then
        echo "WARNING: Migration version gap detected. Expected $EXPECTED_PADDED, got $NEW_VERSION" >&2
        echo "Existing highest version: $HIGHEST" >&2
        # Warn but don't block — there may be valid reasons for gaps
      fi
    fi
  fi
fi

exit 0
