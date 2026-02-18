# DevOps Skill A++ Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate all targeted DevOps/OCI skills (local + curated externals) to A++ per skill-judge rubric, validate via TDD loop (fail → edit → pass), and publish the improved skills to `agentic-tools/skills`.

**Architecture:** Treat each skill as an independent module. For every skill, run skill-judge to capture the failing baseline, refactor SKILL.md (and references) to add expert-only knowledge, anti-patterns, decision trees, and progressive disclosure triggers, then rerun skill-judge until it grades ≥108. Track progress in `docs/skills/2026-02-16-devops-skill-audit.md`. After upgrades, stage changes locally, mirror them into `agentic-tools/skills`, and push via Git.

**Tech Stack:** Markdown SKILL specs, `skill-judge` rubric, pnpm repo tooling, git, GitHub (`agentic-tools/skills`).

---

### Task 1: Cloudflare Skill A++ Upgrade

**Files:**

- Modify: `~/.config/opencode/skill/cloudflare/SKILL.md`
- Modify: `~/.config/opencode/skill/cloudflare/references/*.md` (as needed for new outage runbooks)
- Update: `docs/skills/2026-02-16-devops-skill-audit.md`

**Step 1: Write the failing test**

Run skill-judge against the current Cloudflare skill and capture the sub-A++ score.

Command: `npx skills evaluate --skill cloudflare` (expect <108, current C grade)

**Step 2: Implement improvements**

- Rewrite description to include trigger keywords (Workers, WAF, Tunnel, Vectorize, D1, Access).
- Add explicit anti-pattern section (e.g., never expose origin IPs, never bypass Access for service tokens, never mix R2 public buckets with tokenless writes).
- Embed outage playbooks (Zero Trust breakdown, Tunnel flaps, certificate mismatches) and refer to reference files; add decisive decision trees (e.g., "Need AI vs need storage?" → product selection with constraints) plus `MANDATORY - READ` triggers.
- Update references directory with runbooks if needed.
- Log the new plan in audit table (edit row with TODO → Done once tests pass).

**Step 3: Rerun tests**

Command: `npx skills evaluate --skill cloudflare`

Expected: ≥108/120 (A++). If not, iterate within this task.

**Step 4: Update audit doc**

Modify the Cloudflare row in `docs/skills/2026-02-16-devops-skill-audit.md` to reflect the new score and resolved gaps.

**Step 5: Commit (later)**

Stage changes when batch for multiple skills is ready; note files for Task 17.

---

### Task 2: Compute Management Skill Upgrade

**Files:**

- Modify: `~/.config/opencode/skill/compute-management/SKILL.md`
- Update: `docs/skills/2026-02-16-devops-skill-audit.md`

**Step 1: Write failing test**

`npx skills evaluate --skill compute-management` (expect 104/120)

**Step 2: Implement improvements**

- Extend description with burstable/Flex keywords (E3.Flex, BM.Standard) and automation cues.
- Insert automation checklist for scaling + backup (Terraform module references, CLI loops) and mark shape reference as `MANDATORY` when evaluating new workloads.
- Add anti-patterns for mixing Ampere/AMD shapes without throughput validation.

**Step 3: Rerun skill-judge** (expect ≥108)

**Step 4: Update audit doc**

---

### Task 3: Monitoring Operations Skill Upgrade

**Files:**

- Modify: `~/.config/opencode/skill/monitoring-operations/SKILL.md`

**Steps:**

1. `npx skills evaluate --skill monitoring-operations` (expect 107/120 fail)
2. Add outage runbooks (metric gap triage, Alarm stuck states), decision tree selecting Log Analytics vs Service Connector Hub vs Logging Analytics; include `MANDATORY` triggers for reference docs and anti-patterns for `treatMissingData = null` misuse.
3. Re-evaluate (target ≥108) and update audit row.

---

### Task 4: Networking Management Skill Upgrade

**Files:** `~/.config/opencode/skill/networking-management/SKILL.md`

Steps follow the same TDD loop:

1. Evaluate (currently 108 but needs A++). Expect fail (<108) due to missing failure drills.
2. Add FastConnect vs VPN outage decision tree, automation scripts for failover, Do/Do-not load instructions for cost calculators.
3. Re-run evaluation (target ≥110) and log improvements.

---

### Task 5: Database Management Skill Upgrade

**Files:** `~/.config/opencode/skill/database-management/SKILL.md`

TDD Steps:

1. Evaluate (108/120 fail for A++ target).
2. Add Data Guard + cross-region outage drills, automation checklists for sqlcl/OCI CLI (with reference triggers), and PHI-handling warnings for SQL traces.
3. Re-judge; update audit doc.

---

### Task 6: GenAI Services Skill Upgrade

**Files:** `~/.config/opencode/skill/genai-services/SKILL.md`, references.

Steps:

1. Evaluate (103 baseline).
2. Add RAG troubleshooting decision tree, PHI-safe cache instructions, multi-model fallback guidance; add keywords (embeddings, cache, streaming) in description and `MANDATORY` reference trigger for PHI policy.
3. Rerun tests; update audit.

---

### Task 7: Landing Zones Skill Upgrade

**Files:** `~/.config/opencode/skill/landing-zones/SKILL.md`

Steps:

1. Evaluate (110 baseline) to confirm failure.
2. Add multi-tenant IAM decision tree (federated vs app compartments) and automation scripts for security zone rollouts referencing CLI.
3. Re-judge & update audit.

---

### Task 8: FinOps Cost Optimization Skill Upgrade

