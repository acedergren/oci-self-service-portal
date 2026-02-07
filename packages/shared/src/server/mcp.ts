/**
 * MCP Service for oci-ai-chat
 *
 * Manages MCP server connections and integrates MCP tools with the AI SDK.
 * This service runs server-side only in SvelteKit.
 */

import { MCPManager, type MCPServerConfig, type MCPToolDefinition, type ToolResultContent, type ResourceContent } from './mcp-client';
import { tool } from 'ai';
import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { createLogger } from './logger';

const log = createLogger('mcp');

const MCP_CONFIG_PATH = join(homedir(), '.oci-genai', 'mcp.json');

/**
 * MCP Configuration file format
 */
export interface MCPConfig {
	servers: Record<string, MCPServerConfigEntry>;
}

export interface MCPServerConfigEntry {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
}

// Singleton MCP manager instance
let mcpManager: MCPManager | null = null;
let initialized = false;

/**
 * Initialize MCP service
 */
export function initMCP(): MCPManager {
	if (mcpManager) {
		return mcpManager;
	}

	mcpManager = new MCPManager({
		autoReconnect: true,
		reconnectDelay: 5000,
		onToolsChanged: (tools: MCPToolDefinition[]) => {
			log.info({ toolCount: tools.length }, 'tools updated');
		},
		onLog: (serverName: string, level: string, message: string, data: unknown) => {
			if (level === 'error') {
				log.error({ server: serverName, data }, message);
			}
		}
	});

	return mcpManager;
}

/**
 * Get the MCP manager instance
 */
export function getMCPManager(): MCPManager | null {
	return mcpManager;
}

/**
 * Load MCP configuration and connect to servers
 */
export async function loadMCPConfig(): Promise<void> {
	if (initialized) {
		return;
	}

	const manager = initMCP();

	// Load configuration file if it exists
	if (existsSync(MCP_CONFIG_PATH)) {
		try {
			const configData = readFileSync(MCP_CONFIG_PATH, 'utf-8');
			const config: MCPConfig = JSON.parse(configData);

			for (const [name, entry] of Object.entries(config.servers)) {
				if (entry.enabled === false) {
					continue;
				}

				const serverConfig = parseServerConfig(entry);
				if (serverConfig) {
					manager.addServer(name, serverConfig);
				}
			}

			// Connect to all enabled servers
			await manager.connectAll();
			initialized = true;
			log.info({ serverCount: manager.getServers().length }, 'connected to servers');
		} catch (error) {
			log.error({ err: error }, 'failed to load configuration');
		}
	} else {
		log.info({ path: MCP_CONFIG_PATH }, 'no configuration file found');
		initialized = true;
	}
}

/**
 * Get all MCP tools in AI SDK format
 */
export function getMCPToolsForAISDK(): Record<string, ReturnType<typeof tool>> {
	const manager = getMCPManager();
	if (!manager) {
		return {};
	}

	return manager.toAISDKTools() as Record<string, ReturnType<typeof tool>>;
}

/**
 * Call an MCP tool
 */
export async function callMCPTool(
	toolName: string,
	args?: Record<string, unknown>
): Promise<string> {
	const manager = getMCPManager();
	if (!manager) {
		throw new Error('MCP manager not initialized');
	}

	const result = await manager.callTool(toolName, args);

	// Extract text content
	const textContents = result.content
		.filter((c: ToolResultContent): c is Extract<ToolResultContent, { type: 'text' }> => c.type === 'text')
		.map((c) => c.text);

	if (result.isError) {
		throw new Error(textContents.join('\n') || 'MCP tool call failed');
	}

	return textContents.join('\n') || JSON.stringify(result);
}

/**
 * Read an MCP resource
 */
export async function readMCPResource(uri: string): Promise<string> {
	const manager = getMCPManager();
	if (!manager) {
		throw new Error('MCP manager not initialized');
	}

	const result = await manager.readResource(uri);

	// Extract text content
	const textContents = result.contents
		.filter((c: ResourceContent): c is ResourceContent & { text: string } => !!c.text)
		.map((c) => c.text);

	return textContents.join('\n');
}

/**
 * Get list of connected MCP servers
 */
export function getMCPServers(): Array<{ name: string; state: string; toolCount: number }> {
	const manager = getMCPManager();
	if (!manager) {
		return [];
	}

	return manager.getServers().map((server: { name: string; state: string; client: { getTools(): unknown[] } }) => ({
		name: server.name,
		state: server.state,
		toolCount: server.client.getTools().length
	}));
}

/**
 * Check if MCP is initialized
 */
export function isMCPInitialized(): boolean {
	return initialized;
}

// Private helpers

function parseServerConfig(entry: MCPServerConfigEntry): MCPServerConfig | null {
	// Stdio transport (local command)
	if (entry.command) {
		return {
			type: 'stdio',
			command: entry.command,
			args: entry.args,
			env: entry.env
		};
	}

	// SSE transport (remote URL)
	if (entry.url) {
		return {
			type: 'sse',
			url: entry.url,
			headers: entry.headers
		};
	}

	return null;
}
