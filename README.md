# OCI AI Chat

Production-ready SvelteKit chat application with OCI GenAI, tool calling, MCP support, and session persistence.

## Features

- **Streaming Chat** - Real-time streaming responses with AI SDK
- **Model Selection** - 30+ models from Meta, Cohere, Google, xAI
- **OCI Tools** - Built-in tools for managing OCI resources
- **MCP Integration** - Connect external tool servers
- **Session Persistence** - SQLite-based conversation history
- **Reasoning Display** - Show model thinking process
- **Mobile Responsive** - Works on all device sizes
- **Security Hardened** - CSP, rate limiting, secure headers

## Prerequisites

- Node.js 18+
- pnpm 8+
- OCI CLI configured (`~/.oci/config`)

## Quick Start

```bash
cd oci-ai-chat
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your OCI settings

pnpm dev
```

Open http://localhost:5173

## Configuration

### Environment Variables

```bash
OCI_REGION=us-chicago-1
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..xxxxx
```

### MCP Servers

Configure in `~/.oci-genai/mcp.json`:

```json
{
	"servers": {
		"filesystem": {
			"command": "npx",
			"args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
		}
	}
}
```

## Architecture

```
oci-ai-chat/
├── src/
│   ├── routes/
│   │   ├── +page.svelte      # Main chat UI
│   │   └── api/
│   │       ├── chat/         # Streaming chat endpoint
│   │       ├── models/       # Available models
│   │       ├── mcp/          # MCP server status
│   │       └── sessions/     # Session management
│   ├── lib/
│   │   ├── components/       # Svelte components
│   │   ├── server/           # Server-side services
│   │   └── tools/            # OCI tool definitions
│   └── hooks.server.ts       # Security middleware
└── package.json
```

## API Endpoints

| Endpoint             | Method     | Description            |
| -------------------- | ---------- | ---------------------- |
| `/api/chat`          | POST       | Stream chat completion |
| `/api/models`        | GET        | List available models  |
| `/api/mcp`           | GET        | MCP server status      |
| `/api/sessions`      | GET/POST   | List/create sessions   |
| `/api/sessions/[id]` | GET/DELETE | Get/delete session     |

## Security Features

- Content Security Policy (CSP)
- Rate limiting (20 req/min for chat, 60 req/min for API)
- Secure HTTP headers (HSTS, X-Frame-Options, etc.)
- Input validation with Zod

## Development

```bash
# Type check
pnpm check

# Run tests
pnpm test

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## License

MIT
