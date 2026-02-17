/**
 * MCP Server exposing all portal tools for external AI agents.
 *
 * Wraps the tool registry as an MCP (Model Context Protocol) server,
 * allowing tools like Claude Code, Cursor, and other MCP-compatible
 * clients to discover and execute OCI portal tools.
 *
 * Migrated from apps/frontend in Phase 9.7.
 */

import { getAllToolDefinitions, executeTool } from '../tools/registry.js';
import type { ToolDefinition } from '../tools/types.js';
import { AuthError, NotFoundError } from '@portal/types';
import { z } from 'zod';

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

/**
 * Convert a Zod schema to JSON Schema using Zod 4's built-in converter.
 *
 * Removes the $schema key since MCP embeds schemas inline rather than
 * referencing external schema definitions.
 */
function toJsonSchemaForMCP(schema: z.ZodTypeAny): Record<string, unknown> {
	try {
		const jsonSchema = z.toJSONSchema(schema);
		// Remove the $schema key since MCP embeds schemas inline
		const { $schema: _$schema, ...rest } = jsonSchema as Record<string, unknown>;
		return rest;
	} catch {
		// Fallback to generic object schema if conversion fails
		return { type: 'object', additionalProperties: true };
	}
}

/** Convert a ToolDefinition to an MCP Tool. */
function toolDefToMCPTool(def: ToolDefinition): MCPTool {
	return {
		name: def.name,
		description: def.description,
		inputSchema: toJsonSchemaForMCP(def.parameters)
	};
}

/** Static MCP resource definitions. */
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
	}

	/** List all available MCP tools. */
	listTools(): MCPTool[] {
		return this.tools;
	}

	/**
	 * Execute a tool by name with the given arguments.
	 * Auth context is REQUIRED — checks for tools:execute permission.
	 */
	async executeTool(
		name: string,
		args: Record<string, unknown>,
		context?: MCPAuthContext
	): Promise<unknown> {
		if (!context?.permissions) {
			throw new AuthError('MCP authentication required', 401, { tool: name });
		}

		if (!context.permissions.includes('tools:execute')) {
			throw new AuthError('Insufficient permissions for tool execution', 403, {
				tool: name,
				required: 'tools:execute'
			});
		}

		return executeTool(name, args);
	}

	/** List available MCP resources. */
	listResources(): MCPResource[] {
		return MCP_RESOURCES;
	}

	/** Get a resource by URI. */
	async getResource(
		uri: string,
		_context?: MCPAuthContext
	): Promise<{
		contents: Array<{ uri: string; mimeType: string; text: string }>;
	}> {
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

/** Factory function for creating a PortalMCPServer instance. */
export function createPortalMCPServer(): PortalMCPServer {
	return new PortalMCPServer();
}
