---
name: orchestrate
description: Coordinate parallel agent teams with task ledger tracking, heartbeat monitoring, and quality gates.
---

# Orchestrate

Coordinate a team of parallel agents to execute a phase from the task plan. Manages task assignment, heartbeat monitoring, verification, scope enforcement, and wave transition quality gates.

## Steps

### 1. Parse Arguments

Extract the orchestration target from `$ARGUMENTS`:

- **Phase ID** (e.g., `A`, `B`, `D`): Load tasks from `.claude/reference/phase-10-task-plan.md` for that phase
- **Plan file path** (e.g., `docs/plans/my-plan.md`): Parse tasks from the given file
- **Inline task list** (e.g., `"task1; task2; task3"`): Create tasks from semicolon-separated descriptions
- **`--dry-run`**: Parse and display tasks without spawning agents
- **`--wave N`**: Start from wave N (skip earlier waves, assumes they're complete)
- **`--max-agents N`**: Cap agent count (default: 5)

If no arguments, ask the user what to orchestrate.

### 2. Initialize Task Ledger

For each task in the plan, use `TaskCreate` with:

- `subject`: Task title (e.g., "A-1.01 Update patch/minor runtime deps")
- `description`: Full task spec including files to modify, verification command, and agent instructions
- `activeForm`: Present-continuous description (e.g., "Updating runtime dependencies")
- `metadata`:
  ```json
  {
  	"agent_type": "haiku|sonnet",
  	"phase": "A",
  	"wave": "1",
  	"task_id": "A-1.01",
  	"estimated_duration": "20m",
  	"verify_command": "pnpm install && pnpm build",
  	"files": "package.json (root, api, frontend)",
  	"status_detail": "pending"
  }
  ```

Set up `blockedBy` dependencies from the task plan's **Depends** column using `TaskUpdate`.

Print a summary:

```
Phase A: Dependency Updates + Fastify Hardening
  22 tasks (6 haiku, 16 sonnet) across 3 waves
  Wave 1: 6 tasks (all haiku, all parallel)
  Wave 2: 12 tasks (1 haiku, 11 sonnet)
  Wave 3: 4 tasks (2 haiku, 2 sonnet)
  Estimated: ~13 hours agent work
```

### 3. Create Team

Use `TeamCreate` with a descriptive name derived from the phase:

- Phase A → team name `phase-A-foundation`
- Phase B → team name `phase-B-package-split`
- Custom plans → team name from `$ARGUMENTS` or prompt user

Determine agent count from max parallelism in the current wave (capped by `--max-agents`).

Spawn agents via the `Task` tool with:

- `team_name`: The team name from above
- `subagent_type`: `general-purpose` (all agents need full tool access)
- `model`: Match the task's `agent_type` — `haiku` for haiku tasks, `sonnet` for sonnet tasks
- `name`: Convention `{model}-{role}-{N}` (e.g., `sonnet-impl-1`, `haiku-deps-2`)

**Always** spawn one `haiku-qa` agent for continuous QA watching (per the QA Watcher Protocol in `.claude/reference/phase-10-task-plan.md`).

Agent spawn prompt template:

```
You are {name}, a member of team "{team_name}".

Your role: Execute assigned tasks from the task ledger. For each task:
1. Acknowledge receipt immediately via SendMessage to the team lead
2. Read full task details with TaskGet
3. Implement the task, committing with `/quality-commit` or manual quality gates
4. Report completion with commit hash via SendMessage
5. Check TaskList for your next assignment

QA protocol: After every Edit/Write, notify haiku-qa with changed file paths.
Scope: ONLY work on your assigned task. If you discover related work, report it — do not expand scope.
```

### 4. Assign First Wave

Read `TaskList` to find unblocked, unassigned tasks matching the current wave.

For each idle agent:

1. Find a matching task (haiku tasks → haiku agents, sonnet tasks → sonnet agents)
2. Use `TaskUpdate` to set `owner` and `status: in_progress`
3. Update metadata: `{ "assigned_at": "<ISO timestamp>", "status_detail": "assigned" }`
4. Send task details via `SendMessage` including:
   - Task ID and title
   - Files to modify
   - Verification command
   - Any dependencies or context from completed tasks

### 5. Monitor Loop

Run until all tasks in all waves are complete.

#### On Agent Message Received

**Acknowledgment** → Update metadata:

```json
{ "status_detail": "in_progress", "last_heartbeat": "<ISO timestamp>" }
```

**Completion claim** → Verify before marking done:

1. Check commit exists: Ask agent for commit hash, verify with `git log --oneline -1 <hash>`
2. Run the task's `verify_command` from metadata
3. If verified:
   - `TaskUpdate` → `status: completed`
   - Assign next unblocked task from the wave (or next wave if current is done)
4. If not verified:
   - Send specific feedback about what failed
   - Keep task `in_progress`

**Issue report** → Assess severity:

- Blocking: Create a fix task, assign to available agent
- Non-blocking: Log and continue
- Scope creep: Redirect agent back to assigned task

#### Stall Detection

Every 90 seconds, check in-progress tasks:

1. Read `TaskList` for tasks with `status: in_progress`
2. Check `last_heartbeat` timestamp in metadata
3. If stale (>90s with no message from the assigned agent):
   - Send a check-in message to the agent
   - If no response after another 90s: mark as stalled, reassign to a different agent
   - Update metadata: `{ "status_detail": "stalled", "reassigned_from": "<agent-name>" }`

#### Scope Enforcement

If an agent reports working on files NOT listed in their task's `files` metadata:

1. Send a stop message: "You're modifying files outside your task scope. Please revert and focus on: {task files}"
2. If repeated: Reassign the task to a different agent

#### Status Report

Print every 3 minutes (or when the user asks):

```
+------------------------------------------+
| Phase A -- Wave 2 Progress               |
+------------------------------------------+
| Completed: 6/12  | In Progress: 3       |
| Stalled: 0       | Pending: 3           |
+------------------------------------------+
| sonnet-impl-1: A-2.04 Valkey cache  [##-]|
| sonnet-impl-2: A-2.10 OracleStore   [#--]|
| haiku-deps-1:  A-2.11 knip CI       [###]|
| haiku-qa:      watching (last: PASS)     |
+------------------------------------------+
```

### 6. Wave Transition Gate

When all tasks in a wave are complete:

1. Run full quality gate:

   ```bash
   pnpm build && npx vitest run && pnpm lint
   ```

2. If the phase's wave has a specific **Gate** command (from the task plan), run that too
3. **Gate passes** → Move to next wave, assign new tasks per Step 4
4. **Gate fails** → Diagnose the failure, create a fix task, assign to an available agent

Read the wave checklist from `wave-template.md` for the full pre/during/post checklist.

### 7. Phase Completion

When all waves are complete:

1. Run the phase's final verification (from the task plan's last wave Gate)
2. Run `/health-check --quick` for a comprehensive quality check
3. Print final summary:

   ```
   Phase A Complete
     Tasks: 22/22 completed
     Duration: 4h 32m
     Agents: 5 (2 sonnet, 2 haiku, 1 qa)
     Commits: 22
     Issues: 2 (1 stall reassignment, 1 scope redirect)
     Quality: All gates passed
   ```

