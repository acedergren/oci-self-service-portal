-- 018-settings-schema.sql
-- Rebuild portal_settings with the schema expected by settings-repository.ts.
--
-- Migration 010 created portal_settings with (setting_key, setting_value, setting_type, ...)
-- but the repository was rewritten for a richer schema with:
--   id, "KEY", value, value_type, description, category, is_public, sort_order, created_at, updated_at
--
-- NOTE: The column name KEY is a reserved word in Oracle 23ai, so it must be
-- quoted as "KEY" in all DDL and DML statements.

-- ============================================================================
-- 1. DROP OLD TABLE (idempotent — ignore ORA-00942 if already gone)
-- ============================================================================
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE portal_settings CASCADE CONSTRAINTS';
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
CREATE TABLE portal_settings (
    id          VARCHAR2(36) DEFAULT SYS_GUID() NOT NULL,
    "KEY"       VARCHAR2(255) NOT NULL,
    value       VARCHAR2(4000) NOT NULL,
    value_type  VARCHAR2(20) NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    description VARCHAR2(2000),
    category    VARCHAR2(100),
    is_public   NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_public IN (0, 1)),
    sort_order  NUMBER(10) DEFAULT 0 NOT NULL,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_portal_settings PRIMARY KEY (id),
    CONSTRAINT uq_portal_settings_key UNIQUE ("KEY")
);

CREATE INDEX idx_portal_settings_category ON portal_settings(category, sort_order, "KEY");
CREATE INDEX idx_portal_settings_public ON portal_settings(is_public, category, sort_order);

COMMENT ON TABLE portal_settings IS 'System-wide portal configuration key-value store';
COMMENT ON COLUMN portal_settings."KEY" IS 'Unique setting key (e.g. portal.setup_complete)';
COMMENT ON COLUMN portal_settings.value IS 'Serialized setting value (string/number/boolean/JSON)';
COMMENT ON COLUMN portal_settings.value_type IS 'Value type for deserialization: string, number, boolean, json';
COMMENT ON COLUMN portal_settings.is_public IS 'Whether setting is safe to expose to authenticated clients (1=public)';
COMMENT ON COLUMN portal_settings.sort_order IS 'Display order within category';
