/**
 * MCP Manager
 *
 * Manages multiple MCP server connections and aggregates their tools/resources.
 *
 * @deprecated Use @modelcontextprotocol/sdk instead. Will be removed in Phase B.
 */

// DEPRECATED: Use @modelcontextprotocol/sdk instead. Will be removed in Phase B.

import { EventEmitter } from 'events';
import { MCPClient } from './client';
import type {
	MCPClientOptions,
	MCPServerConfig,
	MCPToolDefinition,
	MCPResource,
	MCPPrompt,
	ToolCallResult,
	ResourceReadResult,
	ConnectionState
} from './types';

export interface MCPServerEntry {
	name: string;
	config: MCPServerConfig;
	client: MCPClient;
	state: ConnectionState;
	enabled: boolean;
}

export interface MCPManagerOptions {
	/** Callback when aggregated tools change */
	onToolsChanged?: (tools: MCPToolDefinition[]) => void;

	/** Callback when aggregated resources change */
	onResourcesChanged?: (resources: MCPResource[]) => void;

	/** Callback for logging */
	onLog?: (serverName: string, level: string, message: string, data?: unknown) => void;

	/** Auto-reconnect on disconnect */
	autoReconnect?: boolean;

	/** Reconnect delay in milliseconds */
	reconnectDelay?: number;
}

export class MCPManager extends EventEmitter {
	private servers = new Map<string, MCPServerEntry>();
	private options: MCPManagerOptions;

	constructor(options: MCPManagerOptions = {}) {
		super();
		this.options = {
			autoReconnect: true,
			reconnectDelay: 5000,
			...options
		};
	}

	/**
	 * Add an MCP server
	 */
	addServer(name: string, config: MCPServerConfig): void {
		if (this.servers.has(name)) {
			throw new Error(`Server "${name}" already exists`);
		}

		const clientOptions: MCPClientOptions = {
			server: config,
			clientName: `mcp-manager-${name}`,
			onToolsChanged: () => this.emitAggregatedTools(),
			onResourcesChanged: () => this.emitAggregatedResources(),
			onLog: (level, message, data) => {
				this.options.onLog?.(name, level, message, data);
				this.emit('log', name, level, message, data);
			}
		};

		const client = new MCPClient(clientOptions);

		client.on('stateChange', (state: ConnectionState) => {
			const entry = this.servers.get(name);
			if (entry) {
				entry.state = state;
				this.emit('serverStateChange', name, state);

				// Auto-reconnect on disconnect
				if (state === 'disconnected' && entry.enabled && this.options.autoReconnect) {
					setTimeout(() => {
						if (entry.enabled) {
							this.connectServer(name).catch((e) => {
								this.options.onLog?.(name, 'error', 'Reconnect failed', e);
							});
						}
					}, this.options.reconnectDelay);
				}
			}
		});

		this.servers.set(name, {
			name,
			config,
			client,
			state: 'disconnected',
			enabled: false
		});

		this.emit('serverAdded', name);
	}

	/**
	 * Remove an MCP server
	 */
	async removeServer(name: string): Promise<void> {
		const entry = this.servers.get(name);
		if (!entry) {
			return;
		}

		await entry.client.disconnect();
		this.servers.delete(name);
		this.emit('serverRemoved', name);
		this.emitAggregatedTools();
		this.emitAggregatedResources();
	}

	/**
	 * Connect to a specific server
	 */
	async connectServer(name: string): Promise<void> {
		const entry = this.servers.get(name);
		if (!entry) {
			throw new Error(`Server "${name}" not found`);
		}

		entry.enabled = true;
		await entry.client.connect();
	}

	/**
	 * Disconnect from a specific server
	 */
	async disconnectServer(name: string): Promise<void> {
		const entry = this.servers.get(name);
		if (!entry) {
			throw new Error(`Server "${name}" not found`);
		}

		entry.enabled = false;
		await entry.client.disconnect();
	}

	/**
	 * Connect to all servers
	 */
	async connectAll(): Promise<void> {
		const promises = Array.from(this.servers.keys()).map((name) =>
			this.connectServer(name).catch((error) => {
				this.options.onLog?.(name, 'error', 'Failed to connect', error);
			})
		);

		await Promise.all(promises);
	}

	/**
	 * Disconnect from all servers
	 */
	async disconnectAll(): Promise<void> {
		const promises = Array.from(this.servers.keys()).map((name) =>
			this.disconnectServer(name).catch((error) => {
				this.options.onLog?.(name, 'error', 'Failed to disconnect', error);
			})
		);

		await Promise.all(promises);
	}

	/**
	 * Get all registered servers
	 */
	getServers(): MCPServerEntry[] {
		return Array.from(this.servers.values());
	}

	/**
	 * Get a specific server
	 */
	getServer(name: string): MCPServerEntry | undefined {
		return this.servers.get(name);
	}

	/**
	 * Get all tools from all connected servers
	 */
	getAllTools(): MCPToolDefinition[] {
		const tools: MCPToolDefinition[] = [];

		for (const entry of this.servers.values()) {
			if (entry.state === 'connected') {
				tools.push(...entry.client.getTools());
			}
		}

		return tools;
	}

	/**
	 * Get all resources from all connected servers
	 */
	getAllResources(): MCPResource[] {
		const resources: MCPResource[] = [];

		for (const entry of this.servers.values()) {
			if (entry.state === 'connected') {
				resources.push(...entry.client.getResources());
			}
		}

		return resources;
	}

	/**
	 * Get all prompts from all connected servers
	 */
	getAllPrompts(): MCPPrompt[] {
		const prompts: MCPPrompt[] = [];

		for (const entry of this.servers.values()) {
			if (entry.state === 'connected') {
				prompts.push(...entry.client.getPrompts());
			}
		}

		return prompts;
	}

	/**
	 * Call a tool by name (finds the server that has it)
	 */
	async callTool(toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
		// Find the server that has this tool
		for (const entry of this.servers.values()) {
			if (entry.state !== 'connected') continue;

			const tools = entry.client.getTools();
			if (tools.some((t) => t.name === toolName)) {
				return entry.client.callTool(toolName, args);
			}
		}

		throw new Error(`Tool "${toolName}" not found in any connected server`);
	}

	/**
	 * Read a resource by URI (finds the server that has it)
	 */
	async readResource(uri: string): Promise<ResourceReadResult> {
		// Find the server that has this resource
		for (const entry of this.servers.values()) {
			if (entry.state !== 'connected') continue;

			const resources = entry.client.getResources();
			if (resources.some((r) => r.uri === uri)) {
				return entry.client.readResource(uri);
			}
		}

		throw new Error(`Resource "${uri}" not found in any connected server`);
	}

	/**
	 * Convert all MCP tools to AI SDK format
	 */
	toAISDKTools(): Record<string, unknown> {
		const tools: Record<string, unknown> = {};

		for (const entry of this.servers.values()) {
			if (entry.state === 'connected') {
				Object.assign(tools, entry.client.toAISDKTools());
			}
		}

		return tools;
	}

	// Private methods

	private emitAggregatedTools(): void {
		const tools = this.getAllTools();
		this.options.onToolsChanged?.(tools);
		this.emit('toolsChanged', tools);
	}

	private emitAggregatedResources(): void {
		const resources = this.getAllResources();
		this.options.onResourcesChanged?.(resources);
		this.emit('resourcesChanged', resources);
	}
}
