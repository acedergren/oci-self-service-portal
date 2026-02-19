-- 016-duality.sql
-- JSON Duality Views for document-oriented access to relational tables
-- Requires: 001-core.sql, 005-workflows.sql, 013-mcp-servers.sql
-- Created: 2026-02-10
--
-- JSON Duality Views expose relational data as JSON documents with automatic
-- ACID consistency guarantees. These views provide a document-oriented API
-- over relational storage, enabling both SQL and JSON access patterns simultaneously.
--
-- Benefits:
-- - Read-write JSON API over relational tables
-- - Automatic ACID consistency with underlying tables
-- - Change tracking at document level
-- - Simplified application code (single JSON document vs multiple JOINs)
-- - Works with existing relational queries and constraints

-- ============================================================================
-- Workflow Definitions Duality View
-- ============================================================================
-- Provides JSON document access to workflow definitions with embedded metadata.
-- Useful for frontend CRUD operations and workflow export/import.

CREATE OR REPLACE JSON DUALITY VIEW workflow_definitions_dv AS
  workflow_definitions @insert @update @delete
  {
    _id         : id,
    orgId       : org_id,
    userId      : user_id,
    name        : name,
    description : description,
    status      : status,
    version     : version,
    nodes       : nodes,
    edges       : edges,
    inputSchema : input_schema,
    tags        : tags,
    createdAt   : created_at,
    updatedAt   : updated_at
  };

COMMENT ON VIEW workflow_definitions_dv IS
  'JSON Duality View for workflow definitions. Supports insert/update/delete operations with automatic ACID consistency.';

-- ============================================================================
-- Workflow Runs Duality View
-- ============================================================================
-- Provides JSON document access to workflow execution state.
-- Useful for monitoring dashboards and run status polling.

CREATE OR REPLACE JSON DUALITY VIEW workflow_runs_dv AS
  workflow_runs @insert @update @delete
  {
    _id             : id,
    workflowId      : workflow_id,
    workflowVersion : workflow_version,
    orgId           : org_id,
    userId          : user_id,
    status          : status,
    input           : input,
    output          : output,
    error           : error,
    engineState     : engine_state,
    startedAt       : started_at,
    completedAt     : completed_at,
    suspendedAt     : suspended_at,
    resumedAt       : resumed_at,
    createdAt       : created_at,
    updatedAt       : updated_at
  };

COMMENT ON VIEW workflow_runs_dv IS
  'JSON Duality View for workflow run state. Enables real-time status monitoring via JSON queries.';

-- ============================================================================
-- MCP Servers Duality View
-- ============================================================================
-- Provides JSON document access to MCP server configurations.
-- Useful for server management UI and configuration import/export.

CREATE OR REPLACE JSON DUALITY VIEW mcp_servers_dv AS
  mcp_servers @insert @update @delete
  {
    _id               : id,
    orgId             : org_id,
    serverName        : server_name,
    displayName       : display_name,
    description       : description,
    serverType        : server_type,
    transportType     : transport_type,
    catalogItemId     : catalog_item_id,
    config            : config,
    dockerImage       : docker_image,
    dockerContainerId : docker_container_id,
    dockerStatus      : docker_status,
    status            : status,
    enabled           : enabled,
    lastConnectedAt   : last_connected_at,
    lastError         : last_error,
    healthStatus      : health_status,
    tags              : tags,
    sortOrder         : sort_order,
    createdAt         : created_at,
    updatedAt         : updated_at
  };

COMMENT ON VIEW mcp_servers_dv IS
  'JSON Duality View for MCP server management. Supports full CRUD via JSON documents with automatic validation.';

-- ============================================================================
-- Usage Examples
-- ============================================================================
--
-- 1. Query workflow definitions as JSON:
--
--    SELECT json_serialize(data PRETTY)
--    FROM workflow_definitions_dv v
--    WHERE v.data."orgId".string() = '12345';
--
-- 2. Insert workflow via JSON:
--
--    INSERT INTO workflow_definitions_dv VALUES ('{
--      "_id": "wf-001",
--      "orgId": "org-123",
--      "name": "My Workflow",
--      "nodes": [],
--      "edges": []
--    }');
--
-- 3. Update workflow status via JSON:
--
--    UPDATE workflow_definitions_dv v
--    SET data = json_transform(data, SET '$.status' = 'published')
--    WHERE v.data."_id".string() = 'wf-001';
--
-- 4. Monitor running workflows:
--
--    SELECT json_serialize(data PRETTY)
--    FROM workflow_runs_dv v
--    WHERE v.data."status".string() = 'running'
--    AND v.data."orgId".string() = '12345';
--
-- 5. List active MCP servers:
--
--    SELECT json_serialize(data PRETTY)
--    FROM mcp_servers_dv v
--    WHERE v.data."status".string() = 'connected'
--    AND v.data."enabled".number() = 1;
--
