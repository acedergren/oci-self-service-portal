---
name: manage-secrets
description: Safely manage OCI Vault secrets using the repo script (always confirm; never print full values by default).
---

# Manage Secrets (OCI Vault)

This repo includes a script for managing secrets in OCI Vault:

- Script: `.claude/skills/manage-secrets/manage-secrets.sh`

Safety rules:

- Always ask for explicit confirmation before `upload` or `delete`.
- For `get`, ask for confirmation before retrieval, and print only a truncated value by default.
- Never paste full secrets into chat logs.
- Prefer reading secret values from stdin or env vars.

## Operations

Upload (create/update):

```bash
SCRIPT=".claude/skills/manage-secrets/manage-secrets.sh"

# via stdin (preferred)
printf "%s" "$SECRET_VALUE" | bash "$SCRIPT" upload "my-secret"

# via argument (less safe)
bash "$SCRIPT" upload "my-secret" "$SECRET_VALUE"
```

Find:

```bash
bash .claude/skills/manage-secrets/manage-secrets.sh find "pattern"
```

List:

```bash
bash .claude/skills/manage-secrets/manage-secrets.sh list
```

Get:

```bash
VALUE=$(bash .claude/skills/manage-secrets/manage-secrets.sh get "my-secret")
```

Delete:

```bash
bash .claude/skills/manage-secrets/manage-secrets.sh delete "my-secret"
```

Reference: `.claude/skills/manage-secrets/SKILL.md`