4. Shut down all agents via `SendMessage` with `type: shutdown_request`
5. Clean up team via `TeamDelete`

### 8. Cross-Phase Handoff

If more phases are queued (following the Phase Dependency DAG):

1. Check which phases are now unblocked (e.g., after A completes → B, D, F are unblocked)
2. For parallel phases, set up git worktrees per the Git Worktree Parallelization Strategy:

   ```bash
   git worktree add ../portal-phase-{X} phase-10/{X}-{name}
   cd ../portal-phase-{X} && pnpm install
   ```

3. Start a new orchestration cycle for each unblocked phase
4. Report to user which phases are starting in parallel

## Arguments

- `$ARGUMENTS`: Phase ID, plan file path, or inline task list. Optional flags:
  - `--dry-run`: Parse and display tasks without spawning agents
  - `--wave N`: Start from wave N (skip earlier completed waves)
  - `--max-agents N`: Cap concurrent agent count (default: 5)
  - `--no-qa`: Skip spawning a dedicated QA watcher (not recommended)
  - `--verbose`: Print all agent messages to the user (noisy but useful for debugging)

## Integration Points

### Referenced Skills

- **`/quality-commit`** — Agents use this for each task's commit step
- **`/tdd`** — Agents use this for implementation tasks needing test coverage
- **`/health-check`** — Run at phase completion for comprehensive validation

### Referenced Protocols

- **QA Watcher Protocol** — `.claude/reference/phase-10-task-plan.md` section "Continuous QA Watcher Protocol"
- **Git Worktree Strategy** — `.claude/reference/phase-10-task-plan.md` section "Git Worktree Parallelization Strategy"
- **Phase Dependency DAG** — A→B→C, A→D, A→F, B→E (from task plan header)

### Claude Code Native Tools Used

- `TeamCreate` / `TeamDelete` — Team lifecycle
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` — Ledger operations
- `SendMessage` — Agent communication (DM, broadcast, shutdown)
- `Task` tool — Spawning agents with `team_name` parameter

## Examples

- `/orchestrate A` — Run Phase A (Dependency Updates + Fastify Hardening)
- `/orchestrate A --dry-run` — Preview Phase A tasks without spawning agents
- `/orchestrate A --wave 2` — Resume Phase A from Wave 2
- `/orchestrate A --max-agents 3` — Run Phase A with at most 3 concurrent agents
- `/orchestrate docs/plans/custom-plan.md` — Orchestrate from a custom plan file
- `/orchestrate "add auth middleware; write auth tests; update docs"` — Inline tasks

## Error Recovery

- **Agent crashes**: Detect via stall timeout, reassign task to new agent
- **Quality gate fails**: Create fix task, assign to available agent, re-run gate
- **All agents stalled**: Report to user, suggest manual intervention or restart
- **Git conflicts**: If worktree merge fails, pause and ask user for resolution strategy
