-- 008-graph.sql
-- Oracle Property Graph for Phase 8 relationship analytics
-- Requires: 001-core.sql, 005-workflows.sql
-- Created: 2026-02-06
--
-- Uses Oracle 26AI SQL/PGQ (Property Graph Queries) for graph analytics.
-- This creates a property graph over existing relational tables,
-- allowing GRAPH_TABLE queries for impact analysis and lineage tracking.

CREATE PROPERTY GRAPH portal_graph
    VERTEX TABLES (
        users
            KEY (id)
            LABEL person
            PROPERTIES (id, email, display_name, status, created_at),
        organizations
            KEY (id)
            LABEL organization
            PROPERTIES (id, name, oci_compartment_id, status, created_at),
        chat_sessions
            KEY (id)
            LABEL chat_session
            PROPERTIES (id, title, model, region, status, created_at),
        tool_executions
            KEY (id)
            LABEL tool_execution
            PROPERTIES (id, tool_name, tool_category, approval_level, action, success, duration_ms, created_at),
        workflow_definitions
            KEY (id)
            LABEL workflow
            PROPERTIES (id, name, status, version, created_at)
    )
    EDGE TABLES (
        org_members
            KEY (user_id, org_id)
            SOURCE KEY (user_id) REFERENCES users (id)
            DESTINATION KEY (org_id) REFERENCES organizations (id)
            LABEL member_of
            PROPERTIES (role, created_at),
        chat_sessions AS user_sessions
            KEY (id)
            SOURCE KEY (user_id) REFERENCES users (id)
            DESTINATION KEY (org_id) REFERENCES organizations (id)
            NO PROPERTIES,
        tool_executions AS session_tools
            KEY (id)
            SOURCE KEY (session_id) REFERENCES chat_sessions (id)
            DESTINATION KEY (id) REFERENCES tool_executions (id)
            LABEL used_tool
            PROPERTIES (tool_name, approval_level, action, created_at),
        workflow_definitions AS user_workflows
            KEY (id)
            SOURCE KEY (user_id) REFERENCES users (id)
            DESTINATION KEY (id) REFERENCES workflow_definitions (id)
            LABEL created_workflow
            PROPERTIES (name, status, created_at)
    );
