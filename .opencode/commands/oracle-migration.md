---
name: oracle-migration
description: Create a new numbered Oracle migration file with repo-specific DDL patterns.
---

# Oracle Migration Generator

Create a new migration file using the repo's conventions.

Required behavior:

1. Find highest existing `NNN-*.sql` migration number and increment.
2. Create `NNN-<name>.sql` with standard header.
3. Follow established DDL patterns (PKs, timestamps, JSON constraints, org scoping, VECTOR columns, etc.).
4. Ensure filename matches the migration loader regex.

Reference: `.claude/skills/oracle-migration/SKILL.md`
