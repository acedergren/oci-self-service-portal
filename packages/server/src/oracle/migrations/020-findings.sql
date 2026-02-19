-- 020-findings.sql
-- CloudAdvisor finding persistence.
--
-- Stores structured findings produced by CloudAdvisor analysis workflows.
-- Findings are append-only observations; status transitions (acknowledged,
-- resolved, dismissed) are the only mutations allowed post-creation.
--
-- Key design decisions:
--  - resources stored as JSON CLOB (variable number of affected resources)
--  - metadata stored as JSON CLOB (open-ended structured analysis data)
--  - charlie_action stored as JSON CLOB (prompt + riskLevel together)
--  - duplicate prevention: unique index on (domain, title, primary resource id)
--    is handled at the application layer using upsert logic

-- ============================================================================
-- 1. FINDINGS table
-- ============================================================================
BEGIN
    EXECUTE IMMEDIATE '
        CREATE TABLE cloud_advisor_findings (
            id              VARCHAR2(36)    DEFAULT SYS_GUID() NOT NULL,
            run_id          VARCHAR2(255)   NOT NULL,
            domain          VARCHAR2(30)    NOT NULL CHECK (domain IN (
                                ''cost'', ''security'', ''right-sizing'', ''ai-performance''
                            )),
            severity        VARCHAR2(20)    NOT NULL CHECK (severity IN (
                                ''critical'', ''high'', ''medium'', ''low'', ''info''
                            )),
            confidence      VARCHAR2(10)    NOT NULL CHECK (confidence IN (
                                ''high'', ''medium'', ''low''
                            )),
            title           VARCHAR2(500)   NOT NULL,
            summary         CLOB            NOT NULL,
            impact          CLOB            NOT NULL,
            recommendation  CLOB            NOT NULL,
            charlie_action  CLOB,
            resources       CLOB            NOT NULL,
            metadata        CLOB,
            status          VARCHAR2(20)    DEFAULT ''active'' NOT NULL CHECK (status IN (
                                ''active'', ''acknowledged'', ''resolved'', ''dismissed''
                            )),
            created_at      TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
            expires_at      TIMESTAMP,
            updated_at      TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,

            CONSTRAINT pk_ca_findings PRIMARY KEY (id),
            CONSTRAINT chk_ca_resources   CHECK (resources IS JSON),
            CONSTRAINT chk_ca_metadata    CHECK (metadata IS JSON OR metadata IS NULL),
            CONSTRAINT chk_ca_charlie_act CHECK (charlie_action IS JSON OR charlie_action IS NULL)
        )
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN
            RAISE;
        END IF;
END;
/

-- ============================================================================
-- 2. FINDING_RUNS table — summary per analysis run
-- ============================================================================
BEGIN
    EXECUTE IMMEDIATE '
        CREATE TABLE cloud_advisor_runs (
            id                  VARCHAR2(36)    DEFAULT SYS_GUID() NOT NULL,
            run_id              VARCHAR2(255)   NOT NULL,
            domain              VARCHAR2(30)    CHECK (domain IN (
                                    ''cost'', ''security'', ''right-sizing'', ''ai-performance'', ''full''
                                )),
            status              VARCHAR2(20)    DEFAULT ''running'' NOT NULL CHECK (status IN (
                                    ''running'', ''completed'', ''failed''
                                )),
            started_at          TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
            completed_at        TIMESTAMP,
            duration_ms         NUMBER(10),
            finding_count       NUMBER(10)      DEFAULT 0 NOT NULL,
            critical_count      NUMBER(10)      DEFAULT 0 NOT NULL,
            high_count          NUMBER(10)      DEFAULT 0 NOT NULL,
            medium_count        NUMBER(10)      DEFAULT 0 NOT NULL,
            low_count           NUMBER(10)      DEFAULT 0 NOT NULL,
            info_count          NUMBER(10)      DEFAULT 0 NOT NULL,
            estimated_savings   NUMBER(14,2)    DEFAULT 0 NOT NULL,
            summary_json        CLOB,
            error_message       CLOB,

            CONSTRAINT pk_ca_runs           PRIMARY KEY (id),
            CONSTRAINT uq_ca_runs_run_id    UNIQUE (run_id),
            CONSTRAINT chk_ca_runs_summary  CHECK (summary_json IS JSON OR summary_json IS NULL)
        )
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN
            RAISE;
        END IF;
END;
/

-- ============================================================================
-- 3. Indexes
-- ============================================================================
BEGIN
    EXECUTE IMMEDIATE '
        CREATE INDEX idx_ca_findings_domain_sev
        ON cloud_advisor_findings(domain, severity, status)
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 AND SQLCODE != -1408 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE '
        CREATE INDEX idx_ca_findings_status
        ON cloud_advisor_findings(status, created_at)
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 AND SQLCODE != -1408 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE '
        CREATE INDEX idx_ca_findings_run_id
        ON cloud_advisor_findings(run_id)
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 AND SQLCODE != -1408 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE '
        CREATE INDEX idx_ca_runs_status
        ON cloud_advisor_runs(status, started_at)
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 AND SQLCODE != -1408 THEN RAISE; END IF;
END;
/

-- ============================================================================
-- 4. Comments
-- ============================================================================
COMMENT ON TABLE cloud_advisor_findings IS 'CloudAdvisor structured findings from analysis workflows';
COMMENT ON TABLE cloud_advisor_runs IS 'CloudAdvisor analysis run records with finding summaries';
COMMENT ON COLUMN cloud_advisor_findings.charlie_action IS 'JSON: {prompt, riskLevel} — how Charlie can remediate this finding';
COMMENT ON COLUMN cloud_advisor_findings.resources IS 'JSON array of affected cloud resources [{cloud, type, id, name}]';
COMMENT ON COLUMN cloud_advisor_findings.metadata IS 'JSON: raw tool results and analysis data supporting this finding';
