/**
 * Mastra application factory.
 *
 * Encapsulates Mastra instance construction (storage, memory, agents, tools)
 * separately from Fastify-specific wiring (MastraServer, hooks, decorators).
 *
 * Benefits:
 * - Testable without a running Fastify instance
 * - Single place to change Mastra construction logic
 * - Clear separation: factory builds, plugin wires
 */

import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import type { EmbeddingModel } from 'ai';
import type { Observability } from '@mastra/observability';
import type { OracleConnection } from '@portal/server/oracle/connection';
import { OracleStore } from './storage/oracle-store.js';
import { OracleVectorStore } from './rag/oracle-vector-store.js';
import { buildMastraTools } from './tools/registry.js';
import { createCharlieAgent, DEFAULT_MODEL } from './agents/charlie.js';
import { actionWorkflow } from './workflows/action-workflow.js';
import { classifyIntentWorkflow } from './workflows/charlie/classify-intent.js';
import { queryWorkflow } from './workflows/charlie/query.js';
import { charlieActionWorkflow } from './workflows/charlie/action.js';
import { correctWorkflow } from './workflows/charlie/correct.js';

type WithConnectionFn = <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;

export interface MastraConfig {
	/**
	 * Oracle withConnection callback from the oracle Fastify plugin.
	 * Omit (or pass undefined) for in-memory mode — storage will not persist.
	 */
	withConnection?: WithConnectionFn;
	/** OCI GenAI embedding model for semantic recall. */
	ociEmbedder: EmbeddingModel;
	/** OCI compartment OCID for tool calls that require it. */
	compartmentId?: string;
	/** Pre-configured Observability instance (Sentry, OTel, etc.) */
	observability?: Observability;
}

export interface MastraBundle {
	mastra: Mastra;
	tools: ReturnType<typeof buildMastraTools>;
	vectorStore: OracleVectorStore | undefined;
	memory: Memory;
}

/**
 * Build a fully-configured Mastra instance from config.
 *
 * Constructs storage, vector store, memory, Charlie agent, and the Mastra
 * instance itself. Does NOT create MastraServer or add Fastify hooks — that
 * is the plugin's responsibility.
 */
export function createMastra(config: MastraConfig): MastraBundle {
	const { withConnection, ociEmbedder, compartmentId, observability } = config;

	const storage = withConnection
		? new OracleStore({ withConnection, disableInit: true })
		: undefined;

	const vectorStore = withConnection ? new OracleVectorStore({ withConnection }) : undefined;

	const tools = buildMastraTools();

	const memory = new Memory({
		storage,
		vector: vectorStore,
		embedder: ociEmbedder,
		options: {
			lastMessages: 40,
			workingMemory: { enabled: true },
			semanticRecall: vectorStore
				? { topK: 3, messageRange: { before: 2, after: 1 }, scope: 'resource' }
				: false
		}
	});

	const charlie = createCharlieAgent({ model: DEFAULT_MODEL, memory, compartmentId });

	const mastra = new Mastra({
		agents: { charlie },
		tools,
		storage,
		memory: { charlie: memory },
		observability,
		workflows: {
			actionWorkflow,
			classifyIntentWorkflow,
			queryWorkflow,
			charlieActionWorkflow,
			correctWorkflow
		}
	});

	return { mastra, tools, vectorStore, memory };
}
