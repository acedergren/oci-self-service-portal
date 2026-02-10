# Wave Execution Checklist

Reusable checklist the orchestrator reads for each wave transition. All items must pass before proceeding.

## Pre-Wave

- [ ] All blocking tasks from previous wave are completed and verified
- [ ] Quality gate from previous wave passes (`pnpm build && npx vitest run && pnpm lint`)
- [ ] Git status is clean (no uncommitted changes from previous wave)
- [ ] `pnpm install` is current (no new dependencies pending)
- [ ] Task ledger is up to date (no stale in_progress tasks)

## During Wave

- [ ] All agents acknowledged their assignments within 90s
- [ ] QA watcher is running and reporting after each file change
- [ ] No scope creep detected (agents staying within assigned files)
- [ ] Status reported to user every 3 minutes
- [ ] Stall detection running (90s heartbeat check)
- [ ] Each completed task has a verified commit (hash + verify command)

## Post-Wave

- [ ] All tasks in the wave are marked completed in the ledger
- [ ] Each task has a corresponding commit with conventional message format
- [ ] Full quality gate passes:
  - `pnpm build` (production build succeeds)
  - `npx vitest run` (all tests pass)
  - `pnpm lint` (no lint errors)
- [ ] Type checks pass per workspace:
  - `cd packages/shared && npx tsc --noEmit`
  - `cd apps/api && npx tsc --noEmit`
  - `cd apps/frontend && npx svelte-check --tsconfig ./tsconfig.json --threshold error`
- [ ] Security scan on changed files:
  - `semgrep scan --config auto <changed-files>` (no high/critical findings)
- [ ] Wave summary printed with task count, duration, and issues
- [ ] Next wave's dependencies are now unblocked in the ledger
