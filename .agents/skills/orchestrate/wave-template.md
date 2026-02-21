# Wave Execution Checklist

Reusable checklist the orchestrator reads for each wave transition. All items must pass before proceeding.

## Pre-Wave

- [ ] All blocking tasks from previous wave are completed and verified
- [ ] Quality gate from previous wave passes (`pnpm build && npx vitest run && pnpm lint`)
- [ ] Git status is clean (no uncommitted changes from previous wave)
- [ ] `pnpm install` is current (no new dependencies pending)
- [ ] Task ledger is up to date (no stale in_progress tasks)
- [ ] Stale worktrees pruned (`git worktree prune`)
- [ ] Prompts generated for all tasks in the wave (inspect with `--dry-run`)

## During Wave

- [ ] Background agents spawned with `isolation: "worktree"` and `run_in_background: true`
- [ ] Monitor polling running via `TaskOutput({ block: false })` at 30s intervals
- [ ] No scope creep detected (agents staying within assigned files)
- [ ] Status reported to user periodically (every 3 minutes)
- [ ] Each completed task has a verified commit in its worktree

## Post-Wave — Merge Back

- [ ] Each agent's worktree merged back sequentially (`git merge <agent-branch> --no-edit`)
- [ ] No unresolved merge conflicts (conflicts resolved or escalated)
- [ ] Each task's `verify_command` passes after merge
- [ ] All tasks in the wave are marked completed in the ledger
- [ ] Each task has a corresponding commit with conventional message format

## Post-Wave — Quality Gate

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
- [ ] Failed tasks have been escalated through all tiers or user-resolved
- [ ] Worktrees cleaned up (`git worktree prune`)
