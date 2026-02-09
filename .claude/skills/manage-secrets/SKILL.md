---
name: manage-secrets
description: Full CRUD for OCI Vault secrets (ac-vault). Upload, find, list, get, and delete secrets.
---

# Manage Secrets

Full secret lifecycle management for OCI Vault (ac-vault, eu-frankfurt-1).

## Steps

### 1. Parse Arguments

Check `$ARGUMENTS` for:

- **`<name> <value>`**: Create or update a secret
- **`--from-env <ENV_VAR> <secret-name>`**: Read value from environment variable
- **`--find <pattern>`**: Search secrets by name substring
- **`--list`**: List all secrets in the vault
- **`--get <name>`**: Retrieve a secret's current value
- **`--delete <name>`**: Schedule a secret for deletion
- **No arguments**: Ask the user what they want to do

### 2. Route to Operation

#### Upload (create/update): `<name> <value>` or `--from-env`

1. **Validate**: Name must be alphanumeric with hyphens/underscores. Value must not be empty.
2. **Warn** if the value looks like a file path (offer to read the file instead).
3. **Confirm before writing** — show this summary:

```
--- OCI Vault Upload ---
Operation: CREATE or UPDATE
Name:      linkedin-access-token
Value:     AQX...j1og (267 chars, truncated)
Vault:     ac-vault (eu-frankfurt-1)
---
```

Ask: **"Upload this secret?"** — Do NOT proceed without user approval.

4. **Execute**:

```bash
SCRIPT="$CLAUDE_PROJECT_DIR/.claude/skills/manage-secrets/manage-secrets.sh"
bash "$SCRIPT" upload "<name>" "<value>"
```

For `--from-env`:

```bash
bash "$SCRIPT" upload "<secret-name>" "${!ENV_VAR}"
```

5. **Report**:

```
--- Secret Stored ---
Name:  linkedin-access-token
OCID:  ocid1.vaultsecret.oc1.eu-frankfurt-1...
Vault: ac-vault
---
```

#### Find: `--find <pattern>`

1. **Execute**:

```bash
bash "$SCRIPT" find "<pattern>"
```

2. **Report**: Show the table of matching secrets (name, OCID, created date).

#### List: `--list`

1. **Execute**:

```bash
bash "$SCRIPT" list
```

2. **Report**: Show the full table of secrets.

#### Get: `--get <name>`

1. **Confirm before revealing** — secret values are sensitive:

```
--- Secret Retrieval ---
Name:  linkedin-access-token
Vault: ac-vault (eu-frankfurt-1)
---
```

Ask: **"Retrieve and display this secret value?"**

2. **Execute**:

```bash
VALUE=$(bash "$SCRIPT" get "<name>")
```

3. **Report**: Show the value **truncated** (first 3 + last 3 chars, total length). Only show the full value if the user explicitly asks for it or needs it for a specific operation (e.g., setting an env var).

#### Delete: `--delete <name>`

1. **Confirm before deleting** — this is a destructive operation:

```
--- Secret Deletion ---
Name:      linkedin-access-token
Vault:     ac-vault (eu-frankfurt-1)
Recovery:  Secret can be recovered during the 30-day waiting period
---
```

Ask: **"Schedule this secret for deletion?"** — Do NOT proceed without explicit approval.

2. **Execute**:

```bash
bash "$SCRIPT" delete "<name>"
```

3. **Report**: Confirm deletion was scheduled and mention the recovery window.

### 3. Handle Errors

- Secret not found → suggest using `--find` or `--list` to discover available secrets
- Permission denied → check OCI CLI configuration
- Vault unreachable → check network/region settings

## Arguments

- `$ARGUMENTS`: Operation and parameters:
  - `<name> <value>` — Create or update a secret
  - `--from-env <ENV_VAR> <secret-name>` — Read value from environment variable
  - `--find <pattern>` — Search secrets by name (substring match)
  - `--list` — List all active secrets
  - `--get <name>` — Retrieve secret value
  - `--delete <name>` — Schedule secret for deletion
  - If empty: Interactive mode (ask what to do)

## Security

- **NEVER** log, print, or echo full secret values in command output
- **ALWAYS** truncate displayed values (show first 3 + last 3 chars) unless user explicitly requests full value
- For `--get`: Default to truncated display. Only reveal full value when user confirms they need it.
- For `--delete`: OCI Vault uses deferred deletion (30-day recovery window by default)
- The script passes values via command arguments — for very long secrets, prefer `--from-env`

## Examples

- `/manage-secrets linkedin-access-token AQX...token...` — Store LinkedIn token
- `/manage-secrets --from-env LINKEDIN_ACCESS_TOKEN linkedin-access-token` — Store from env var
- `/manage-secrets --find cloudflare` — Find all secrets with "cloudflare" in the name
- `/manage-secrets --list` — List all secrets in ac-vault
- `/manage-secrets --get oracle-admin-password` — Retrieve Oracle DB password
- `/manage-secrets --delete old-api-key` — Schedule deletion of unused secret
- `/manage-secrets` — Interactive: ask what to do
