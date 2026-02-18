# Serena MCP Integration

Serena exposes an MCP server that feeds semantic code navigation tools (e.g., `find_symbol`, `insert_after_symbol`) into Claude/Serena-aware workflows. Wire it up once so every developer in this repo can rely on the same MCP entry.

## 1. Install Serena (via `uvx`)

```bash
# install `uv` if missing
curl -fsSL https://get.uv.ai | bash

# install Serena (only needs to be done once per machine)
uvx --from git+https://github.com/oraios/serena serena --version
```

## 2. Start the Serena MCP server (run before using Claude/Serena tooling)

```bash
uvx --from git+https://github.com/oraios/serena serena start-mcp-server --port 41045
```

> Feel free to change `--port` if `41045` is in use; remember the value for the next step.

## 3. Register Serena in your MCP client

Add the following JSON blob to your local MCP config (Claude uses `~/.claude/mcp.json`, OpenCode uses `~/.opencode/mcp.json`, and Oracle CLI stacks read `~/.oci-genai/mcp.json`). If you already have a file, merge the snippet into `mcpServers`.

```json
{
	"mcpServers": {
		"serena": {
			"url": "http://localhost:41045/api/mcp",
			"description": "Serena semantic code navigation tools",
			"enabled": true
		}
	}
}
```

Replace the `url` if you ran the server on a different port or behind a proxy. The `description` field is optional but helpful for identifying the server in the UI.

## 4. Confirm it works

Open your Claude or OpenCode client, invoke the `serena` tool, and run `find_symbol` or `insert_after_symbol`. The first tool call may take a few extra seconds as Serena warms up.

If you see errors, double-check:

- The MCP server is still running and accessible at the URL you registered.
- Your client is pointed at the same `mcp.json` file you updated.
- Any local firewall or proxy is allowing traffic to the chosen port.

Once wired up, Serena will stay connected to every session served from this repo, making symbol-level navigation and editing tools available to the agent team.
