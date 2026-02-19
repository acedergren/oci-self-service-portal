-- 019-ai-providers-schema.sql
-- Rebuild ai_providers with the schema expected by ai-provider-repository.ts.
--
-- Migration 010 created ai_providers with OCI-specific columns
-- (oci_region, oci_compartment, oci_auth_method, enabled_models, is_primary, endpoint_url)
-- but the repository was rewritten for a provider-agnostic schema with:
--   id, provider_id, display_name, provider_type, api_key_enc/iv/tag,
--   api_base_url, region, status, is_default, sort_order,
--   model_allowlist, default_model, extra_config, created_at, updated_at

-- ============================================================================
-- 1. DROP OLD TABLE (idempotent — ignore ORA-00942 if already gone)
-- ============================================================================
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE ai_providers CASCADE CONSTRAINTS';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -942 THEN
            RAISE;
        END IF;
END;
/

-- ============================================================================
-- 2. CREATE NEW TABLE with correct schema
-- ============================================================================
CREATE TABLE ai_providers (
    id              VARCHAR2(36) DEFAULT SYS_GUID() NOT NULL,
    provider_id     VARCHAR2(100) NOT NULL,
    display_name    VARCHAR2(255) NOT NULL,
    provider_type   VARCHAR2(50) NOT NULL CHECK (provider_type IN (
        'oci',
        'openai',
        'anthropic',
        'google',
        'azure-openai',
        'aws-bedrock',
        'groq',
        'together',
        'fireworks',
        'mistral',
        'custom'
    )),

    -- Encrypted API key (AES-256-GCM) — nullable for OCI (uses instance principal)
    api_key_enc     BLOB,
    api_key_iv      RAW(12),
    api_key_tag     RAW(16),

    -- Generic provider settings
    api_base_url    VARCHAR2(2000),
    region          VARCHAR2(100),

    -- Status and priority
    status          VARCHAR2(20) DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'disabled')),
    is_default      NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_default IN (0, 1)),
    sort_order      NUMBER(10) DEFAULT 0 NOT NULL,

    -- Model configuration (JSON array of allowed model IDs)
    model_allowlist CLOB,
    default_model   VARCHAR2(255),

    -- Extra provider-specific settings (JSON)
    extra_config    CLOB,

    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT pk_ai_providers PRIMARY KEY (id),
    CONSTRAINT uq_ai_providers_provider_id UNIQUE (provider_id),
    CONSTRAINT chk_ai_model_allowlist CHECK (model_allowlist IS JSON OR model_allowlist IS NULL),
    CONSTRAINT chk_ai_extra_config CHECK (extra_config IS JSON OR extra_config IS NULL)
);

CREATE INDEX idx_ai_providers_status ON ai_providers(status, sort_order);
CREATE INDEX idx_ai_providers_default ON ai_providers(is_default, status);

COMMENT ON TABLE ai_providers IS 'AI provider configuration with encrypted API keys';
COMMENT ON COLUMN ai_providers.api_key_enc IS 'AES-256-GCM encrypted API key (null for OCI instance principal)';
COMMENT ON COLUMN ai_providers.api_key_iv IS '12-byte GCM initialization vector';
COMMENT ON COLUMN ai_providers.api_key_tag IS '16-byte GCM authentication tag';
COMMENT ON COLUMN ai_providers.model_allowlist IS 'JSON array of allowed model IDs (null = all models allowed)';
COMMENT ON COLUMN ai_providers.is_default IS 'Primary provider used when no provider is specified (1=default)';
