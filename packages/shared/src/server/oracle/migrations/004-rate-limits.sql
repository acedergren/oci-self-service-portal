-- 004-rate-limits.sql
-- DB-backed rate limiting for Phase 4
-- Created: 2026-02-06

CREATE TABLE rate_limits (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    client_key      VARCHAR2(255) NOT NULL,
    endpoint        VARCHAR2(100) NOT NULL,
    window_start    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    request_count   NUMBER DEFAULT 1 NOT NULL,
    CONSTRAINT uq_rate_limit_window UNIQUE (client_key, endpoint, window_start)
);

-- Index for cleanup of expired windows
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

-- Index for fast lookups by client and endpoint
CREATE INDEX idx_rate_limits_client ON rate_limits(client_key, endpoint);
