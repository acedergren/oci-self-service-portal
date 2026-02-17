-- 017-vpd.sql
-- Virtual Private Database policies for automatic tenant isolation
-- Requires: 001-core.sql, 005-workflows.sql, 006-api-keys.sql, 013-mcp-servers.sql, 014-agent-state.sql
-- Created: 2026-02-10

-- ============================================================================
-- 1. CREATE APPLICATION CONTEXT
-- ============================================================================
-- Application context to store session-level tenant information
-- Accessed via SYS_CONTEXT('PORTAL_CTX', 'ORG_ID')
BEGIN
  EXECUTE IMMEDIATE 'CREATE OR REPLACE CONTEXT portal_ctx USING portal_ctx_pkg';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN  -- ORA-00955: name is already used by an existing object
      RAISE;
    END IF;
END;
/

-- ============================================================================
-- 2. CONTEXT MANAGEMENT PACKAGE
-- ============================================================================
-- Package to set/clear application context values
-- Only this package can modify PORTAL_CTX (enforced by Oracle)
CREATE OR REPLACE PACKAGE portal_ctx_pkg IS
  -- Set the current organization ID for row-level filtering
  PROCEDURE set_org_id(p_org_id VARCHAR2);

  -- Enable admin bypass mode (no tenant filtering)
  PROCEDURE set_admin_bypass;

  -- Clear all context values (call at end of request)
  PROCEDURE clear_context;
END portal_ctx_pkg;
/

CREATE OR REPLACE PACKAGE BODY portal_ctx_pkg IS
  PROCEDURE set_org_id(p_org_id VARCHAR2) IS
  BEGIN
    DBMS_SESSION.SET_CONTEXT('PORTAL_CTX', 'ORG_ID', p_org_id);
  END set_org_id;

  PROCEDURE set_admin_bypass IS
  BEGIN
    DBMS_SESSION.SET_CONTEXT('PORTAL_CTX', 'ORG_ID', 'ADMIN_BYPASS');
  END set_admin_bypass;

  PROCEDURE clear_context IS
  BEGIN
    DBMS_SESSION.CLEAR_CONTEXT('PORTAL_CTX');
  END clear_context;
END portal_ctx_pkg;
/

-- ============================================================================
-- 3. VPD POLICY FUNCTION
-- ============================================================================
-- Policy function that generates WHERE clause predicates based on context
-- Returns: SQL predicate string to filter rows, NULL for no filter, or '1=0' to deny all
CREATE OR REPLACE FUNCTION portal_vpd_policy(
  p_schema VARCHAR2,
  p_table  VARCHAR2
) RETURN VARCHAR2 IS
  v_org_id VARCHAR2(36);
BEGIN
  -- Retrieve org_id from application context
  v_org_id := SYS_CONTEXT('PORTAL_CTX', 'ORG_ID');

  -- No context set = deny all access (return impossible condition)
  IF v_org_id IS NULL THEN
    RETURN '1=0';
  END IF;

  -- Admin bypass mode = no filtering (return NULL)
  IF v_org_id = 'ADMIN_BYPASS' THEN
    RETURN NULL;
  END IF;

  -- Normal tenant filter: restrict to rows matching the context org_id
  -- Note: String concatenation is safe here because v_org_id comes from
  -- trusted application context set via portal_ctx_pkg, not user input
  RETURN 'org_id = ''' || v_org_id || '''';
END portal_vpd_policy;
/

-- ============================================================================
-- 4. APPLY POLICIES TO MULTI-TENANT TABLES
-- ============================================================================
-- Apply VPD policies to all tables with org_id columns
-- Each policy enforces row-level security on SELECT, INSERT, UPDATE, DELETE

-- Policy for workflow_definitions
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'WORKFLOW_DEFINITIONS',
    policy_name     => 'PORTAL_VPD_WORKFLOW_DEFS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN  -- ORA-28101: policy already exists
      NULL;  -- Policy already exists, skip
    ELSIF SQLCODE = -942 THEN  -- ORA-00942: table or view does not exist
      NULL;  -- Table doesn't exist yet, skip gracefully
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for workflow_runs
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'WORKFLOW_RUNS',
    policy_name     => 'PORTAL_VPD_WORKFLOW_RUNS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for chat_sessions
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'CHAT_SESSIONS',
    policy_name     => 'PORTAL_VPD_CHAT_SESSIONS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for api_keys
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'API_KEYS',
    policy_name     => 'PORTAL_VPD_API_KEYS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for mcp_servers
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'MCP_SERVERS',
    policy_name     => 'PORTAL_VPD_MCP_SERVERS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for agent_sessions
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'AGENT_SESSIONS',
    policy_name     => 'PORTAL_VPD_AGENT_SESSIONS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for tool_executions
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'TOOL_EXECUTIONS',
    policy_name     => 'PORTAL_VPD_TOOL_EXECUTIONS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for webhook_subscriptions
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'WEBHOOK_SUBSCRIPTIONS',
    policy_name     => 'PORTAL_VPD_WEBHOOK_SUBS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for audit_blockchain
-- Note: audit_blockchain is an immutable ledger (blockchain table) — INSERT only.
-- SELECT filtering ensures tenants can only query their own audit records.
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'AUDIT_BLOCKCHAIN',
    policy_name     => 'PORTAL_VPD_AUDIT_BC',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT',
    update_check    => FALSE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- Policy for mcp_server_metrics
-- org_id is nullable on this table; policy still restricts non-admin sessions.
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'MCP_SERVER_METRICS',
    policy_name     => 'PORTAL_VPD_MCP_METRICS',
    function_schema => USER,
    policy_function => 'PORTAL_VPD_POLICY',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE,
    enable          => TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -28101 THEN
      NULL;
    ELSIF SQLCODE = -942 THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END;
/

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- VPD policies are now active on all multi-tenant tables:
--   workflow_definitions, workflow_runs, chat_sessions, api_keys,
--   mcp_servers, agent_sessions, tool_executions, webhook_subscriptions,
--   audit_blockchain, mcp_server_metrics
--
-- Application code must call portal_ctx_pkg.set_org_id() at request start
-- and portal_ctx_pkg.clear_context() at request end.
--
-- Admin operations must call portal_ctx_pkg.set_admin_bypass() before
-- cross-tenant queries and portal_ctx_pkg.clear_context() after.

-- ============================================================================
-- ROLLBACK SECTION (run manually to remove VPD policies)
-- ============================================================================
-- Execute the following block to fully remove all VPD infrastructure:
--
-- BEGIN
--   -- Drop policies (ignore ORA-28102: policy does not exist)
--   FOR p IN (
--     SELECT object_name, policy_name FROM all_policies
--     WHERE policy_name LIKE 'PORTAL_VPD_%'
--   ) LOOP
--     BEGIN
--       DBMS_RLS.DROP_POLICY(
--         object_schema => USER,
--         object_name   => p.object_name,
--         policy_name   => p.policy_name
--       );
--     EXCEPTION
--       WHEN OTHERS THEN
--         IF SQLCODE != -28102 THEN RAISE; END IF;
--     END;
--   END LOOP;
--   -- Drop context package
--   EXECUTE IMMEDIATE 'DROP PACKAGE portal_ctx_pkg';
--   -- Drop policy function
--   EXECUTE IMMEDIATE 'DROP FUNCTION portal_vpd_policy';
--   -- Drop application context (requires DBA privilege)
--   -- EXECUTE IMMEDIATE 'DROP CONTEXT portal_ctx';
-- END;
-- /
