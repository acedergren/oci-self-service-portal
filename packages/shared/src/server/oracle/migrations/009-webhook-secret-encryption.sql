-- 009-webhook-secret-encryption.sql
-- Encrypt webhook signing secrets at rest (Task #30)
-- Requires: 006-api-keys.sql (webhook_subscriptions table)
-- Created: 2026-02-07

-- Increase secret column size to fit AES-GCM ciphertext + auth tag payload.
ALTER TABLE webhook_subscriptions
MODIFY (secret VARCHAR2(2048));

-- IV for AES-256-GCM (base64url-encoded, 12 bytes raw).
ALTER TABLE webhook_subscriptions
ADD (secret_iv VARCHAR2(64));

CREATE INDEX idx_webhooks_secret_iv ON webhook_subscriptions(secret_iv);
