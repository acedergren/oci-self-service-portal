/**
 * Mastra Fastify plugin — registers agents, memory, tools, vector store,
 * and Mastra framework routes under the /api/mastra prefix.
 *
 * Integrates with the existing Oracle, session, and RBAC plugins
 * by bridging our auth context into Mastra's request context.
 *
 * RAG pipeline: OCI GenAI embeddings (AI SDK) → Oracle 26AI VECTOR storage.
 * Semantic recall enabled — agent gets relevant history from vector search.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { EmbeddingModel } from 'ai';
import type { Mastra } from '@mastra/core';
import { MastraServer } from '@mastra/fastify';
import { createOCI } from '@acedergren/oci-genai-provider';
import { SentryExporter } from '@mastra/sentry';
import { Observability } from '@mastra/observability';
import { OracleVectorStore } from '../mastra/rag/oracle-vector-store.js';
import { createMastra } from '../mastra/index.js';
import { mcpConnectionManager } from '../services/mcp-connection-manager.js';
import { createFindingsRepository } from '../services/findings-repository.js';
import { startCloudAdvisorScheduler } from '../mastra/scheduler.js';

declare module 'fastify' {
	interface FastifyInstance {
		mastra: Mastra;
		vectorStore?: OracleVectorStore;
		ociEmbedder?: EmbeddingModel;
		mcpConnectionManager: typeof mcpConnectionManager;
	}
}

const MASTRA_PREFIX = '/api/mastra';

const mastraPlugin: FastifyPluginAsync = async (fastify) => {
	// ── Oracle availability check ────────────────────────────────────────
	const hasOracle = fastify.hasDecorator('oracle') && fastify.oracle.isAvailable();

	// ── OCI GenAI Embedder (AI SDK interface) ─────────────────────────
	// Uses the native OCI SDK via @acedergren/oci-genai-provider.
	// Cohere embed-english-v3.0: 1024 dimensions, 96 texts/batch.
	const oci = createOCI({ region: process.env.OCI_REGION });
	const ociEmbedder = oci.embeddingModel('cohere.embed-english-v3.0');

	// ── Configure Sentry observability ────────────────────────────────
	// Sentry AI spans: AGENT_RUN, MODEL_GENERATION, TOOL_CALL with OpenTelemetry semantic conventions.
	// Sample rate: 10% in production (controlled via SENTRY_TRACE_SAMPLE_RATE env var).
	const observability = process.env.SENTRY_DSN
		? new Observability({
				configs: {
					sentry: {
						serviceName: 'oci-portal-mastra',
						exporters: [
							new SentryExporter({
								dsn: process.env.SENTRY_DSN,
								environment: process.env.NODE_ENV || 'production',
								tracesSampleRate:
									process.env.SENTRY_TRACE_SAMPLE_RATE !== undefined
										? Number(process.env.SENTRY_TRACE_SAMPLE_RATE)
										: 0.1
							})
						]
					}
				}
			})
		: undefined;

	// ── Build Mastra instance via factory ─────────────────────────────
	const { mastra, tools, vectorStore } = createMastra({
		withConnection: hasOracle ? fastify.oracle.withConnection : undefined,
		ociEmbedder,
		compartmentId: process.env.OCI_COMPARTMENT_ID,
		observability
	});

	// Warn when falling back to in-memory storage (data lost on restart).
	if (!vectorStore) {
		fastify.log.warn(
			{ oracleAvailable: hasOracle },
			'Mastra storage falling back to in-memory — workflow snapshots and conversation memory will not persist across restarts'
		);
	}

	if (!fastify.hasDecorator('mastra')) {
		fastify.decorate('mastra', mastra);
	}

	// Expose vector store and embedder for direct use (e.g., search route)
	if (vectorStore && !fastify.hasDecorator('vectorStore')) {
		fastify.decorate('vectorStore', vectorStore);
	}
	if (!fastify.hasDecorator('ociEmbedder')) {
		fastify.decorate('ociEmbedder', ociEmbedder);
	}

	// ── Decorate with MCP connection manager ───────────────────────────
	if (!fastify.hasDecorator('mcpConnectionManager')) {
		fastify.decorate('mcpConnectionManager', mcpConnectionManager);
	}

	// ── Initialize MCP connection manager (reconnect previously-connected servers)
	if (hasOracle) {
		mcpConnectionManager.initialize().catch((err) => {
			fastify.log.error({ err }, 'Failed to initialize MCP connection manager');
		});
	}

	// ── Create MastraServer and register routes ────────────────────────
	const server = new MastraServer({
		app: fastify,
		mastra,
		prefix: MASTRA_PREFIX,
		tools
	});

	// Auth bridge: inject our session user into Mastra's request context.
	// Runs after Mastra's context middleware (registered in init) but
	// before route handlers via Fastify's hook ordering.
	fastify.addHook('onRequest', async (request) => {
		// Only bridge for Mastra routes
		if (!request.url.startsWith(MASTRA_PREFIX)) return;

		if (request.requestContext && request.user) {
			// Extend Mastra's RequestContext with our auth fields.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ctx = request.requestContext as Record<string, any>;
			ctx.userId = request.user.id;
			ctx.orgId = (request.session as Record<string, unknown>)?.activeOrganizationId ?? null;
		}
	});

	await server.init();

	// ── CloudAdvisor scheduler ─────────────────────────────────────────
	// Start scheduled analyses after Mastra + Oracle are both ready.
	// No-op if CLOUDADVISOR_ENABLED=false or Oracle is unavailable.
	if (hasOracle) {
		const findingsRepo = createFindingsRepository(fastify.oracle.withConnection);
		startCloudAdvisorScheduler({
			mastra,
			findingsRepository: findingsRepo,
			compartmentId: process.env.OCI_COMPARTMENT_ID
		});
	}

	// ── Add cleanup hook for MCP connection manager ────────────────────
	fastify.addHook('onClose', async () => {
		await mcpConnectionManager.shutdown();
	});

	fastify.log.info(
		`Mastra plugin registered: ${Object.keys(tools).length} tools, 1 agent (Charlie), ` +
			`vector=${!!vectorStore}, semanticRecall=${!!vectorStore} at ${MASTRA_PREFIX}`
	);
};

export default fp(mastraPlugin, {
	name: 'mastra',
	fastify: '5.x'
	// No hard dependency on oracle — works without DB in test/dev mode
});
