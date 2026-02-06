/**
 * MCP Server exposing all portal tools for external AI agents.
 *
 * Wraps the tool registry as an MCP (Model Context Protocol) server,
 * allowing tools like Claude Code, Cursor, and other MCP-compatible
 * clients to discover and execute OCI portal tools.
 *
 * Provides:
 * - Tool discovery: all 60+ OCI tools from the registry
 * - Tool execution: delegated to executeTool() from registry
 * - Resource listing: sessions, workflows, search as MCP resources
 * - Auth enforcement: operations require valid auth context
 */

import { getAllToolDefinitions, executeTool } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';
import { createLogger } from '../logger';
import { NotFoundError } from '../errors';
import type { z } from 'zod';

const log = createLogger('mcp-server');

/** MCP Tool representation */
export interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** MCP Resource representation */
export interface MCPResource {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
}

/** Auth context for MCP operations */
export interface MCPAuthContext {
	orgId: string;
	userId: string;
	permissions: string[];
}

/** MCP Tool execution result */
export interface MCPToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Handles the common Zod types used in tool definitions:
 * ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodOptional, ZodDefault, ZodArray.
 *
 * Uses `unknown` casts for Zod internal _def properties since the exact
 * internal type varies between Zod 3/4 and is not part of the public API.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	const def = schema._def as unknown as Record<string, unknown>;
	const typeName = (def?.typeName ?? '') as string;

	switch (typeName) {
		case 'ZodObject': {
			const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [key, value] of Object.entries(shape)) {
				const fieldSchema = value as z.ZodTypeAny;
				properties[key] = zodToJsonSchema(fieldSchema);

				// Field is required if not optional/default
				const fieldDef = fieldSchema._def as unknown as Record<string, unknown>;
				const fieldTypeName = (fieldDef?.typeName ?? '') as string;
				if (fieldTypeName !== 'ZodOptional' && fieldTypeName !== 'ZodDefault') {
					required.push(key);
				}
			}

			return {
				type: 'object',
				properties,
				...(required.length > 0 ? { required } : {})
			};
		}

		case 'ZodString': {
			const result: Record<string, unknown> = { type: 'string' };
			if (def.description) result.description = def.description;
			if (def.checks && Array.isArray(def.checks)) {
				for (const check of def.checks as unknown as Array<{ kind: string; value?: unknown }>) {
					if (check.kind === 'min') result.minLength = check.value;
					if (check.kind === 'max') result.maxLength = check.value;
				}
			}
			return result;
		}

		case 'ZodNumber': {
			const result: Record<string, unknown> = { type: 'number' };
			if (def.description) result.description = def.description;
			return result;
		}

		case 'ZodBoolean':
			return { type: 'boolean', ...(def.description ? { description: def.description } : {}) };

		case 'ZodEnum':
			return {
				type: 'string',
				enum: def.values as string[],
				...(def.description ? { description: def.description } : {})
			};

		case 'ZodOptional':
			return zodToJsonSchema(def.innerType as z.ZodTypeAny);

		case 'ZodDefault':
			return {
				...zodToJsonSchema(def.innerType as z.ZodTypeAny),
				default:
					typeof def.defaultValue === 'function'
						? (def.defaultValue as () => unknown)()
						: def.defaultValue
			};

		case 'ZodArray':
			return {
				type: 'array',
				items: zodToJsonSchema(def.type as z.ZodTypeAny)
			};

		case 'ZodLiteral':
			return { const: def.value };

		default:
			// Fallback: generic object
			return { type: 'object' };
	}
}

/**
 * Convert a ToolDefinition to an MCP Tool.
 */
function toolDefToMCPTool(def: ToolDefinition): MCPTool {
	return {
		name: def.name,
		description: def.description,
		inputSchema: zodToJsonSchema(def.parameters)
	};
}

/**
 * Static MCP resource definitions.
 * These represent the resource types available through the MCP server.
 */
const MCP_RESOURCES: MCPResource[] = [
	{
		uri: 'portal://sessions',
		name: 'Chat Sessions',
		description: 'List and access chat session history',
		mimeType: 'application/json'
	},
	{
		uri: 'portal://workflows',
		name: 'Workflow Definitions',
		description: 'List and access workflow definitions and runs',
		mimeType: 'application/json'
	},
	{
		uri: 'portal://search',
		name: 'Semantic Search',
		description: 'Search across portal data using vector embeddings',
		mimeType: 'application/json'
	}
];

/**
 * Portal MCP Server.
 *
 * Exposes all portal tools as MCP tools and provides resource access
 * for sessions, workflows, and semantic search.
 */
export class PortalMCPServer {
	private tools: MCPTool[];

	constructor() {
		const definitions = getAllToolDefinitions();
		this.tools = definitions.map(toolDefToMCPTool);
		log.info({ toolCount: this.tools.length }, 'PortalMCPServer initialized');
	}

	/**
	 * List all available MCP tools.
	 * Maps every tool from the registry to MCP Tool format.
	 */
	listTools(): MCPTool[] {
		return this.tools;
	}

	/**
	 * Execute a tool by name with the given arguments.
	 *
	 * Delegates to executeTool() from the tool registry.
	 * Auth context can be provided for permission enforcement.
	 */
	async executeTool(
		name: string,
		args: Record<string, unknown>,
		context?: MCPAuthContext
	): Promise<unknown> {
		log.info({ tool: name, orgId: context?.orgId }, 'MCP tool execution');
		return executeTool(name, args);
	}

	/**
	 * List available MCP resources.
	 */
	listResources(): MCPResource[] {
		return MCP_RESOURCES;
	}

	/**
	 * Get a resource by URI.
	 *
	 * Supports:
	 * - portal://sessions - list chat sessions
	 * - portal://workflows - list workflow definitions
	 * - portal://search - semantic search endpoint info
	 */
	async getResource(
		uri: string,
		_context?: MCPAuthContext
	): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
		if (uri === 'portal://sessions') {
			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify({
							type: 'sessions',
							description: 'Use GET /api/v1/sessions to list chat sessions',
							endpoints: {
								list: 'GET /api/sessions',
								get: 'GET /api/sessions/:id'
							}
						})
					}
				]
			};
		}

		if (uri === 'portal://workflows') {
			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify({
							type: 'workflows',
							description: 'Use workflow APIs to manage workflow definitions and runs',
							endpoints: {
								list: 'GET /api/workflows',
								get: 'GET /api/workflows/:id',
								run: 'POST /api/workflows/:id/run'
							}
						})
					}
				]
			};
		}

		if (uri === 'portal://search') {
			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify({
							type: 'search',
							description: 'Semantic search using Oracle 26AI vector embeddings',
							endpoints: {
								search: 'GET /api/v1/search?q=<query>&type=<filter>&limit=<n>'
							}
						})
					}
				]
			};
		}

		throw new NotFoundError(`Unknown MCP resource: ${uri}`, { uri });
	}
}

/**
 * Factory function for creating a PortalMCPServer instance.
 */
export function createPortalMCPServer(): PortalMCPServer {
	return new PortalMCPServer();
}
