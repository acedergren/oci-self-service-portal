---
name: review-all
description: Pre-PR review pipeline — runs security, Oracle, API audit, and scope check agents in parallel. Read-only.
---

# Review All

Comprehensive pre-PR review that runs all specialized reviewers in parallel and synthesizes findings into a single report. **Read-only — no changes.**

## When to Use

- Before creating a PR
- After completing a phase of work
- When you want a full-spectrum code quality check beyond what `/health-check` covers

## Pipeline

### Step 1: Identify Changed Files

```bash
git diff --name-only main...HEAD
```

If on `main`, use `git diff --name-only HEAD~5` (last 5 commits) or ask the user for the commit range.

### Step 2: Launch Parallel Review Agents

Spawn four agents with `run_in_background: true` for true parallelism. Collect results via `TaskOutput` when each completes.

No worktree isolation needed — this is a read-only skill.

| Agent                     | Type                                   | Scope                                      | What it checks                                             |
| ------------------------- | -------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| **Security Reviewer**     | `security-reviewer` (custom agent)     | Changed files only                         | OWASP Top 10, IDOR, injection, auth gaps                   |
| **Oracle Query Reviewer** | `oracle-query-reviewer` (custom agent) | Changed files with SQL/Oracle imports      | Bind params, MERGE INTO, UPPERCASE keys, LIKE escaping     |
| **API Route Auditor**     | `Explore` agent                        | `apps/api/src/routes/` + `packages/types/` | Schema coverage, type drift, auth hooks                    |
| **Scope Auditor**         | `Explore` agent                        | `git diff` output                          | Files modified outside task scope, formatting-only changes |

Each agent runs independently and returns findings.

### Step 3: Synthesize Report

Combine all agent outputs into a single report:

```
## Pre-PR Review Report

### Summary
| Reviewer        | Findings | Critical | Warnings |
|-----------------|----------|----------|----------|
| Security        | 2        | 0        | 2        |
| Oracle          | 0        | 0        | 0        |
| API Audit       | 3        | 1        | 2        |
| Scope           | 1        | 0        | 1        |

### Critical Issues (must fix before merge)
[List any CRITICAL/HIGH findings]

### Warnings (consider fixing)
[List MEDIUM/LOW findings]

### Clean Areas
[List what passed review with no issues]
```

### Step 4: Verdict

End with a clear go/no-go:

- **READY TO MERGE** — No critical issues, warnings are acceptable
- **NEEDS FIXES** — Critical issues found, list what must change
- **NEEDS DISCUSSION** — Architectural concerns or ambiguous scope

## Arguments

- `$ARGUMENTS`: Optional scope or commit range
  - Example: `/review-all` — review changes vs main
  - Example: `/review-all HEAD~3` — review last 3 commits
  - Example: `/review-all --security-only` — only security + Oracle reviewers

## Key Rules

1. **Read-only** — do not modify any files
2. **Parallel execution** — all four agents run simultaneously for speed
3. **De-duplicate** — if two agents flag the same line, merge into one finding
4. **No false positives** — only report genuine issues with file:line references
