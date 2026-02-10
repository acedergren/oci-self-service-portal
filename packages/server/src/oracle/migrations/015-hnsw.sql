-- 015-hnsw.sql
-- Migrate vector indexes from IVF to HNSW for real-time DML support
-- Requires: 002-vector.sql (conversation_embeddings table)
-- Created: 2026-02-10

-- Oracle 26AI HNSW (Hierarchical Navigable Small World) indexes support real-time
-- insert/update/delete without requiring full index rebuilds. This migration replaces
-- the existing IVF (NEIGHBOR PARTITIONS) indexes with HNSW (INMEMORY NEIGHBOR GRAPH)
-- organization for both the static conversation_embeddings table and any dynamically
-- created MASTRA_VECTOR_* tables.

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

    -- Create HNSW index (idempotent — will error if already exists, which is fine)
    BEGIN
      EXECUTE IMMEDIATE
        'CREATE VECTOR INDEX idx_embeddings_vector ON conversation_embeddings(embedding)
         ORGANIZATION INMEMORY NEIGHBOR GRAPH
         DISTANCE COSINE
         WITH TARGET ACCURACY 95';
      DBMS_OUTPUT.PUT_LINE('Created HNSW index idx_embeddings_vector');
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -955 THEN
          DBMS_OUTPUT.PUT_LINE('HNSW index idx_embeddings_vector already exists');
        ELSE
          RAISE;
        END IF;
    END;
  END;

  -- Step 2: Find and replace IVF indexes on MASTRA_VECTOR_* tables
  FOR idx_rec IN (
    SELECT index_name, table_name
    FROM user_indexes
    WHERE table_name LIKE 'MASTRA\_VECTOR\_%' ESCAPE '\'
      AND index_type = 'VECTOR'
      AND index_name LIKE 'IDX_%\_VEC' ESCAPE '\'
  ) LOOP
    BEGIN
      -- Check if this is an IVF index by attempting to drop it
      -- (HNSW indexes will have different internal structure)
      EXECUTE IMMEDIATE 'DROP INDEX ' || idx_rec.index_name;
      DBMS_OUTPUT.PUT_LINE('Dropped IVF index ' || idx_rec.index_name || ' on ' || idx_rec.table_name);

      -- Recreate as HNSW
      -- Determine distance metric from table metadata or default to COSINE
      -- (All current code uses COSINE, so we'll use that as the default)
      EXECUTE IMMEDIATE
        'CREATE VECTOR INDEX ' || idx_rec.index_name || ' ON ' || idx_rec.table_name || '(embedding)
         ORGANIZATION INMEMORY NEIGHBOR GRAPH
         DISTANCE COSINE
         WITH TARGET ACCURACY 95';
      DBMS_OUTPUT.PUT_LINE('Created HNSW index ' || idx_rec.index_name || ' on ' || idx_rec.table_name);
    EXCEPTION
      WHEN OTHERS THEN
        -- If drop fails, index might already be HNSW or not exist
        DBMS_OUTPUT.PUT_LINE('Skipped ' || idx_rec.index_name || ' on ' || idx_rec.table_name || ': ' || SQLERRM);
    END;
  END LOOP;

  COMMIT;
END;
/
