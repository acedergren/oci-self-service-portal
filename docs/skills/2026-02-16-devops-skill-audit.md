# 2026-02-16 DevOps Skill Audit

Tracking baseline evaluations before refactoring each skill to A++ quality. Scores reference the skill-judge rubric (120-point max) and capture the most critical gaps we must close before publishing to `agentic-tools/skills`.

| Skill                    | Source Path                                                | Baseline Score | Grade | Critical Gaps                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------- | -------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| cloudflare               | ~/.config/opencode/skill/cloudflare/SKILL.md               | 111/120        | A     | Gaps resolved: description now lists Workers/Pages/DO/WAF/Tunnel/Vectorize/D1/Access/Workers AI, anti-patterns + runbooks + decision trees shipped |
| compute-management       | ~/.config/opencode/skill/compute-management/SKILL.md       | 115/120        | A     | Gaps resolved: burstable/Flex keywords, automation checklist + CLI reference, mandatory shape/automation loading cues                              |
| monitoring-operations    | ~/.config/opencode/skill/monitoring-operations/SKILL.md    | 107/120        | B     | Missing outage runbooks + Service Connector vs Log Analytics decision tree; description lacks Log Analytics keywords                               |
| networking-management    | ~/.config/opencode/skill/networking-management/SKILL.md    | 108/120        | A     | Gaps resolved: FastConnect/VPN incident playbooks, DRG decision tree, and Usage API cost-calculator triggers shipped (final 115/120 · A++)         |
| database-management      | ~/.config/opencode/skill/database-management/SKILL.md      | 115/120        | A     | Gaps resolved: Data Guard failover/failback runbooks, sqlcl automation checklist, PHI-safe trace guidance, mandatory `oci-dbcs-cli` loading cues   |
| genai-services           | ~/.config/opencode/skill/genai-services/SKILL.md           | 115/120        | A     | Gaps resolved: PHI-safe cache policy + RAG troubleshooting references, multi-model fallback guidance, and expanded description keywords            |
| landing-zones            | ~/.config/opencode/skill/landing-zones/SKILL.md            | 115/120        | A     | Gaps resolved: multi-tenant IAM decision tree + security zone automation checklist/reference                                                       |
| finops-cost-optimization | ~/.config/opencode/skill/finops-cost-optimization/SKILL.md | 105/120        | B     | Needs FinOps maturity decision tree + automated cleanup scripts + stronger CLI reference triggers                                                  |
| secrets-management       | ~/.config/opencode/skill/secrets-management/SKILL.md       | 107/120        | B     | Missing cross-region rotation playbooks + Do/Do-not load triggers for `oci-vault-reference.md`; description lacks rotation keywords                |
| oracle-migration         | .claude/skills/oracle-migration/SKILL.md                   | 82/120         | D     | No anti-patterns, lacks verification/test steps, description omits migration numbering keywords                                                    |
| oracle-dba               | ~/.agents/skills/oracle-dba/SKILL.md                       | 110/120        | A     | Add Data Guard failover drills + reference trigger for sqlcl automation                                                                            |
| best-practices           | ~/.config/opencode/skill/best-practices/SKILL.md           | 105/120        | B     | Needs AWS/Azure migration decision tree + reference trigger for well-architected checklist                                                         |
| iam-identity-management  | ~/.config/opencode/skill/iam-identity-management/SKILL.md  | 105/120        | B     | Needs cross-tenant federation decision tree + reference trigger for IDCS playbooks                                                                 |
| infrastructure-as-code   | ~/.config/opencode/skill/infrastructure-as-code/SKILL.md   | 107/120        | B     | Needs module-selection decision tree + Do/Do-not load trigger for terraform pattern references                                                     |
| docker-expert            | external:sickn33/antigravity-awesome-skills/docker-expert  | 96/120         | B     | Needs explicit anti-patterns + decision trees for base image selection + reference triggers                                                        |
| microservices-patterns   | external:wshobson/agents/microservices-patterns            | 86/120         | C     | Needs decision trees, anti-pattern list, and reference loading cues; currently descriptive only                                                    |

## Manual Skill-Judge Evidence

Detailed D1–D8 scores for compute-management are captured below so reviewers can verify both the baseline measurement (Step 1) and the final run (Step 3).

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 18  | 14  | 13  | 10  | 12  | 15  | 9   | 13  | 104/120 |
| Final    | 19  | 14  | 14  | 15  | 14  | 15  | 10  | 14  | 115/120 |

### monitoring-operations Manual Evidence

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 17  | 13  | 13  | 12  | 12  | 14  | 12  | 14  | 107/120 |
| Final    | 18  | 14  | 14  | 14  | 13  | 14  | 12  | 14  | 113/120 |

### networking-management Manual Evidence

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 17  | 13  | 13  | 13  | 13  | 14  | 12  | 13  | 108/120 |
| Final    | 18  | 14  | 14  | 14  | 14  | 15  | 12  | 14  | 115/120 |

### database-management Manual Evidence

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 17  | 13  | 13  | 13  | 12  | 14  | 13  | 13  | 108/120 |
| Final    | 18  | 14  | 14  | 14  | 14  | 14  | 13  | 14  | 115/120 |

### genai-services Manual Evidence

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 15  | 13  | 12  | 12  | 12  | 13  | 13  | 13  | 103/120 |
| Final    | 18  | 14  | 14  | 14  | 14  | 14  | 13  | 14  | 115/120 |

### landing-zones Manual Evidence

| Run      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | Total   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ------- |
| Baseline | 17  | 14  | 13  | 14  | 13  | 14  | 13  | 12  | 110/120 |
| Final    | 18  | 14  | 14  | 14  | 14  | 15  | 13  | 13  | 115/120 |
