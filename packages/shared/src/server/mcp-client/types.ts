/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Based on the MCP specification for AI tool servers.
 * https://modelcontextprotocol.io/
 */

import { z } from 'zod';

// JSON-RPC 2.0 Types
export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

// MCP Protocol Types

/**
 * Server information returned during initialization
 */
export interface ServerInfo {
	name: string;
	version: string;
	protocolVersion?: string;
}

/**
 * Server capabilities
 */
export interface ServerCapabilities {
	tools?: {
		listChanged?: boolean;
	};
	resources?: {
		subscribe?: boolean;
		listChanged?: boolean;
	};
	prompts?: {
		listChanged?: boolean;
	};
	logging?: Record<string, unknown>;
}

/**
 * Initialize response
 */
export interface InitializeResult {
	serverInfo: ServerInfo;
	capabilities: ServerCapabilities;
	protocolVersion: string;
}

/**
 * MCP Tool definition from server
 */
export interface MCPToolDefinition {
	name: string;
	description?: string;
	inputSchema: {
		type: 'object';
		properties?: Record<string, JsonSchema>;
		required?: string[];
	};
}

/**
 * JSON Schema for tool parameters
 */
export interface JsonSchema {
	type: string;
	description?: string;
	enum?: string[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	default?: unknown;
}

/**
 * Tool call request
 */
export interface ToolCallRequest {
	name: string;
	arguments?: Record<string, unknown>;
}

/**
 * Tool call result content types
 */
export type ToolResultContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'resource'; resource: ResourceContent };

/**
 * Tool call result
 */
export interface ToolCallResult {
	content: ToolResultContent[];
	isError?: boolean;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

/**
 * Resource content
 */
export interface ResourceContent {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
}

/**
 * Resource read result
 */
export interface ResourceReadResult {
	contents: ResourceContent[];
}

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
	name: string;
	description?: string;
	arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
	name: string;
	description?: string;
	required?: boolean;
}

/**
 * Prompt message
 */
export interface PromptMessage {
	role: 'user' | 'assistant';
	content: PromptContent;
}

export type PromptContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'resource'; resource: ResourceContent };

/**
 * Get prompt result
 */
export interface GetPromptResult {
	description?: string;
	messages: PromptMessage[];
}

// Transport Types

/**
 * Transport interface for MCP communication
 */
export interface MCPTransport {
	/** Start the transport connection */
	start(): Promise<void>;

	/** Stop the transport connection */
	stop(): Promise<void>;

	/** Send a request and wait for response */
	request<T>(method: string, params?: Record<string, unknown>): Promise<T>;

	/** Send a notification (no response expected) */
	notify(method: string, params?: Record<string, unknown>): Promise<void>;

	/** Register a handler for incoming notifications */
	onNotification(handler: (method: string, params?: Record<string, unknown>) => void): void;

	/** Check if transport is connected */
	isConnected(): boolean;
}

// Server Configuration Types

/**
 * Stdio server configuration
 */
export interface StdioServerConfig {
	type: 'stdio';
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

/**
 * SSE (Server-Sent Events) server configuration
 */
export interface SSEServerConfig {
	type: 'sse';
	url: string;
	headers?: Record<string, string>;
}

/**
 * HTTP server configuration (for HTTP+SSE transport)
 */
export interface HTTPServerConfig {
	type: 'http';
	baseUrl: string;
	headers?: Record<string, string>;
}

/**
 * Union of all server config types
 */
export type MCPServerConfig = StdioServerConfig | SSEServerConfig | HTTPServerConfig;

// Client Types

/**
 * MCP Client options
 */
export interface MCPClientOptions {
	/** Server configuration */
	server: MCPServerConfig;

	/** Client name for identification */
	clientName?: string;

	/** Client version */
	clientVersion?: string;

	/** Request timeout in milliseconds */
	timeout?: number;

	/** Callback when tools list changes */
	onToolsChanged?: (tools: MCPToolDefinition[]) => void;

	/** Callback when resources list changes */
	onResourcesChanged?: (resources: MCPResource[]) => void;

	/** Callback for logging */
	onLog?: (level: string, message: string, data?: unknown) => void;
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// Zod Schemas for validation

export const ToolCallResultSchema = z.object({
	content: z.array(
		z.union([
			z.object({ type: z.literal('text'), text: z.string() }),
			z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
			z.object({
				type: z.literal('resource'),
				resource: z.object({
					uri: z.string(),
					mimeType: z.string().optional(),
					text: z.string().optional(),
					blob: z.string().optional()
				})
			})
		])
	),
	isError: z.boolean().optional()
});

export const MCPToolDefinitionSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	inputSchema: z.object({
		type: z.literal('object'),
		properties: z.record(z.string(), z.unknown()).optional(),
		required: z.array(z.string()).optional()
	})
});

export const InitializeResultSchema = z.object({
	serverInfo: z.object({
		name: z.string(),
		version: z.string(),
		protocolVersion: z.string().optional()
	}),
	capabilities: z.object({
		tools: z.object({ listChanged: z.boolean().optional() }).optional(),
		resources: z
			.object({
				subscribe: z.boolean().optional(),
				listChanged: z.boolean().optional()
			})
			.optional(),
		prompts: z.object({ listChanged: z.boolean().optional() }).optional(),
		logging: z.record(z.string(), z.unknown()).optional()
	}),
	protocolVersion: z.string()
});