**Files:** `~/.config/opencode/skill/finops-cost-optimization/SKILL.md`

Steps:

1. Evaluate (105 baseline).
2. Add FinOps maturity decision tree, automation playbooks for unused resource cleanup, Do/Do-not load instructions for CLI reference; update description keywords (anomaly detection, cleanup scripts).
3. Rerun evaluation and update audit.

---

### Task 9: Secrets Management Skill Upgrade

**Files:** `~/.config/opencode/skill/secrets-management/SKILL.md`

Steps:

1. Evaluate (107 baseline).
2. Add cross-region rotation playbooks, PHI-safe cache eviction instructions, and explicit Do/Do-not load triggers for `oci-vault-reference.md`; enrich description with rotation keywords.
3. Rerun tests and update audit.

---

### Task 10: Oracle Migration Skill Upgrade

**Files:** `.claude/skills/oracle-migration/SKILL.md`

Steps:

1. Evaluate existing D-grade via skill-judge.
2. Add anti-patterns, numbering validation rules, stepwise TDD checklist for migrations, and description triggers for ADB numbering. Add references if needed with proper load instructions.
3. Re-judge to confirm ≥108.

---

### Task 11: Oracle DBA Skill Upgrade

**Files:** `~/.agents/skills/oracle-dba/SKILL.md`

Steps:

1. Evaluate baseline (110) to confirm fail vs A++.
2. Add multi-region failover drills, Data Guard switch instructions, and reference triggers for sqlcl automation.
3. Re-run skill-judge; update audit.

---

### Task 12: Best Practices Skill Upgrade

**Files:** `~/.config/opencode/skill/best-practices/SKILL.md`

Steps:

1. Evaluate baseline (105).
2. Add AWS/Azure migration decision tree and `MANDATORY` reference trigger for well-architected checklist; include automation scripts for Security Zones enablement.
3. Rerun tests; update audit entry.

---

### Task 13: IAM Identity Management Skill Upgrade

**Files:** `~/.config/opencode/skill/iam-identity-management/SKILL.md`

Steps:

1. Evaluate baseline (105).
2. Add cross-tenant federation decision tree and IDCS playbook triggers; extend anti-patterns for `any-user` with reasons.
3. Re-judge; update audit row.

---

### Task 14: Infrastructure-as-Code Skill Upgrade

**Files:** `~/.config/opencode/skill/infrastructure-as-code/SKILL.md`

Steps:

1. Evaluate baseline (107).
2. Add module-selection decision tree (Resource Manager stack vs local Terraform), Do/Do-not load instructions for pattern references, and automation scripts for `terraform state` recovery sequences.
3. Re-judge and update audit row.

---

### Task 15: External Skill Upgrades (Docker Expert & Microservices Patterns)

**Files:**

- `external:sickn33/antigravity-awesome-skills/docker-expert/SKILL.md`
- `external:wshobson/agents/microservices-patterns/SKILL.md`

Steps:

1. For each skill, pull latest content into workspace (e.g., under `vendor/skills/<name>/SKILL.md`).
2. Run skill-judge to confirm baseline (Docker 96, Microservices 86).
3. Update SKILLs:
   - Docker: add anti-patterns, base image decision trees, reference triggers, outage playbooks for registry and Compose.
   - Microservices: add decision trees for decomposition, explicit anti-patterns, reference loading cues, and expert trade-offs (data ownership, saga vs outbox).
4. Re-judge each skill (target ≥108) and reflect scores in audit doc.

---

### Task 16: External Skill Upgrades (Architecture Decision Records, Database Migration, Release Skills)

**Files:** Remote repo copies for:

- `external:wshobson/agents/architecture-decision-records/SKILL.md`
- `external:wshobson/agents/database-migration/SKILL.md`
- `external:jimliu/baoyu-skills/release-skills/SKILL.md`

Steps:

1. Pull SKILLs (store under `vendor/skills/...`).
2. Run skill-judge for each (record gaps in audit doc if not already).
3. Implement improvements per earlier evaluation (ADR anti-patterns, migration backups, release anti-patterns) with TDD loop.
4. Update audit table entries.

---

### Task 17: Consolidated Verification & Publishing

**Files:** All updated SKILLs, references, `docs/skills/2026-02-16-devops-skill-audit.md`, `docs/plans/2026-02-16-devops-skill-refactor.md`

**Step 1: Run regression tests**

- Re-run skill-judge sequentially for every skill to confirm ≥108.
- Ensure audit doc matches final scores.

**Step 2: Stage and commit changes locally**

Use targeted staging (no `git add .`). Example:

```bash
git add docs/skills/2026-02-16-devops-skill-audit.md \
        docs/plans/2026-02-16-devops-skill-refactor.md \
        ~/.config/opencode/skill/**/*SKILL.md \
        vendor/skills/**/SKILL.md
```

Commit message sample: `feat(skills): elevate devops skill pack to A++`

**Step 3: Publish to agentic-tools/skills**

1. Clone `git@github.com:agentic-tools/skills.git` into `~/Projects/agentic-tools-skills` (if not already).
2. Copy updated SKILL directories into the repo, preserving structure.
3. Update that repo’s README or index if required.
4. Run `git status`, review, then commit and push (`git push origin main`).

**Step 4: Verification note**

Document final outcomes (scores, publish SHAs) in `docs/skills/2026-02-16-devops-skill-audit.md`.

---

After plan completion, ask whether to execute via subagents (in this session) or delegate to a new session using superpowers:executing-plans.
