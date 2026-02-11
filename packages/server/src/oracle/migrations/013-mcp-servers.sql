-- 013-mcp-servers.sql
-- MCP (Model Context Protocol) server management infrastructure
-- Requires: 001-core.sql (organizations table)
-- Created: 2026-02-10
--
-- This migration adds MCP server management features:
-- - mcp_catalog: Pre-built MCP server definitions
-- - mcp_servers: Admin-installed server instances (org-scoped)
-- - mcp_server_credentials: Encrypted credentials for servers
-- - mcp_tool_cache: Discovered tools from connected servers
-- - mcp_resource_cache: Discovered resources from connected servers
-- - mcp_server_metrics: Tool call tracking and performance metrics
-- - mcp_server_logs: Captured server logs for debugging
--
-- Security: Credentials use AES-256-GCM encryption with separate IV and tag columns

-- MCP Catalog
-- Pre-built server definitions available for installation
CREATE TABLE mcp_catalog (
    id                    VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    catalog_id            VARCHAR2(100) NOT NULL UNIQUE,
    display_name          VARCHAR2(255) NOT NULL,
    description           CLOB NOT NULL,
    category              VARCHAR2(50) NOT NULL,
    icon_url              VARCHAR2(1000),
    documentation_url     VARCHAR2(1000),
    docker_image          VARCHAR2(500),
    docker_tag            VARCHAR2(50) DEFAULT 'latest',
    default_config        CLOB NOT NULL,
    required_credentials  CLOB,
    supports_tools        NUMBER(1) DEFAULT 1 CHECK (supports_tools IN (0,1)),
    supports_resources    NUMBER(1) DEFAULT 0 CHECK (supports_resources IN (0,1)),
    is_featured           NUMBER(1) DEFAULT 0 CHECK (is_featured IN (0,1)),
    sort_order            NUMBER DEFAULT 0,
    tags                  CLOB,
    status                VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at            TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation
    CONSTRAINT chk_mcp_catalog_config CHECK (default_config IS JSON),
    CONSTRAINT chk_mcp_catalog_creds CHECK (required_credentials IS JSON OR required_credentials IS NULL),
    CONSTRAINT chk_mcp_catalog_tags CHECK (tags IS JSON OR tags IS NULL)
);

COMMENT ON TABLE mcp_catalog IS 'Pre-built MCP server definitions available for installation';
COMMENT ON COLUMN mcp_catalog.catalog_id IS 'Unique identifier for catalog lookups (e.g., "slack", "github")';
COMMENT ON COLUMN mcp_catalog.required_credentials IS 'JSON array describing required credentials with key, displayName, type';

