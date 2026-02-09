-- 010-mastra-storage.sql
-- Mastra framework storage tables for Phase 9.4
-- Supports 3 storage domains: Memory, Workflows, Scores
-- Created: 2026-02-08

-- ============================================================================
-- Memory Domain: Threads, Messages, Resources
-- ============================================================================

-- Conversation threads for Mastra Memory
CREATE TABLE mastra_threads (
    id              VARCHAR2(255) PRIMARY KEY,
    resource_id     VARCHAR2(255) NOT NULL,
    title           VARCHAR2(1000),
    metadata        CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_mt_metadata CHECK (metadata IS JSON OR metadata IS NULL)
);

CREATE INDEX idx_mt_resource ON mastra_threads(resource_id);
CREATE INDEX idx_mt_created ON mastra_threads(created_at);
CREATE INDEX idx_mt_updated ON mastra_threads(updated_at);

-- Messages within threads
CREATE TABLE mastra_messages (
    id              VARCHAR2(255) PRIMARY KEY,
    thread_id       VARCHAR2(255) NOT NULL REFERENCES mastra_threads(id) ON DELETE CASCADE,
    role            VARCHAR2(50) NOT NULL,
    type            VARCHAR2(50),
    content         CLOB NOT NULL,
    resource_id     VARCHAR2(255),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_mm_content CHECK (content IS JSON)
);

CREATE INDEX idx_mm_thread ON mastra_messages(thread_id);
CREATE INDEX idx_mm_resource ON mastra_messages(resource_id);
CREATE INDEX idx_mm_created ON mastra_messages(created_at);

-- Resource working memory
CREATE TABLE mastra_resources (
    id              VARCHAR2(255) PRIMARY KEY,
    working_memory  CLOB,
    metadata        CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_mr_metadata CHECK (metadata IS JSON OR metadata IS NULL)
);

-- ============================================================================
-- Workflows Domain: Snapshots (Mastra's built-in workflow state)
-- ============================================================================

-- Mastra workflow run snapshots (separate from our custom workflow_runs table)
CREATE TABLE mastra_workflow_snapshots (
    workflow_name   VARCHAR2(255) NOT NULL,
    run_id          VARCHAR2(255) NOT NULL,
    resource_id     VARCHAR2(255),
    snapshot        CLOB NOT NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_mws PRIMARY KEY (workflow_name, run_id),
    CONSTRAINT chk_mws_snapshot CHECK (snapshot IS JSON)
);

CREATE INDEX idx_mws_run ON mastra_workflow_snapshots(run_id);
CREATE INDEX idx_mws_resource ON mastra_workflow_snapshots(resource_id);
CREATE INDEX idx_mws_created ON mastra_workflow_snapshots(created_at);

-- ============================================================================
-- Scores Domain: Evaluation scores for agents and workflows
-- ============================================================================

CREATE TABLE mastra_scores (
    id                      VARCHAR2(255) PRIMARY KEY,
    scorer_id               VARCHAR2(255) NOT NULL,
    entity_id               VARCHAR2(255) NOT NULL,
    entity_type             VARCHAR2(50) NOT NULL,
    source                  VARCHAR2(10) DEFAULT 'LIVE' NOT NULL CHECK (source IN ('LIVE', 'TEST')),
    run_id                  VARCHAR2(255),
    score                   NUMBER NOT NULL,
    reason                  CLOB,
    input                   CLOB,
    output                  CLOB,
    extract_step_result     CLOB,
    analyze_step_result     CLOB,
    preprocess_step_result  CLOB,
    analyze_prompt          CLOB,
    preprocess_prompt       CLOB,
    generate_reason_prompt  CLOB,
    scorer                  CLOB,
    entity                  CLOB,
    additional_context      CLOB,
    request_context         CLOB,
    metadata                CLOB,
    trace_id                VARCHAR2(255),
    span_id                 VARCHAR2(255),
    resource_id             VARCHAR2(255),
    thread_id               VARCHAR2(255),
    created_at              TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at              TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_ms_input CHECK (input IS JSON OR input IS NULL),
    CONSTRAINT chk_ms_output CHECK (output IS JSON OR output IS NULL),
    CONSTRAINT chk_ms_extract CHECK (extract_step_result IS JSON OR extract_step_result IS NULL),
    CONSTRAINT chk_ms_analyze CHECK (analyze_step_result IS JSON OR analyze_step_result IS NULL),
    CONSTRAINT chk_ms_preprocess CHECK (preprocess_step_result IS JSON OR preprocess_step_result IS NULL),
    CONSTRAINT chk_ms_scorer CHECK (scorer IS JSON OR scorer IS NULL),
    CONSTRAINT chk_ms_entity CHECK (entity IS JSON OR entity IS NULL),
    CONSTRAINT chk_ms_addl_ctx CHECK (additional_context IS JSON OR additional_context IS NULL),
    CONSTRAINT chk_ms_req_ctx CHECK (request_context IS JSON OR request_context IS NULL),
    CONSTRAINT chk_ms_metadata CHECK (metadata IS JSON OR metadata IS NULL)
);

CREATE INDEX idx_ms_scorer ON mastra_scores(scorer_id);
CREATE INDEX idx_ms_entity ON mastra_scores(entity_id, entity_type);
CREATE INDEX idx_ms_run ON mastra_scores(run_id);
CREATE INDEX idx_ms_trace ON mastra_scores(trace_id, span_id);
CREATE INDEX idx_ms_resource ON mastra_scores(resource_id);
CREATE INDEX idx_ms_created ON mastra_scores(created_at);
