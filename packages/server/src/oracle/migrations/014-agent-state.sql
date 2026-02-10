--------------------------------------------------------------------------------
-- Migration 014: Agent State Storage
--------------------------------------------------------------------------------
-- Purpose: Create tables for storing agent conversation sessions and turns.
--          Replaces SQLite agent-state with Oracle-backed multi-tenant storage.
--
-- Tables:
--   - agent_sessions: Session metadata (model, region, status, config)
--   - agent_turns: Conversation turns (user/assistant messages, tool calls)
--
-- Multi-Tenancy: org_id and thread_id support for scoping sessions.
--
-- Indexes: Optimized for listSessions filtering (status, org_id, updated_at).
--
-- Author: sonnet-impl-4
-- Date: 2026-02-10
--------------------------------------------------------------------------------

-- agent_sessions: Agent conversation sessions with multi-tenant support
CREATE TABLE agent_sessions (
    id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    org_id VARCHAR2(36),
    thread_id VARCHAR2(36),
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    title VARCHAR2(500),
    model VARCHAR2(255) NOT NULL,
    region VARCHAR2(100) NOT NULL,
    status VARCHAR2(20) DEFAULT 'active' NOT NULL,
    config CLOB,

    -- Constraints
    CONSTRAINT chk_agent_sess_status CHECK (status IN ('active', 'completed', 'error')),
    CONSTRAINT chk_agent_sess_config CHECK (config IS JSON OR config IS NULL)
);

-- agent_turns: Conversation turns within sessions
CREATE TABLE agent_turns (
    id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    session_id VARCHAR2(36) NOT NULL,
    turn_number NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    user_message CLOB NOT NULL,
    assistant_response CLOB,
    tool_calls CLOB,
    tokens_used NUMBER,
    cost_usd NUMBER(10,6),
    error CLOB,

    -- Foreign key
    CONSTRAINT fk_agent_turn_session FOREIGN KEY (session_id)
        REFERENCES agent_sessions(id) ON DELETE CASCADE,

    -- Unique constraint
    CONSTRAINT uq_agent_turn UNIQUE (session_id, turn_number),

    -- JSON constraints
    CONSTRAINT chk_agent_turn_user_msg CHECK (user_message IS JSON),
    CONSTRAINT chk_agent_turn_asst_resp CHECK (assistant_response IS JSON OR assistant_response IS NULL),
    CONSTRAINT chk_agent_turn_tool_calls CHECK (tool_calls IS JSON OR tool_calls IS NULL)
);

-- Indexes for efficient queries
CREATE INDEX idx_agent_sess_status ON agent_sessions(status);
CREATE INDEX idx_agent_sess_org_id ON agent_sessions(org_id);
CREATE INDEX idx_agent_sess_updated ON agent_sessions(updated_at DESC);
CREATE INDEX idx_agent_turn_session ON agent_turns(session_id, turn_number);

-- Comments
COMMENT ON TABLE agent_sessions IS 'Agent conversation sessions with model, region, and multi-tenant support';
COMMENT ON TABLE agent_turns IS 'Conversation turns within agent sessions (user/assistant messages, tool calls)';
COMMENT ON COLUMN agent_sessions.org_id IS 'Organization ID for multi-tenant scoping (nullable for system sessions)';
COMMENT ON COLUMN agent_sessions.thread_id IS 'Thread ID for grouping related sessions (nullable)';
COMMENT ON COLUMN agent_sessions.config IS 'Session configuration JSON (temperature, maxTokens, agentRole, systemPrompt)';
COMMENT ON COLUMN agent_turns.tool_calls IS 'JSON array of tool calls executed during this turn';
COMMENT ON COLUMN agent_turns.cost_usd IS 'Estimated cost in USD for this turn (based on token usage)';
