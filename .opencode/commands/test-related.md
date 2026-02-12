---
name: test-related
description: Run the closest matching Vitest file for a given source file path.
---

# Run Related Tests

Given a source file path, try to find and run a related `*.test.ts` file.

Heuristics:

1) If `foo.ts` has a colocated `foo.test.ts`, run it.
2) Otherwise search the repo for `foo.test.ts` and run the first match.

Usage examples:

```bash
opencode run "Run related tests" --file apps/api/src/plugins/auth.ts
```

Reference implementation: `.claude/hooks/run-related-tests.sh`
