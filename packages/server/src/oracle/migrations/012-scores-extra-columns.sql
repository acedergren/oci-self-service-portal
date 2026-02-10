-- 011-scores-extra-columns.sql
-- Add missing columns to mastra_scores for full ScoreRowData support
-- Required by: ScoresOracle (Phase 9.7)
-- Created: 2026-02-09

ALTER TABLE mastra_scores ADD (
    structured_output     NUMBER(1) DEFAULT 0,
    extract_prompt        CLOB,
    reason_prompt         CLOB,
    generate_score_prompt CLOB
);
