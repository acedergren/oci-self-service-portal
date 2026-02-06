-- 001-core.sql
-- Core application tables for OCI AI Chat on Oracle ADB 26AI
-- Created: 2026-02-06

-- Organizations table
CREATE TABLE organizations (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    name            VARCHAR2(255) NOT NULL UNIQUE,
    oci_compartment_id VARCHAR2(255),
    settings        CLOB,
    status          VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_org_settings CHECK (settings IS JSON)
);

-- Users table
CREATE TABLE users (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    email           VARCHAR2(255) NOT NULL UNIQUE,
    display_name    VARCHAR2(255),
    oidc_subject    VARCHAR2(255),
    oidc_issuer     VARCHAR2(512),
    status          VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

-- Organization members (many-to-many with role)
CREATE TABLE org_members (
    user_id         VARCHAR2(36) NOT NULL REFERENCES users(id),
    org_id          VARCHAR2(36) NOT NULL REFERENCES organizations(id),
    role            VARCHAR2(20) NOT NULL CHECK (role IN ('admin','operator','viewer')),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, org_id)
);

-- Authentication sessions
CREATE TABLE auth_sessions (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id         VARCHAR2(36) NOT NULL REFERENCES users(id),
    token_hash      VARCHAR2(255) NOT NULL,
    ip_address      VARCHAR2(45),
    user_agent      VARCHAR2(512),
    expires_at      TIMESTAMP NOT NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

-- Chat sessions
CREATE TABLE chat_sessions (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id         VARCHAR2(36) REFERENCES users(id),
    org_id          VARCHAR2(36) REFERENCES organizations(id),
    title           VARCHAR2(500),
    model           VARCHAR2(100) NOT NULL,
    region          VARCHAR2(50) NOT NULL,
    status          VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','completed','error')),
    config          CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_session_config CHECK (config IS JSON OR config IS NULL)
);

-- Chat turns (individual messages within a session)
CREATE TABLE chat_turns (
    id                  VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    session_id          VARCHAR2(36) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    turn_number         NUMBER NOT NULL,
    user_message        CLOB NOT NULL,
    assistant_response  CLOB,
    tool_calls          CLOB DEFAULT '[]',
    tokens_used         NUMBER,
    cost_usd            NUMBER(10,6),
    error               CLOB,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_turn_user_msg CHECK (user_message IS JSON),
    CONSTRAINT chk_turn_asst_resp CHECK (assistant_response IS JSON OR assistant_response IS NULL),
    CONSTRAINT chk_turn_tool_calls CHECK (tool_calls IS JSON),
    CONSTRAINT uq_session_turn UNIQUE (session_id, turn_number)
);

-- Tool executions (audit log for all tool invocations)
CREATE TABLE tool_executions (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    session_id      VARCHAR2(36) REFERENCES chat_sessions(id),
    user_id         VARCHAR2(36) REFERENCES users(id),
    org_id          VARCHAR2(36) REFERENCES organizations(id),
    tool_name       VARCHAR2(100) NOT NULL,
    tool_category   VARCHAR2(50) NOT NULL,
    approval_level  VARCHAR2(20) NOT NULL CHECK (approval_level IN ('auto','confirm','danger')),
    action          VARCHAR2(20) NOT NULL CHECK (action IN ('requested','approved','rejected','executed','failed')),
    args            CLOB,
    redacted_args   CLOB,
    success         NUMBER(1),
    error           CLOB,
    duration_ms     NUMBER,
    ip_address      VARCHAR2(45),
    user_agent      VARCHAR2(512),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_exec_args CHECK (args IS JSON OR args IS NULL),
    CONSTRAINT chk_exec_redacted CHECK (redacted_args IS JSON OR redacted_args IS NULL)
);

-- Pending approvals for dangerous tool operations
CREATE TABLE pending_approvals (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    session_id      VARCHAR2(36) REFERENCES chat_sessions(id),
    user_id         VARCHAR2(36) REFERENCES users(id),
    tool_name       VARCHAR2(100) NOT NULL,
    tool_category   VARCHAR2(50) NOT NULL,
    approval_level  VARCHAR2(20) NOT NULL,
    args            CLOB,
    status          VARCHAR2(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
    expires_at      TIMESTAMP NOT NULL,
    resolved_by     VARCHAR2(36) REFERENCES users(id),
    resolved_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_approval_args CHECK (args IS JSON OR args IS NULL)
);

-- Indexes for chat_sessions
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_org ON chat_sessions(org_id);

-- Indexes for chat_turns
CREATE INDEX idx_chat_turns_session ON chat_turns(session_id);

-- Indexes for tool_executions
CREATE INDEX idx_tool_executions_session ON tool_executions(session_id);
CREATE INDEX idx_tool_executions_user ON tool_executions(user_id);
CREATE INDEX idx_tool_executions_tool ON tool_executions(tool_name);
CREATE INDEX idx_tool_executions_created ON tool_executions(created_at);

-- Indexes for pending_approvals
CREATE INDEX idx_pending_approvals_status ON pending_approvals(status);

-- Indexes for auth_sessions
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
