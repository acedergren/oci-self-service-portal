# Agent Role Registry

Maps task characteristics to specialist roles with model selection, turn limits, and domain-specific system prompts.

## Role Definitions

| Role                | Model  | Max Turns | Prompt Template                         | Description                             |
| ------------------- | ------ | --------- | --------------------------------------- | --------------------------------------- |
| `backend-impl`      | sonnet | 50        | `prompt-templates/backend-impl.md`      | Fastify 5 routes, plugins, services     |
| `frontend-impl`     | sonnet | 50        | `prompt-templates/frontend-impl.md`     | SvelteKit pages, components, stores     |
| `mastra-impl`       | sonnet | 50        | `prompt-templates/mastra-impl.md`       | Mastra agents, RAG, tools, workflows    |
| `security-reviewer` | opus   | 80        | `prompt-templates/security-reviewer.md` | OWASP + Oracle security review          |
| `qa-lead`           | haiku  | 30        | `prompt-templates/qa-lead.md`           | TDD, test writing, QA watching          |
| `doc-sync`          | haiku  | 30        | `prompt-templates/doc-sync.md`          | Documentation, README, migration guides |

> **Note**: Claude Code v2.1.47+ fixed the `model` field bug — model selection now works reliably for team teammates. Sonnet 4.6 is the current `sonnet` alias.

## Assignment Rules

The orchestrator assigns roles based on file paths and task metadata. Rules are evaluated top-to-bottom; first match wins.

### By File Path

```
apps/api/src/routes/**          → backend-impl
apps/api/src/plugins/**         → backend-impl
apps/api/src/services/**        → backend-impl
apps/api/src/app.ts             → backend-impl
apps/frontend/src/**            → frontend-impl
apps/api/src/mastra/**          → mastra-impl
packages/shared/src/tools/**    → mastra-impl (tool wrappers)
packages/shared/src/server/**   → backend-impl (shared server utilities)
packages/shared/src/workflows/**→ backend-impl
docs/**                         → doc-sync
*.test.ts                       → qa-lead
```

### By Task Metadata

```
tag: "security"                 → security-reviewer
tag: "test"                     → qa-lead
tag: "docs"                     → doc-sync
verify_command contains "semgrep"→ security-reviewer
```

### By Task Content

```
title contains "migration"      → backend-impl (Oracle migrations)
title contains "review"         → security-reviewer
title contains "audit"          → security-reviewer
```

## Fallback

If no rule matches, assign `backend-impl` (sonnet, 50 turns) as the default — it has the broadest knowledge of the monorepo.

## Max Turns Overrides

The `--max-turns N` flag overrides the role-based max turns for all tasks. This is a soft limit — Claude Code stops the agent when it reaches the limit.

## Model Escalation Path

When a task fails and requires model escalation:

```
haiku  → sonnet  (qa-lead, doc-sync tasks that fail)
sonnet → opus    (backend-impl, frontend-impl, mastra-impl tasks that fail)
opus   → opus    (security-reviewer stays at opus, gets extended max_turns: 120)
```

Max turns are also escalated: failed task max_turns × 1.5 (rounded up) for the retry.

## Agent Naming

When spawning agents, use role-based names:

```
backend-impl   → "backend-{N}"      (e.g., backend-1, backend-2)
frontend-impl  → "frontend-{N}"
mastra-impl    → "mastra-{N}"
security-reviewer → "security-{N}"
qa-lead        → "qa-{N}"
doc-sync       → "docs-{N}"
```

This makes status reports immediately readable.
