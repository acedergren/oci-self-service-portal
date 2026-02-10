-- 009-admin.sql
-- Admin Console and Setup Wizard infrastructure
-- Requires: 003-better-auth.sql
-- Created: 2026-02-08
--
-- This migration adds admin console features:
-- - Identity Provider (IDP) configuration with encrypted credentials
-- - AI Provider configuration with encrypted API keys
-- - Portal settings key-value store
--
-- Security: Client secrets and API keys use AES-256-GCM encryption
-- with separate IV and authentication tag columns.

-- IDP Provider Configuration
-- Stores OIDC/IDCS/SAML provider settings with encrypted credentials
CREATE TABLE idp_providers (
    id                  VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    provider_id         VARCHAR2(100) NOT NULL UNIQUE,
    display_name        VARCHAR2(255) NOT NULL,
    provider_type       VARCHAR2(20) NOT NULL CHECK (provider_type IN ('idcs','oidc','saml')),

    -- OIDC Endpoints (discovery_url is sufficient, individual URLs are optional overrides)
    discovery_url       VARCHAR2(1000),
    authorization_url   VARCHAR2(1000),
    token_url           VARCHAR2(1000),
    userinfo_url        VARCHAR2(1000),
    jwks_url            VARCHAR2(1000),

    -- OAuth Client Credentials (encrypted using AES-256-GCM)
    client_id           VARCHAR2(500) NOT NULL,
    client_secret_enc   BLOB,
    client_secret_iv    RAW(16),
    client_secret_tag   RAW(16),

    -- OAuth Configuration
    scopes              VARCHAR2(1000) DEFAULT 'openid profile email',
    pkce_enabled        NUMBER(1) DEFAULT 1 CHECK (pkce_enabled IN (0,1)),
    status              VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','disabled','testing')),
    is_default          NUMBER(1) DEFAULT 0 CHECK (is_default IN (0,1)),
    sort_order          NUMBER DEFAULT 0,

    -- UI Configuration
    icon_url            VARCHAR2(1000),
    button_label        VARCHAR2(100),

    -- IDCS-Specific Configuration
    admin_groups        VARCHAR2(1000),
    operator_groups     VARCHAR2(1000),
    tenant_org_map      CLOB,
    default_org_id      VARCHAR2(36) REFERENCES organizations(id),

    -- Additional Provider-Specific Settings
    extra_config        CLOB,

    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation
    CONSTRAINT chk_idp_tenant_map CHECK (tenant_org_map IS JSON OR tenant_org_map IS NULL),
    CONSTRAINT chk_idp_extra_config CHECK (extra_config IS JSON OR extra_config IS NULL),

    -- Endpoint Validation: Must have either discovery_url OR explicit auth+token URLs
    CONSTRAINT chk_idp_endpoints CHECK (
        discovery_url IS NOT NULL OR
        (authorization_url IS NOT NULL AND token_url IS NOT NULL)
    )
);

CREATE INDEX idx_idp_status ON idp_providers(status, sort_order);

COMMENT ON TABLE idp_providers IS 'Identity provider configuration with encrypted credentials';
COMMENT ON COLUMN idp_providers.client_secret_enc IS 'AES-256-GCM encrypted client secret';
COMMENT ON COLUMN idp_providers.client_secret_iv IS '12-byte initialization vector for GCM';
COMMENT ON COLUMN idp_providers.client_secret_tag IS '16-byte authentication tag for GCM';

-- AI Provider Configuration
-- Stores AI model provider settings with encrypted API keys
CREATE TABLE ai_providers (
    id                  VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    provider_id         VARCHAR2(100) NOT NULL UNIQUE,
    display_name        VARCHAR2(255) NOT NULL,
    provider_type       VARCHAR2(50) NOT NULL CHECK (provider_type IN (
        'oci-genai',
        'openai',
        'anthropic',
        'azure-openai',
        'google-vertex',
        'bedrock',
        'cohere',
        'mistral',
        'huggingface'
    )),

    -- Encrypted API Credentials (AES-256-GCM)
    api_key_enc         BLOB,
    api_key_iv          RAW(16),
    api_key_tag         RAW(16),

    -- OCI-Specific Configuration
    oci_region          VARCHAR2(50),
    oci_compartment     VARCHAR2(255),
    oci_auth_method     VARCHAR2(50) CHECK (oci_auth_method IN ('instance_principal','config_file','resource_principal') OR oci_auth_method IS NULL),

    -- Provider-Specific Settings
    endpoint_url        VARCHAR2(1000),
    organization_id     VARCHAR2(255),
    project_id          VARCHAR2(255),

    -- Model Configuration
    enabled_models      CLOB NOT NULL,
    default_model       VARCHAR2(255),

    -- Status and Priority
    status              VARCHAR2(20) DEFAULT 'active' CHECK (status IN ('active','disabled','testing')),
    is_primary          NUMBER(1) DEFAULT 0 CHECK (is_primary IN (0,1)),
    sort_order          NUMBER DEFAULT 0,

    -- Rate Limiting
    rate_limit_rpm      NUMBER,
    rate_limit_tpm      NUMBER,

    -- Additional Settings
    extra_config        CLOB,

    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation
    CONSTRAINT chk_ai_enabled_models CHECK (enabled_models IS JSON),
    CONSTRAINT chk_ai_extra_config CHECK (extra_config IS JSON OR extra_config IS NULL),

    -- Conditional Constraints: OCI must have region, non-OCI must have API key
    CONSTRAINT chk_ai_oci_config CHECK (
        CASE
            WHEN provider_type = 'oci-genai' THEN oci_region IS NOT NULL
            ELSE 1=1
        END = 1
    ),
    CONSTRAINT chk_ai_nonoci_key CHECK (
        CASE
            WHEN provider_type != 'oci-genai' THEN api_key_enc IS NOT NULL
            ELSE 1=1
        END = 1
    )
);

CREATE INDEX idx_ai_status ON ai_providers(status, sort_order);

COMMENT ON TABLE ai_providers IS 'AI provider configuration with encrypted API keys';
COMMENT ON COLUMN ai_providers.api_key_enc IS 'AES-256-GCM encrypted API key';
COMMENT ON COLUMN ai_providers.api_key_iv IS '12-byte initialization vector for GCM';
COMMENT ON COLUMN ai_providers.api_key_tag IS '16-byte authentication tag for GCM';

-- Portal Settings
-- Key-value store for system-wide configuration
CREATE TABLE portal_settings (
    setting_key         VARCHAR2(255) PRIMARY KEY,
    setting_value       CLOB NOT NULL,
    setting_type        VARCHAR2(20) NOT NULL CHECK (setting_type IN (
        'string',
        'number',
        'boolean',
        'json',
        'encrypted'
    )),
    category            VARCHAR2(50) NOT NULL,
    description         VARCHAR2(1000),
    updated_by          VARCHAR2(36) REFERENCES users(id),
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    -- JSON Validation for json type
    CONSTRAINT chk_settings_json CHECK (
        CASE
            WHEN setting_type = 'json' THEN setting_value IS JSON
            ELSE 1=1
        END = 1
    )
);

CREATE INDEX idx_settings_category ON portal_settings(category);

COMMENT ON TABLE portal_settings IS 'System-wide portal configuration key-value store';
COMMENT ON COLUMN portal_settings.setting_type IS 'Value type: string, number, boolean, json, encrypted';

-- Backward Compatibility
-- Migrate existing Better Auth provider_id from 'oci-iam' to 'oci-idcs'
UPDATE account SET provider_id = 'oci-idcs' WHERE provider_id = 'oci-iam';
