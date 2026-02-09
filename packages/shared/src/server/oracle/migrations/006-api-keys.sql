-- 006-api-keys.sql
-- API keys and webhook subscriptions for Phase 8 external integrations
-- Requires: 001-core.sql (organizations)
-- Created: 2026-02-06

-- API keys for programmatic access (REST API, CI/CD pipelines)
CREATE TABLE api_keys (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    org_id          VARCHAR2(36) NOT NULL REFERENCES organizations(id),
    key_hash        VARCHAR2(128) NOT NULL,
    key_prefix      VARCHAR2(20) NOT NULL,
    name            VARCHAR2(255) NOT NULL,
    permissions     CLOB NOT NULL,
    status          VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','revoked')),
    last_used_at    TIMESTAMP,
    expires_at      TIMESTAMP,
    revoked_at      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_api_key_permissions CHECK (permissions IS JSON),
    CONSTRAINT uq_api_key_hash UNIQUE (key_hash)
);

-- Webhook subscriptions for event-driven integrations
CREATE TABLE webhook_subscriptions (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    org_id          VARCHAR2(36) NOT NULL REFERENCES organizations(id),
    url             VARCHAR2(2000) NOT NULL,
    events          CLOB NOT NULL,
    secret          VARCHAR2(128),
    status          VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','paused','failed')),
    failure_count   NUMBER DEFAULT 0 NOT NULL,
    max_retries     NUMBER DEFAULT 3 NOT NULL,
    last_fired_at   TIMESTAMP,
    last_error      VARCHAR2(2000),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_webhook_events CHECK (events IS JSON)
);

-- Webhook delivery log for debugging and retry
CREATE TABLE webhook_deliveries (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    subscription_id VARCHAR2(36) NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event_type      VARCHAR2(50) NOT NULL,
    payload         CLOB NOT NULL,
    status          VARCHAR2(20) DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','retrying')),
    http_status     NUMBER,
    response_body   CLOB,
    attempt_count   NUMBER DEFAULT 0 NOT NULL,
    next_retry_at   TIMESTAMP,
    delivered_at    TIMESTAMP,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_delivery_payload CHECK (payload IS JSON)
);

-- Indexes for api_keys
CREATE INDEX idx_api_keys_org ON api_keys(org_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- Indexes for webhook_subscriptions
CREATE INDEX idx_webhooks_org ON webhook_subscriptions(org_id);
CREATE INDEX idx_webhooks_status ON webhook_subscriptions(status);

-- Indexes for webhook_deliveries
CREATE INDEX idx_webhook_del_sub ON webhook_deliveries(subscription_id);
CREATE INDEX idx_webhook_del_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_del_retry ON webhook_deliveries(next_retry_at);
