# quality-commit

Run quality gates on staged changes, then commit.

Usage:

```bash
# Standard flow: lint + typecheck + semgrep + related tests + commit
/quality-commit

# Include CodeRabbit review
/quality-commit --review

# Validate only (no commit)
/quality-commit --dry-run

# Commit then push
/quality-commit --push
```

Notes:

- This command assumes you have already staged the intended files.
- If repo-wide hooks fail due to unrelated baseline issues, rerun with `--no-verify` only after reviewing gate results.
