---
name: circular-check
description: Check for circular deps for a specific file or workspace using madge.
---

# Circular Dependency Check

Run `madge --circular` with the correct tsconfig for the workspace.

Common invocations:

```bash
npx madge --circular --ts-config apps/api/tsconfig.json apps/api/src/
npx madge --circular --ts-config apps/frontend/tsconfig.json apps/frontend/src/
npx madge --circular --ts-config packages/shared/tsconfig.json packages/shared/src/
```

Reference implementation: `.claude/hooks/check-circular-deps.sh`
