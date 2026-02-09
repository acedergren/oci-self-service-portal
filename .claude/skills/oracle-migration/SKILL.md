---
name: oracle-migration
description: Create a new Oracle ADB 26AI migration with proper numbering, header, and DDL patterns
---

# Oracle Migration Generator

Create a new Oracle ADB 26AI migration file for the self-service portal.

## Steps

1. **Determine next version number**: Read existing migrations in `apps/frontend/src/lib/server/oracle/migrations/` and find the highest `NNN-*.sql` number, then increment by 1.

2. **Create the migration file** at `apps/frontend/src/lib/server/oracle/migrations/{NNN}-{name}.sql` using the standard header format:

```sql
-- {NNN}-{name}.sql
-- {Description of what this migration does}
-- Requires: {list prerequisite migrations, e.g., 001-core.sql}
-- Created: {YYYY-MM-DD}
```

3. **Apply Oracle-specific DDL patterns** used in this codebase:
   - **Primary keys**: `id VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY`
   - **Timestamps**: `created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL`
   - **JSON columns**: Add `CONSTRAINT chk_{table}_{col} CHECK ({col} IS JSON)` for any CLOB storing JSON
   - **Foreign keys**: Inline with `REFERENCES {table}(id)`, add `ON DELETE CASCADE` only for child tables
   - **Status enums**: `CHECK (status IN ('active','inactive',...))` — not a separate lookup table
   - **Org scoping**: Include `org_id VARCHAR2(36) NOT NULL REFERENCES organizations(id)` for tenant-isolated tables
   - **Vector columns**: `VECTOR(1536, FLOAT32)` for embeddings (Oracle 26AI)
   - **Blockchain tables**: `NO DROP UNTIL 365 DAYS IDLE`, `NO DELETE UNTIL 365 DAYS AFTER INSERT`, `HASHING USING "SHA2_256"` for immutable audit
   - **Indexes**: Create named indexes as `idx_{table}_{column}` after the CREATE TABLE

4. **PL/SQL blocks**: When using `BEGIN...EXCEPTION...END`, terminate with `/` on its own line (the migration runner splits on standalone `/` lines).

5. **Verify**: Confirm the filename matches `/^(\d+)-([a-zA-Z0-9_-]+)\.sql$/` — the migration loader rejects other formats.

## Arguments

- `$ARGUMENTS`: The migration name and description (e.g., "notifications - push notification subscriptions and delivery log")

## Example

For `$ARGUMENTS = "scheduled-tasks - cron-style task scheduling for workflows"`:

Creates `009-scheduled-tasks.sql` with tables, indexes, and JSON constraints following the established patterns.
