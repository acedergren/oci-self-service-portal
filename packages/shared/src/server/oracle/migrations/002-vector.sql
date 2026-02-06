-- 002-vector.sql
-- Vector search table for Oracle ADB 26AI semantic conversation search
-- Requires: 001-core.sql (chat_sessions, chat_turns)
-- Created: 2026-02-06

-- Conversation embeddings for semantic search over chat history
CREATE TABLE conversation_embeddings (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    session_id      VARCHAR2(36) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    turn_id         VARCHAR2(36) REFERENCES chat_turns(id) ON DELETE CASCADE,
    content_type    VARCHAR2(20) NOT NULL CHECK (content_type IN ('user_message','assistant_response','tool_result','summary')),
    text_content    CLOB NOT NULL,
    embedding       VECTOR(1536, FLOAT32),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);

-- Indexes for conversation_embeddings
CREATE INDEX idx_embeddings_session ON conversation_embeddings(session_id);
CREATE INDEX idx_embeddings_type ON conversation_embeddings(content_type);

-- Vector similarity search index using cosine distance
CREATE VECTOR INDEX idx_embeddings_vector ON conversation_embeddings(embedding)
    ORGANIZATION NEIGHBOR PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 95;
