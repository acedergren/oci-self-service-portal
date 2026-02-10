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

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- VPD policies are now active on all multi-tenant tables
-- Application code must call portal_ctx_pkg.set_org_id() at request start
-- and portal_ctx_pkg.clear_context() at request end
