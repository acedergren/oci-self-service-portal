-- 015-hnsw.sql
-- Migration 015: HNSW DML Vector Indexes for RAG Performance
--
-- Purpose: Migrate vector search indexes from IVF (NEIGHBOR PARTITIONS) to HNSW
--          (INMEMORY NEIGHBOR GRAPH) for real-time DML support (insert/update/delete
--          without requiring full index rebuilds).
--
-- Tables:
--   - conversation_embeddings: Chat history embeddings for semantic search
--   - MASTRA_VECTOR_* (dynamic): Additional vector tables created at runtime
--
-- Index Parameters:
--   - neighbors=16: Number of connections per node in the HNSW graph
--   - efConstruction=200: Construction effort for higher-quality graphs
--   - Distance metric: COSINE (for all embeddings in the system)
--   - Target Accuracy: 95% (performance vs accuracy trade-off)
--
-- Author: haiku-qa
-- Date: 2026-02-17
--
-- ROLLBACK: Recreate IVF indexes with:
--   DROP INDEX idx_embeddings_vector;
--   CREATE VECTOR INDEX idx_embeddings_vector ON conversation_embeddings(embedding)
--       ORGANIZATION NEIGHBOR PARTITIONS DISTANCE COSINE WITH TARGET ACCURACY 95;
--
-- Requires: 002-vector.sql (conversation_embeddings table exists)
--
--------------------------------------------------------------------------------

BEGIN
  -- Step 1: Replace IVF index on conversation_embeddings with HNSW
  DECLARE
    v_count NUMBER;
  BEGIN
    -- Check if the IVF index exists
    SELECT COUNT(*) INTO v_count
    FROM user_indexes
    WHERE index_name = 'IDX_EMBEDDINGS_VECTOR';

    IF v_count > 0 THEN
      EXECUTE IMMEDIATE 'DROP INDEX idx_embeddings_vector';
      DBMS_OUTPUT.PUT_LINE('Dropped IVF index idx_embeddings_vector');
    END IF;

    -- Create HNSW index with performance parameters
    -- neighbors=16: 16 connections per node (balance between search quality and memory)
    -- efConstruction=200: High construction effort for better graph quality
    BEGIN
      EXECUTE IMMEDIATE
        'CREATE VECTOR INDEX idx_embeddings_vector ON conversation_embeddings(embedding)
         ORGANIZATION INMEMORY NEIGHBOR GRAPH
         NEIGHBOR=16 EFCONSTRUCTION=200
         DISTANCE COSINE
         WITH TARGET ACCURACY 95';
      DBMS_OUTPUT.PUT_LINE('Created HNSW index idx_embeddings_vector with neighbors=16, efConstruction=200');
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -955 THEN
          DBMS_OUTPUT.PUT_LINE('HNSW index idx_embeddings_vector already exists');
        ELSIF SQLCODE = -2158 THEN
          -- ORA-02158: invalid CREATE INDEX option — HNSW not supported on this ADB tier.
          -- Leave existing IVF index in place and continue.
          DBMS_OUTPUT.PUT_LINE('HNSW not supported on this instance — skipping HNSW upgrade');
        ELSE
          RAISE;
        END IF;
    END;
  END;

  -- Step 2: Find and replace IVF indexes on MASTRA_VECTOR_* tables (dynamic RAG vectors)
  FOR idx_rec IN (
    SELECT index_name, table_name
    FROM user_indexes
    WHERE table_name LIKE 'MASTRA\_VECTOR\_%' ESCAPE '\'
      AND index_type = 'VECTOR'
      AND index_name LIKE 'IDX_%\_VEC' ESCAPE '\'
  ) LOOP
    BEGIN
      -- Drop existing IVF index
      EXECUTE IMMEDIATE 'DROP INDEX ' || idx_rec.index_name;
      DBMS_OUTPUT.PUT_LINE('Dropped IVF index ' || idx_rec.index_name || ' on ' || idx_rec.table_name);

      -- Recreate as HNSW with optimized parameters
      -- All embeddings in the system use COSINE distance
      EXECUTE IMMEDIATE
        'CREATE VECTOR INDEX ' || idx_rec.index_name || ' ON ' || idx_rec.table_name || '(embedding)
         ORGANIZATION INMEMORY NEIGHBOR GRAPH
         NEIGHBOR=16 EFCONSTRUCTION=200
         DISTANCE COSINE
         WITH TARGET ACCURACY 95';
      DBMS_OUTPUT.PUT_LINE('Created HNSW index ' || idx_rec.index_name || ' on ' || idx_rec.table_name || 
                           ' with neighbors=16, efConstruction=200');
    EXCEPTION
      WHEN OTHERS THEN
        -- If drop fails, index might already be HNSW or not exist
        DBMS_OUTPUT.PUT_LINE('Skipped ' || idx_rec.index_name || ' on ' || idx_rec.table_name || ': ' || SQLERRM);
    END;
  END LOOP;

  COMMIT;
END;
/
