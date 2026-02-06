-- 007-ai-features.sql
-- Oracle Text search and blockchain audit for Phase 8 AI features
-- Requires: 001-core.sql (chat_turns, organizations, users)
-- Created: 2026-02-06

-- Oracle Text index on chat_turns(user_message) for hybrid keyword+vector search
-- Uses CTXSYS.CONTEXT index for full-text search with JSON awareness
CREATE INDEX idx_chat_turns_text ON chat_turns(user_message)
    INDEXTYPE IS CTXSYS.CONTEXT
    PARAMETERS ('SYNC (ON COMMIT)');

-- Blockchain audit table — immutable ledger for compliance
-- Uses Oracle Blockchain Table (NO DROP/DELETE for 365 days)
-- SHA2_256 chain hashing ensures tamper detection
CREATE BLOCKCHAIN TABLE audit_blockchain
    NO DROP UNTIL 365 DAYS IDLE
    NO DELETE UNTIL 365 DAYS AFTER INSERT
    HASHING USING "SHA2_256" VERSION "v2"
(
    id              RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id         VARCHAR2(36) NOT NULL,
    org_id          VARCHAR2(36),
    action          VARCHAR2(100) NOT NULL,
    tool_name       VARCHAR2(100),
    resource_type   VARCHAR2(100),
    resource_id     VARCHAR2(255),
    detail          CLOB,
    ip_address      VARCHAR2(45),
    request_id      VARCHAR2(50),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_audit_detail CHECK (detail IS JSON OR detail IS NULL)
);

-- Indexes for audit_blockchain (read-only lookups)
CREATE INDEX idx_audit_bc_user ON audit_blockchain(user_id);
CREATE INDEX idx_audit_bc_org ON audit_blockchain(org_id);
CREATE INDEX idx_audit_bc_action ON audit_blockchain(action);
CREATE INDEX idx_audit_bc_tool ON audit_blockchain(tool_name);
CREATE INDEX idx_audit_bc_created ON audit_blockchain(created_at);
CREATE INDEX idx_audit_bc_resource ON audit_blockchain(resource_type, resource_id);
