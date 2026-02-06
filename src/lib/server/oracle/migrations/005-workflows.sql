-- 005-workflows.sql
-- Visual workflow designer tables for Phase 7
-- Created: 2026-02-06

-- Workflow definitions (designer canvas state)
CREATE TABLE workflow_definitions (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id         VARCHAR2(36) REFERENCES users(id),
    org_id          VARCHAR2(36) REFERENCES organizations(id),
    name            VARCHAR2(255) NOT NULL,
    description     VARCHAR2(2000),
    status          VARCHAR2(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    version         NUMBER DEFAULT 1 NOT NULL,
    tags            CLOB,
    nodes           CLOB NOT NULL,
    edges           CLOB NOT NULL,
    input_schema    CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_wf_tags CHECK (tags IS JSON OR tags IS NULL),
    CONSTRAINT chk_wf_nodes CHECK (nodes IS JSON),
    CONSTRAINT chk_wf_edges CHECK (edges IS JSON),
    CONSTRAINT chk_wf_input_schema CHECK (input_schema IS JSON OR input_schema IS NULL)
);

-- Workflow runs (execution instances)
CREATE TABLE workflow_runs (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    workflow_id     VARCHAR2(36) NOT NULL REFERENCES workflow_definitions(id),
    workflow_version NUMBER NOT NULL,
    user_id         VARCHAR2(36) REFERENCES users(id),
    org_id          VARCHAR2(36) REFERENCES organizations(id),
    status          VARCHAR2(20) DEFAULT 'pending' CHECK (status IN ('pending','running','suspended','completed','failed','cancelled')),
    input           CLOB,
    output          CLOB,
    error           CLOB,
    engine_state    CLOB,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    suspended_at    TIMESTAMP,
    resumed_at      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_run_input CHECK (input IS JSON OR input IS NULL),
    CONSTRAINT chk_run_output CHECK (output IS JSON OR output IS NULL),
    CONSTRAINT chk_run_error CHECK (error IS JSON OR error IS NULL),
    CONSTRAINT chk_run_engine_state CHECK (engine_state IS JSON OR engine_state IS NULL)
);

-- Workflow run steps (individual node executions within a run)
CREATE TABLE workflow_run_steps (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    run_id          VARCHAR2(36) NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id         VARCHAR2(100) NOT NULL,
    node_type       VARCHAR2(20) NOT NULL CHECK (node_type IN ('tool','condition','loop','approval','ai-step','input','output','parallel')),
    step_number     NUMBER NOT NULL,
    status          VARCHAR2(20) DEFAULT 'pending' CHECK (status IN ('pending','running','suspended','completed','failed','skipped')),
    input           CLOB,
    output          CLOB,
    error           CLOB,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    duration_ms     NUMBER,
    tool_execution_id VARCHAR2(36) REFERENCES tool_executions(id),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_step_input CHECK (input IS JSON OR input IS NULL),
    CONSTRAINT chk_step_output CHECK (output IS JSON OR output IS NULL)
);

-- Indexes for workflow_definitions
CREATE INDEX idx_wf_defs_user ON workflow_definitions(user_id);
CREATE INDEX idx_wf_defs_org ON workflow_definitions(org_id);
CREATE INDEX idx_wf_defs_status ON workflow_definitions(status);
CREATE INDEX idx_wf_defs_name ON workflow_definitions(name);

-- Indexes for workflow_runs
CREATE INDEX idx_wf_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_wf_runs_user ON workflow_runs(user_id);
CREATE INDEX idx_wf_runs_org ON workflow_runs(org_id);
CREATE INDEX idx_wf_runs_status ON workflow_runs(status);
CREATE INDEX idx_wf_runs_created ON workflow_runs(created_at);

-- Indexes for workflow_run_steps
CREATE INDEX idx_wf_steps_run ON workflow_run_steps(run_id);
CREATE INDEX idx_wf_steps_status ON workflow_run_steps(status);
CREATE INDEX idx_wf_steps_tool_exec ON workflow_run_steps(tool_execution_id);
