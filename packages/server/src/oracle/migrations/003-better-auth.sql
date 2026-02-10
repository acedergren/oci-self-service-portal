-- 003-better-auth.sql
-- Add tables and columns required by Better Auth (v1.x)
-- Created: 2026-02-06

-- Add columns Better Auth expects on users table
ALTER TABLE users ADD (
    name VARCHAR2(255),
    email_verified NUMBER(1) DEFAULT 0,
    image VARCHAR2(1024)
);

-- Add columns Better Auth expects on auth_sessions table
ALTER TABLE auth_sessions ADD (
    token VARCHAR2(255),
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX idx_auth_sessions_token ON auth_sessions(token);

-- OAuth accounts table (required by Better Auth)
CREATE TABLE accounts (
    id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id VARCHAR2(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id VARCHAR2(255) NOT NULL,
    provider_id VARCHAR2(255) NOT NULL,
    access_token CLOB,
    refresh_token CLOB,
    access_token_expires_at TIMESTAMP,
    refresh_token_expires_at TIMESTAMP,
    scope VARCHAR2(1024),
    id_token CLOB,
    password VARCHAR2(255),
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

-- Verification tokens table (required by Better Auth)
CREATE TABLE verifications (
    id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    identifier VARCHAR2(255) NOT NULL,
    value VARCHAR2(1024) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX idx_verifications_identifier ON verifications(identifier);

-- Organization invitations (for org plugin)
CREATE TABLE org_invitations (
    id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    email VARCHAR2(255) NOT NULL,
    inviter_id VARCHAR2(36) REFERENCES users(id),
    organization_id VARCHAR2(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR2(20) DEFAULT 'viewer' NOT NULL,
    status VARCHAR2(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled','expired')),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX idx_org_invitations_org ON org_invitations(organization_id);
CREATE INDEX idx_org_invitations_email ON org_invitations(email);

-- Add active_organization_id to auth_sessions for org plugin
ALTER TABLE auth_sessions ADD (
    active_organization_id VARCHAR2(36) REFERENCES organizations(id)
);
