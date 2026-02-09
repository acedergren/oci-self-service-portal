#!/bin/bash
# Manage secrets in OCI Vault (AC compartment)
# Usage: ./manage-secrets.sh <command> [args...]
#
# Commands:
#   upload <name> <value>     Create or update a secret
#   find <pattern>            Search secrets by name (substring match)
#   list                      List all secrets in vault
#   get <name>                Retrieve a secret's current value
#   delete <name>             Schedule secret for deletion

set -e

# AC Compartment and Vault (eu-frankfurt-1)
COMPARTMENT_ID="ocid1.compartment.oc1..aaaaaaaarekfofhmfup6d33agbnicuop2waas3ssdwdc7qjgencirdgvl3iq"
VAULT_ID="ocid1.vault.oc1.eu-frankfurt-1.bfpizfqyaacmg.abtheljtdamq6fycneeey5q4sfeoek6esnjvvkmno6obhv4pmwn4vzjcuprq"
KMS_ENDPOINT="https://bfpizfqyaacmg-management.kms.eu-frankfurt-1.oraclecloud.com"
REGION="eu-frankfurt-1"

COMMAND="${1:?Usage: $0 <upload|find|list|get|delete> [args...]}"
shift

case "$COMMAND" in
  upload)
    SECRET_NAME="${1:?Usage: $0 upload <secret-name> [secret-value]}"
    SECRET_VALUE="${2:-}"

    # If secret value not provided as argument, read from stdin
    if [ -z "$SECRET_VALUE" ]; then
      read -r SECRET_VALUE || true
      if [ -z "$SECRET_VALUE" ]; then
        echo "Usage: $0 upload <secret-name> [secret-value]"
        echo "  Provide secret as argument or via stdin (more secure)"
        exit 1
      fi
    fi

    # Get master encryption key
    KEY_ID=$(oci --endpoint "$KMS_ENDPOINT" kms management key list \
      --compartment-id "$COMPARTMENT_ID" \
      --query 'data[0].id' --raw-output 2>/dev/null)

    if [ -z "$KEY_ID" ] || [ "$KEY_ID" = "null" ]; then
      echo "Error: Could not find encryption key in vault"
      exit 1
    fi

    # Check if secret already exists (include ACTIVE lifecycle state)
    EXISTING_SECRET=$(oci vault secret list \
      --compartment-id "$COMPARTMENT_ID" \
      --name "$SECRET_NAME" \
      --lifecycle-state ACTIVE \
      --region "$REGION" \
      --query 'data[0].id' --raw-output 2>/dev/null || echo "")

    # Base64 encode the secret value
    SECRET_BASE64=$(echo -n "$SECRET_VALUE" | base64)

    if [ -n "$EXISTING_SECRET" ] && [ "$EXISTING_SECRET" != "null" ]; then
      echo "Updating existing secret: $SECRET_NAME"
      oci vault secret update-base64 \
        --secret-id "$EXISTING_SECRET" \
        --secret-content-content "$SECRET_BASE64" \
        --region "$REGION" \
        --query 'data.id' --raw-output
    else
      echo "Creating new secret: $SECRET_NAME"
      oci vault secret create-base64 \
        --compartment-id "$COMPARTMENT_ID" \
        --vault-id "$VAULT_ID" \
        --key-id "$KEY_ID" \
        --secret-name "$SECRET_NAME" \
        --secret-content-content "$SECRET_BASE64" \
        --region "$REGION" \
        --query 'data.id' --raw-output
    fi

    echo "Secret '$SECRET_NAME' saved to AC vault"
    ;;

  find)
    PATTERN="${1:?Usage: $0 find <pattern>}"

    # List all active secrets and filter by pattern
    oci vault secret list \
      --compartment-id "$COMPARTMENT_ID" \
      --lifecycle-state ACTIVE \
      --region "$REGION" \
      --query "data[?contains(\"secret-name\", '$PATTERN')].{name:\"secret-name\", id:id, state:\"lifecycle-state\", created:\"time-created\"}" \
      --output table 2>/dev/null || echo "No secrets found matching '$PATTERN'"
    ;;

  list)
    # List all active secrets
    oci vault secret list \
      --compartment-id "$COMPARTMENT_ID" \
      --lifecycle-state ACTIVE \
      --region "$REGION" \
      --query 'data[].{name:"secret-name", id:id, created:"time-created"}' \
      --output table 2>/dev/null || echo "No secrets found in vault"
    ;;

  get)
    SECRET_NAME="${1:?Usage: $0 get <secret-name>}"

    # Find the secret OCID by name
    SECRET_ID=$(oci vault secret list \
      --compartment-id "$COMPARTMENT_ID" \
      --name "$SECRET_NAME" \
      --lifecycle-state ACTIVE \
      --region "$REGION" \
      --query 'data[0].id' --raw-output 2>/dev/null || echo "")

    if [ -z "$SECRET_ID" ] || [ "$SECRET_ID" = "null" ]; then
      echo "Error: Secret '$SECRET_NAME' not found"
      exit 1
    fi

    # Retrieve the secret bundle (current version)
    SECRET_CONTENT=$(oci secrets secret-bundle get \
      --secret-id "$SECRET_ID" \
      --region "$REGION" \
      --query 'data."secret-bundle-content".content' \
      --raw-output 2>/dev/null)

    if [ -z "$SECRET_CONTENT" ] || [ "$SECRET_CONTENT" = "null" ]; then
      echo "Error: Could not retrieve secret content"
      exit 1
    fi

    # Decode and output (handle macOS and Linux base64 syntax)
    echo -n "$SECRET_CONTENT" | base64 --decode 2>/dev/null || base64 -D
    ;;

  delete)
    SECRET_NAME="${1:?Usage: $0 delete <secret-name>}"

    # Find the secret OCID by name
    SECRET_ID=$(oci vault secret list \
      --compartment-id "$COMPARTMENT_ID" \
      --name "$SECRET_NAME" \
      --lifecycle-state ACTIVE \
      --region "$REGION" \
      --query 'data[0].id' --raw-output 2>/dev/null || echo "")

    if [ -z "$SECRET_ID" ] || [ "$SECRET_ID" = "null" ]; then
      echo "Error: Secret '$SECRET_NAME' not found"
      exit 1
    fi

    # Schedule deletion (OCI uses deferred deletion, not immediate)
    echo "Scheduling deletion for secret: $SECRET_NAME"
    oci vault secret schedule-secret-deletion \
      --secret-id "$SECRET_ID" \
      --region "$REGION" 2>/dev/null

    echo "Secret '$SECRET_NAME' scheduled for deletion (recoverable during waiting period)"
    ;;

  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: $0 <upload|find|list|get|delete> [args...]"
    exit 1
    ;;
esac
