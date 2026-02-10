/**
 * MCP Client Library
 *
 * Provides client functionality for connecting to MCP (Model Context Protocol) servers.
 *
 * @deprecated Use @modelcontextprotocol/sdk instead. Will be removed in Phase B.
 */

// DEPRECATED: Use @modelcontextprotocol/sdk instead. Will be removed in Phase B.

/**
 * @deprecated Use @modelcontextprotocol/sdk Client instead. Will be removed in Phase B.
 */
export { MCPClient } from './client';

/**
 * @deprecated Use @modelcontextprotocol/sdk instead. Will be removed in Phase B.
 */
export { MCPManager, type MCPServerEntry, type MCPManagerOptions } from './manager';

// Transport exports
export { StdioTransport } from './transports/stdio';
export { SSETransport } from './transports/sse';

// Type exports
export type {
	// JSON-RPC types
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcError,
	JsonRpcNotification,

	// MCP types
	ServerInfo,
	ServerCapabilities,
	InitializeResult,
	MCPToolDefinition,
	JsonSchema,
	ToolCallRequest,
	ToolResultContent,
	ToolCallResult,
	MCPResource,
	ResourceContent,
	ResourceReadResult,
	MCPPrompt,
	MCPPromptArgument,
	PromptMessage,
	PromptContent,
	GetPromptResult,

	// Transport types
	MCPTransport,
	StdioServerConfig,
	SSEServerConfig,
	HTTPServerConfig,
	MCPServerConfig,

	// Client types
	MCPClientOptions,
	ConnectionState
} from './types';

// Schema exports for validation
export { ToolCallResultSchema, MCPToolDefinitionSchema, InitializeResultSchema } from './types';
