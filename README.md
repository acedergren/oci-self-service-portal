# OCI Self-Service Portal

Production-ready SvelteKit chat application with OCI Generative AI, tool calling, RBAC, and Oracle Database integration.

## Features

### Core
- **Streaming Chat** - Real-time AI responses with Vercel AI SDK
- **30+ Models** - Meta Llama, Cohere Command, Google Gemini, xAI Grok
- **60+ OCI Tools** - Compute, networking, database, storage, security, observability
- **Tool Calling** - AI can execute OCI CLI commands with approval workflow
- **Session Persistence** - Oracle ADB 26AI or SQLite fallback

### Security (Phase 3-4)
- **Better Auth + OIDC** - OCI IAM Identity Domains integration
- **RBAC** - 3 roles (viewer/operator/admin), 10 permissions
- **Multi-tenancy** - Compartment isolation
- **Rate Limiting** - DB-backed, atomic MERGE INTO pattern
- **Request Tracing** - `req-{uuid}` propagated via headers
- **Approval Tokens** - Server-side, single-use, 5-min expiry
- **CSP & Security Headers** - HSTS, X-Frame-Options, etc.

### UI (Phase 5)
- **17 Portal Components** - Decomposed from 2042-line monolith
- **shadcn-svelte** - Modern UI primitives with bits-ui + Svelte 5
- **Activity Feed** - Real-time tool execution logs
- **Mobile Responsive** - Works on all device sizes

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- OCI CLI configured (`~/.oci/config`)
- Optional: Oracle Autonomous Database 26AI (falls back to SQLite)

### Installation

```bash
git clone https://github.com/acedergren/oci-self-service-portal.git
cd oci-self-service-portal
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your OCI settings

pnpm dev
```

Open http://localhost:5173

## Documentation

See the [docs](docs/) directory for detailed documentation:
- [ROADMAP.md](docs/ROADMAP.md) - Development progress
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development setup

## Roadmap

- ✅ **Phase 1:** Foundation (adapter-node, Docker, CI)
- ✅ **Phase 2:** Oracle ADB 26AI integration
- ✅ **Phase 3:** Better Auth + OIDC + RBAC
- ✅ **Phase 4:** Security hardening (rate limiting, tracing, approval tokens)
- ✅ **Phase 5:** Portal decomposition (17 components, shadcn-svelte)
- 🚧 **Phase 6:** Observability (OpenTelemetry, metrics, logs)
- 📋 **Phase 7:** Performance (caching, query optimization)
- 📋 **Phase 8:** Advanced features (file uploads, embeddings, RAG)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Alexander Cedergren <alexander.cedergren@oracle.com>

## Related Projects

- [oci-genai-provider](https://github.com/acedergren/oci-genai-provider) - OCI GenAI provider for Vercel AI SDK
- [oci-genai-examples](https://github.com/acedergren/oci-genai-examples) - OCI GenAI examples monorepo (original home)