-- MCP Servers
-- Admin-installed server instances (org-scoped)
CREATE TABLE mcp_servers (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    org_id               VARCHAR2(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    server_name          VARCHAR2(100) NOT NULL,
    display_name         VARCHAR2(255) NOT NULL,
    description          CLOB,
    server_type          VARCHAR2(50) NOT NULL CHECK (server_type IN ('catalog','custom')),
    transport_type       VARCHAR2(20) NOT NULL CHECK (transport_type IN ('stdio','sse','http')),
    catalog_item_id      VARCHAR2(36) REFERENCES mcp_catalog(id) ON DELETE SET NULL,
    config               CLOB NOT NULL,
    docker_image         VARCHAR2(500),
    docker_container_id  VARCHAR2(64),
    docker_status        VARCHAR2(20),
    status               VARCHAR2(20) DEFAULT 'disconnected' NOT NULL CHECK (status IN ('connected','disconnected','error','connecting')),
    enabled              NUMBER(1) DEFAULT 1 CHECK (enabled IN (0,1)),
    last_connected_at    TIMESTAMP,
    last_error           CLOB,
    health_status        VARCHAR2(20),
    tags                 CLOB,
    sort_order           NUMBER DEFAULT 0,
    created_at           TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at           TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation
    CONSTRAINT chk_mcp_server_config CHECK (config IS JSON),
    CONSTRAINT chk_mcp_server_tags CHECK (tags IS JSON OR tags IS NULL),

    -- Unique constraint: one server name per org
    CONSTRAINT uq_mcp_server_name UNIQUE (org_id, server_name)
);

CREATE INDEX idx_mcp_servers_org ON mcp_servers(org_id);
CREATE INDEX idx_mcp_servers_status ON mcp_servers(status);

COMMENT ON TABLE mcp_servers IS 'Installed MCP server instances scoped to organizations';
COMMENT ON COLUMN mcp_servers.server_type IS 'catalog: from mcp_catalog, custom: user-defined';
COMMENT ON COLUMN mcp_servers.transport_type IS 'Communication protocol: stdio, sse, or http';

-- MCP Server Credentials
-- Encrypted secrets for server authentication
CREATE TABLE mcp_server_credentials (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    server_id            VARCHAR2(36) NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    credential_key       VARCHAR2(255) NOT NULL,
    display_name         VARCHAR2(255),
    value_enc            BLOB NOT NULL,
    value_iv             RAW(16) NOT NULL,
    value_tag            RAW(16) NOT NULL,
    credential_type      VARCHAR2(50) NOT NULL,
    created_at           TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at           TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- Unique constraint: one credential per key per server
    CONSTRAINT uq_mcp_credential UNIQUE (server_id, credential_key)
);

COMMENT ON TABLE mcp_server_credentials IS 'Encrypted credentials for MCP server authentication';
COMMENT ON COLUMN mcp_server_credentials.value_enc IS 'AES-256-GCM encrypted credential value';
COMMENT ON COLUMN mcp_server_credentials.value_iv IS '16-byte initialization vector for GCM';
COMMENT ON COLUMN mcp_server_credentials.value_tag IS '16-byte authentication tag for GCM';
COMMENT ON COLUMN mcp_server_credentials.credential_type IS 'Type hint: token, api_key, password, url, text';

-- MCP Tool Cache
-- Discovered tools from connected servers
CREATE TABLE mcp_tool_cache (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    server_id            VARCHAR2(36) NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    tool_name            VARCHAR2(255) NOT NULL,
    tool_description     CLOB,
    input_schema         CLOB NOT NULL,
    discovered_at        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation
    CONSTRAINT chk_mcp_tool_schema CHECK (input_schema IS JSON),

    -- Unique constraint: one tool per name per server
    CONSTRAINT uq_mcp_tool UNIQUE (server_id, tool_name)
);

CREATE INDEX idx_mcp_tool_cache_server ON mcp_tool_cache(server_id);

COMMENT ON TABLE mcp_tool_cache IS 'Cached tool definitions discovered from MCP servers';
COMMENT ON COLUMN mcp_tool_cache.input_schema IS 'JSON Schema for tool input parameters';

-- MCP Resource Cache
-- Discovered resources from connected servers
CREATE TABLE mcp_resource_cache (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    server_id            VARCHAR2(36) NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    resource_uri         VARCHAR2(1000) NOT NULL,
    resource_name        VARCHAR2(500) NOT NULL,
    description          CLOB,
    mime_type            VARCHAR2(100),
    discovered_at        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- Unique constraint: one resource per URI per server
    CONSTRAINT uq_mcp_resource UNIQUE (server_id, resource_uri)
);

CREATE INDEX idx_mcp_resource_cache_server ON mcp_resource_cache(server_id);

COMMENT ON TABLE mcp_resource_cache IS 'Cached resource definitions discovered from MCP servers';
COMMENT ON COLUMN mcp_resource_cache.resource_uri IS 'Unique resource identifier (e.g., file://path or custom://id)';

-- MCP Server Metrics
-- Tool call tracking and performance metrics
CREATE TABLE mcp_server_metrics (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    server_id            VARCHAR2(36) NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    org_id               VARCHAR2(36),
    tool_name            VARCHAR2(255),
    duration_ms          NUMBER,
    success              NUMBER(1) CHECK (success IN (0,1)),
    error_message        CLOB,
    recorded_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX idx_mcp_metrics_server ON mcp_server_metrics(server_id, recorded_at);

COMMENT ON TABLE mcp_server_metrics IS 'Performance and success metrics for MCP tool calls';
COMMENT ON COLUMN mcp_server_metrics.duration_ms IS 'Tool execution time in milliseconds';

-- MCP Server Logs
-- Captured logs for debugging
CREATE TABLE mcp_server_logs (
    id                   VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    server_id            VARCHAR2(36) NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    log_level            VARCHAR2(20) NOT NULL,
    log_message          CLOB NOT NULL,
    logged_at            TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX idx_mcp_logs_server ON mcp_server_logs(server_id, logged_at);

COMMENT ON TABLE mcp_server_logs IS 'Captured log messages from MCP servers for debugging';
COMMENT ON COLUMN mcp_server_logs.log_level IS 'Log severity: debug, info, warn, error';

-- Seed Data: Pre-built catalog entries
INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'slack',
    'Slack MCP Server',
    'Connect to Slack workspaces to read channels, send messages, manage users, and integrate workspace data into AI workflows. Provides tools for channel management, message sending, user lookups, and workspace search.',
    'communication',
    'mcp/slack-server',
    '{"transport":"stdio"}',
    '[{"key":"SLACK_BOT_TOKEN","displayName":"Bot Token","description":"Slack Bot OAuth token (xoxb-...)","type":"token"}]',
    1,
    1,
    '["messaging","collaboration","notifications"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'github',
    'GitHub MCP Server',
    'Integrate with GitHub repositories for code search, issue management, pull request operations, and repository insights. Provides tools for repo browsing, file operations, issue tracking, and PR workflows.',
    'developer-tools',
    'mcp/github-server',
    '{"transport":"stdio"}',
    '[{"key":"GITHUB_TOKEN","displayName":"Personal Access Token","description":"GitHub PAT with repo scope","type":"token"}]',
    1,
    2,
    '["version-control","code-review","ci-cd"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'pagerduty',
    'PagerDuty MCP Server',
    'Manage incidents, on-call schedules, and escalation policies in PagerDuty. Provides tools for incident creation, acknowledgement, resolution, and on-call rotation management.',
    'operations',
    'mcp/pagerduty-server',
    '{"transport":"stdio"}',
    '[{"key":"PAGERDUTY_API_KEY","displayName":"API Key","description":"PagerDuty REST API key","type":"api_key"}]',
    0,
    3,
    '["incident-management","alerting","on-call"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'jira',
    'Jira MCP Server',
    'Connect to Atlassian Jira for issue tracking, project management, and sprint planning. Provides tools for issue CRUD operations, JQL queries, sprint management, and project insights.',
    'project-management',
    'mcp/jira-server',
    '{"transport":"stdio"}',
    '[{"key":"JIRA_URL","displayName":"Jira URL","description":"Your Jira instance URL","type":"url"},{"key":"JIRA_EMAIL","displayName":"Email","description":"Jira account email","type":"text"},{"key":"JIRA_API_TOKEN","displayName":"API Token","description":"Jira API token","type":"token"}]',
    1,
    4,
    '["issue-tracking","agile","project-management"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'filesystem',
    'Filesystem MCP Server',
    'Provide secure file system access to AI agents with path restrictions. Supports file reading, writing, directory listing, and search within allowed paths. Useful for document processing and file-based workflows.',
    'utilities',
    'mcp/filesystem-server',
    '{"transport":"stdio","allowedPaths":["/data"]}',
    '[]',
    0,
    5,
    '["files","storage","documents"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'brave-search',
    'Brave Search MCP Server',
    'Perform web searches using the Brave Search API with privacy-focused results. Provides tools for web search, news search, and image search with filtering options.',
    'search',
    'mcp/brave-search-server',
    '{"transport":"stdio"}',
    '[{"key":"BRAVE_API_KEY","displayName":"API Key","description":"Brave Search API key","type":"api_key"}]',
    0,
    6,
    '["web-search","research","information-retrieval"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'aws-bedrock',
    'AWS Bedrock MCP Server',
    'Connect to Amazon Bedrock for foundation model inference, including Claude, Llama, Titan, and other models. Provides tools for text generation, embeddings, and model invocation with AWS IAM authentication. Supports streaming responses and multi-modal inputs.',
    'ai-providers',
    'mcp/aws-bedrock-server',
    '{"transport":"stdio","region":"us-east-1"}',
    '[{"key":"AWS_ACCESS_KEY_ID","displayName":"Access Key ID","description":"AWS IAM access key ID","type":"text"},{"key":"AWS_SECRET_ACCESS_KEY","displayName":"Secret Access Key","description":"AWS IAM secret access key","type":"token"},{"key":"AWS_REGION","displayName":"AWS Region","description":"AWS region for Bedrock (e.g., us-east-1)","type":"text"}]',
    1,
    7,
    '["ai","llm","foundation-models","aws"]'
);

INSERT INTO mcp_catalog (catalog_id, display_name, description, category, docker_image, default_config, required_credentials, is_featured, sort_order, tags) VALUES (
    'azure-openai',
    'Azure OpenAI MCP Server',
    'Integrate with Azure OpenAI Service for GPT-4, GPT-3.5, DALL-E, and Whisper models. Provides tools for chat completions, embeddings, image generation, and audio transcription. Supports Azure AD authentication and private endpoints for enterprise deployments.',
    'ai-providers',
    'mcp/azure-openai-server',
    '{"transport":"stdio"}',
    '[{"key":"AZURE_OPENAI_ENDPOINT","displayName":"Endpoint URL","description":"Azure OpenAI resource endpoint (e.g., https://your-resource.openai.azure.com)","type":"url"},{"key":"AZURE_OPENAI_API_KEY","displayName":"API Key","description":"Azure OpenAI API key from resource portal","type":"token"},{"key":"AZURE_OPENAI_DEPLOYMENT","displayName":"Deployment Name","description":"Model deployment name configured in Azure","type":"text"}]',
    1,
    8,
    '["ai","llm","openai","azure","gpt"]'
);
