/**
 * MCP Client
 *
 * High-level client for connecting to MCP servers and managing tools/resources.
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import type {
  MCPClientOptions,
  MCPTransport,
  MCPServerConfig,
  MCPToolDefinition,
  MCPResource,
  MCPPrompt,
  ToolCallResult,
  ResourceReadResult,
  GetPromptResult,
  ConnectionState,
  InitializeResult,
} from './types.js';
import { InitializeResultSchema } from './types.js';
import { StdioTransport } from './transports/stdio.js';
import { SSETransport } from './transports/sse.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export class MCPClient extends EventEmitter {
  private options: MCPClientOptions;
  private transport: MCPTransport | null = null;
  private state: ConnectionState = 'disconnected';
  private serverInfo: InitializeResult['serverInfo'] | null = null;
  private capabilities: InitializeResult['capabilities'] | null = null;

  // Cached data
  private tools: MCPToolDefinition[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];

  constructor(options: MCPClientOptions) {
    super();
    this.options = {
      clientName: 'mcp-client',
      clientVersion: '1.0.0',
      timeout: 30000,
      ...options,
    };
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected') {
      return;
    }

    this.state = 'connecting';
    this.emit('stateChange', this.state);

    try {
      // Create transport based on config type
      this.transport = this.createTransport(this.options.server);

      // Set up notification handler
      this.transport.onNotification((method, params) => {
        this.handleNotification(method, params);
      });

      // Start transport
      await this.transport.start();

      // Initialize protocol
      await this.initialize();

      // Fetch initial data
      await this.refreshTools();
      await this.refreshResources();
      await this.refreshPrompts();

      this.state = 'connected';
      this.emit('stateChange', this.state);
      this.emit('connected', this.serverInfo);

    } catch (error) {
      this.state = 'error';
      this.emit('stateChange', this.state);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }

    this.state = 'disconnected';
    this.serverInfo = null;
    this.capabilities = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];

    this.emit('stateChange', this.state);
    this.emit('disconnected');
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get server information
   */
  getServerInfo(): InitializeResult['serverInfo'] | null {
    return this.serverInfo;
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): InitializeResult['capabilities'] | null {
    return this.capabilities;
  }

  /**
   * Get available tools
   */
  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  /**
   * Get available resources
   */
  getResources(): MCPResource[] {
    return [...this.resources];
  }

  /**
   * Get available prompts
   */
  getPrompts(): MCPPrompt[] {
    return [...this.prompts];
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    this.ensureConnected();

    const result = await this.transport!.request<ToolCallResult>('tools/call', {
      name,
      arguments: args,
    });

    return result;
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<ResourceReadResult> {
    this.ensureConnected();

    const result = await this.transport!.request<ResourceReadResult>('resources/read', {
      uri,
    });

    return result;
  }

  /**
   * Get a prompt with arguments
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    this.ensureConnected();

    const result = await this.transport!.request<GetPromptResult>('prompts/get', {
      name,
      arguments: args,
    });

    return result;
  }

  /**
   * Refresh tools list from server
   */
  async refreshTools(): Promise<MCPToolDefinition[]> {
    this.ensureConnected();

    if (!this.capabilities?.tools) {
      this.tools = [];
      return this.tools;
    }

    const result = await this.transport!.request<{ tools: MCPToolDefinition[] }>('tools/list');
    this.tools = result.tools || [];
    this.options.onToolsChanged?.(this.tools);
    this.emit('toolsChanged', this.tools);

    return this.tools;
  }

  /**
   * Refresh resources list from server
   */
  async refreshResources(): Promise<MCPResource[]> {
    this.ensureConnected();

    if (!this.capabilities?.resources) {
      this.resources = [];
      return this.resources;
    }

    const result = await this.transport!.request<{ resources: MCPResource[] }>('resources/list');
    this.resources = result.resources || [];
    this.options.onResourcesChanged?.(this.resources);
    this.emit('resourcesChanged', this.resources);

    return this.resources;
  }

  /**
   * Refresh prompts list from server
   */
  async refreshPrompts(): Promise<MCPPrompt[]> {
    this.ensureConnected();

    if (!this.capabilities?.prompts) {
      this.prompts = [];
      return this.prompts;
    }

    const result = await this.transport!.request<{ prompts: MCPPrompt[] }>('prompts/list');
    this.prompts = result.prompts || [];
    this.emit('promptsChanged', this.prompts);

    return this.prompts;
  }

  /**
   * Subscribe to resource updates
   */
  async subscribeResource(uri: string): Promise<void> {
    this.ensureConnected();

    if (!this.capabilities?.resources?.subscribe) {
      throw new Error('Server does not support resource subscriptions');
    }

    await this.transport!.request('resources/subscribe', { uri });
  }

  /**
   * Unsubscribe from resource updates
   */
  async unsubscribeResource(uri: string): Promise<void> {
    this.ensureConnected();

    if (!this.capabilities?.resources?.subscribe) {
      throw new Error('Server does not support resource subscriptions');
    }

    await this.transport!.request('resources/unsubscribe', { uri });
  }

  /**
   * Convert MCP tools to AI SDK format
   */
  toAISDKTools(): Record<string, unknown> {
    const tools: Record<string, unknown> = {};

    for (const tool of this.tools) {
      tools[tool.name] = {
        description: tool.description,
        parameters: this.jsonSchemaToZod(tool.inputSchema),
        execute: async (args: Record<string, unknown>) => {
          const result = await this.callTool(tool.name, args);
          // Extract text content from result
          const textContents = result.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { type: 'text'; text: string }).text);
          return textContents.join('\n') || JSON.stringify(result);
        },
      };
    }

    return tools;
  }

  // Private methods

  private createTransport(config: MCPServerConfig): MCPTransport {
    switch (config.type) {
      case 'stdio':
        return new StdioTransport(config, this.options.timeout);
      case 'sse':
        return new SSETransport(config, this.options.timeout);
      case 'http':
        // HTTP transport could be implemented as needed
        throw new Error('HTTP transport not yet implemented');
      default:
        throw new Error(`Unknown transport type: ${(config as { type: string }).type}`);
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.transport!.request<InitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
    });

    // Validate response
    const validated = InitializeResultSchema.parse(result);

    this.serverInfo = validated.serverInfo;
    this.capabilities = validated.capabilities;

    // Send initialized notification
    await this.transport!.notify('notifications/initialized');

    this.log('info', `Connected to ${this.serverInfo.name} v${this.serverInfo.version}`);
  }

  private handleNotification(method: string, params?: Record<string, unknown>): void {
    this.log('debug', `Notification: ${method}`, params);

    switch (method) {
      case 'notifications/tools/list_changed':
        this.refreshTools().catch((e) => this.log('error', 'Failed to refresh tools', e));
        break;

      case 'notifications/resources/list_changed':
        this.refreshResources().catch((e) => this.log('error', 'Failed to refresh resources', e));
        break;

      case 'notifications/prompts/list_changed':
        this.refreshPrompts().catch((e) => this.log('error', 'Failed to refresh prompts', e));
        break;

      case 'notifications/resources/updated':
        this.emit('resourceUpdated', params?.uri);
        break;

      default:
        this.emit('notification', method, params);
    }
  }

  private ensureConnected(): void {
    if (this.state !== 'connected' || !this.transport?.isConnected()) {
      throw new Error('Not connected to MCP server');
    }
  }

  private log(level: string, message: string, data?: unknown): void {
    this.options.onLog?.(level, message, data);
    this.emit('log', level, message, data);
  }

  /**
   * Convert JSON Schema to Zod schema (simplified version)
   */
  private jsonSchemaToZod(schema: MCPToolDefinition['inputSchema']): z.ZodTypeAny {
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);

    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
      let zodType = this.jsonSchemaPropertyToZod(prop as { type: string; description?: string });

      if (!required.has(key)) {
        zodType = zodType.optional();
      }

      shape[key] = zodType;
    }

    return z.object(shape);
  }

  private jsonSchemaPropertyToZod(prop: { type: string; description?: string; enum?: string[]; items?: unknown }): z.ZodTypeAny {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = prop.enum
          ? z.enum(prop.enum as [string, ...string[]])
          : z.string();
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(
          prop.items
            ? this.jsonSchemaPropertyToZod(prop.items as { type: string })
            : z.unknown()
        );
        break;
      case 'object':
        zodType = z.record(z.unknown());
        break;
      default:
        zodType = z.unknown();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    return zodType;
  }
}
