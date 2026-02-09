---
name: linkedin-post
description: Draft, humanize, preview, and publish LinkedIn posts via the LinkedIn API. Supports text, images, and code snippets.
---

# LinkedIn Post

Draft, refine, and publish posts to LinkedIn. Always confirms before posting.

## Steps

### 1. Check Setup

Verify `LINKEDIN_ACCESS_TOKEN` is set:

```bash
[[ -n "${LINKEDIN_ACCESS_TOKEN:-}" ]] && echo "Token set" || echo "Token missing"
```

If missing and `$ARGUMENTS` contains `--setup`, go to the Setup section below.
If missing and no `--setup`, print:

> LinkedIn token not configured. Run `/linkedin-post --setup` to get started.

And stop.

### 2. Determine Content Source

Check `$ARGUMENTS` for content mode:

- **No arguments** (just `/linkedin-post`): Ask the user what they want to post about. Help them draft it interactively.
- **`--text "content"`**: Use the provided text directly.
- **`--file /path/to/file.md`**: Read the file contents as the post body.
- **`--last`**: Use the most recently drafted post from this conversation (look back through chat history).
- **`--code /path/to/file.ts`**: Create a code snippet post (see Code Snippets section).

### 3. Draft / Refine

If content needs drafting or refining:

1. Write a draft following LinkedIn best practices:
   - Hook in the first 2 lines (shown before "see more")
   - Short paragraphs, whitespace between them
   - 1300 characters is the sweet spot (max 3000)
   - No walls of text
   - Hashtags at the end (3-5 max)

2. If `$ARGUMENTS` contains `--humanize`, run the `/humanizer` skill on the draft to remove AI patterns.

3. Show the draft to the user with a character count.

### 4. Handle Images (if applicable)

If `$ARGUMENTS` contains `--image /path/to/image`:

1. Verify the file exists and is a supported format (PNG, JPG, GIF).
2. Show the user a preview note: "Will attach: [filename] ([size])"

If `$ARGUMENTS` contains multiple `--image` flags, collect all paths for multi-image post.

### 5. Handle Code Snippets

If `$ARGUMENTS` contains `--code /path/to/file`:

1. Read the code file.
2. LinkedIn doesn't support native code blocks. Options (ask user):
   - **Inline**: Wrap short snippets (< 10 lines) in the post text using whitespace formatting.
   - **Screenshot**: Use the browser automation tools to create a code screenshot via carbon.now.sh or ray.so.
   - **Image**: If user has a pre-made code image, use `--image` instead.

For inline code, format with leading spaces and keep it short. LinkedIn collapses long posts.

### 6. Confirm Before Posting

**ALWAYS** show the final post to the user before publishing:

```
─── LinkedIn Post Preview ───────────────────────
[Post text here, exactly as it will appear]
─────────────────────────────────────────────────
Characters: 847 / 3000
Images: 1 (screenshot.png)
─────────────────────────────────────────────────
```

Then ask: **"Post this to LinkedIn?"** with options:

- **Post it** — publish now
- **Edit** — make changes
- **Save draft** — write to a temp file for later
- **Cancel** — discard

Do NOT proceed without explicit user approval.

### 7. Publish

Determine the script path relative to this skill:

```bash
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# Or use the absolute path:
SCRIPT="$CLAUDE_PROJECT_DIR/.claude/skills/linkedin-post/linkedin-post.sh"
```

Based on content type:

**Text only:**

```bash
bash "$SCRIPT" text "$POST_TEXT"
```

**Single image:**

```bash
bash "$SCRIPT" image "$POST_TEXT" "/path/to/image.png"
```

**Multiple images:**

```bash
bash "$SCRIPT" multi-image "$POST_TEXT" "/path/to/img1.png" "/path/to/img2.png"
```

Report the result to the user.

### 8. Summary

```
─── Posted ──────────────────────────────────────
Status:  Published
Content: 847 chars, 1 image
Profile: Alex Cedergren
─────────────────────────────────────────────────
```

## Arguments

- `$ARGUMENTS`: Optional flags:
  - `--setup`: Walk through LinkedIn API OAuth2 setup
  - `--text "content"`: Post specific text (skip drafting)
  - `--file /path/to/post.md`: Read post content from file
  - `--last`: Reuse the last drafted post from this conversation
  - `--image /path/to/image`: Attach an image (can be used multiple times)
  - `--code /path/to/file.ts`: Create a code snippet post
  - `--humanize`: Run `/humanizer` on the draft before confirming
  - `--dry-run`: Draft and preview but don't post
  - If empty: Interactive mode — ask what to post, help draft it

## Setup

When `$ARGUMENTS` contains `--setup`:

### Create a LinkedIn App

1. Go to https://www.linkedin.com/developers/apps
2. Click "Create app"
3. Fill in:
   - App name: "Claude Code Publisher" (or whatever)
   - LinkedIn Page: Your personal page or company page
   - App logo: optional
4. Under **Products**, request access to:
   - **Share on LinkedIn** (gives `w_member_social` scope)
   - **Sign In with LinkedIn using OpenID Connect** (gives `openid`, `profile`, `email`)
5. Under **Auth** tab, note your:
   - Client ID
   - Client Secret

### Get an Access Token

The OAuth2 flow requires a browser redirect. Fastest path:

1. Go to:

   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000/callback&scope=openid%20profile%20email%20w_member_social
   ```

2. Authorize the app. You'll be redirected to `http://localhost:3000/callback?code=AUTH_CODE`

3. Exchange the code for a token:

   ```bash
   curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
     -d "grant_type=authorization_code" \
     -d "code=AUTH_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=http://localhost:3000/callback"
   ```

4. Save the access token:
   ```bash
   export LINKEDIN_ACCESS_TOKEN="your_token_here"
   # Add to ~/.zshrc or ~/.bashrc for persistence
   ```

### Verify Setup

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/linkedin-post/linkedin-post.sh" whoami
```

Should print your name, email, and person URN.

### Token Refresh

LinkedIn access tokens expire after 60 days. When posting fails with 401, re-run the OAuth2 flow above to get a fresh token.

Optionally, save your `LINKEDIN_PERSON_ID` to skip the extra API call on each post:

```bash
export LINKEDIN_PERSON_ID="your_person_id"
```

## Error Recovery

- **401 Unauthorized**: Token expired. Re-run OAuth2 flow or `/linkedin-post --setup`.
- **403 Forbidden**: App doesn't have `w_member_social` scope. Check LinkedIn Developer Console → Products.
- **422 Unprocessable**: Post content issue (too long, invalid image format). Check the error message.
- **429 Rate Limited**: LinkedIn rate limits posting. Wait and retry.

## Examples

- `/linkedin-post` — Interactive: ask what to post, help draft, confirm, publish
- `/linkedin-post --text "Just shipped a new feature..."` — Post specific text
- `/linkedin-post --file ~/drafts/rag-post.md` — Post from file
- `/linkedin-post --humanize` — Draft interactively, run humanizer, confirm, publish
- `/linkedin-post --image ~/screenshots/demo.png` — Interactive draft with image attachment
- `/linkedin-post --code src/lib/server/auth/rbac.ts --humanize` — Code snippet post, humanized
- `/linkedin-post --last` — Re-post the last draft from this conversation
- `/linkedin-post --dry-run` — Draft and preview without posting
- `/linkedin-post --setup` — Walk through OAuth2 configuration
