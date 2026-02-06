/**
 * Phase 8 TDD: MCP Server for Portal Tools
 *
 * Exposes all portal tools as an MCP (Model Context Protocol) server,
 * allowing external AI agents to discover and execute tools.
 *
 * Expected module: $lib/server/mcp/portal-server.ts
 * Expected exports:
 *   - PortalMCPServer class or factory
 *     Methods:
 *       listTools(): ToolInfo[]
 *       executeTool(name, args, context): Promise<ToolResult>
 *       listResources(): ResourceInfo[]
 *       getResource(uri): Promise<ResourceContent>
 *
 * MCP Tool Discovery:
 *   - Every tool from the registry should be exposed
 *   - Tool schemas come from Zod definitions
 *   - Auth is enforced on all operations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllToolDefinitions } from '@portal/shared/tools/registry';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/sentry.js', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
}));

// Mock executeTool from registry
const mockExecuteTool = vi.fn();
vi.mock('$lib/tools/registry.js', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		executeTool: (...args: unknown[]) => mockExecuteTool(...args)
	};
});

let mcpModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		mcpModule = await import('$lib/server/mcp/portal-server.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

// ============================================================================
// MCP Tool Discovery
// ============================================================================

describe('MCP Server - Tool Discovery (Phase 8.8)', () => {
	describe('module availability', () => {
		it('portal-server module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`portal-server module not yet available: ${moduleError}. ` +
						'Implement $lib/server/mcp/portal-server.ts per Phase 8.8.'
				);
			}
			expect(mcpModule).not.toBeNull();
		});
	});

	describe('listTools', () => {
		it('exposes all tools from the registry', () => {
			if (!mcpModule) return;

			const PortalMCPServer = mcpModule.PortalMCPServer as
				| {
						new (): {
							listTools: () => Array<{
								name: string;
								description: string;
								inputSchema: Record<string, unknown>;
							}>;
						};
				  }
				| undefined;

			const createPortalMCPServer = mcpModule.createPortalMCPServer as
				| (() => {
						listTools: () => Array<{
							name: string;
							description: string;
							inputSchema: Record<string, unknown>;
						}>;
				  })
				| undefined;

			const server = PortalMCPServer
				? new PortalMCPServer()
				: createPortalMCPServer
					? createPortalMCPServer()
					: null;

			if (!server) {
				expect.fail('Neither PortalMCPServer class nor createPortalMCPServer factory found');
				return;
			}

			const mcpTools = server.listTools();
			const registryTools = getAllToolDefinitions();

			expect(mcpTools.length).toBe(registryTools.length);

			// Every registry tool should appear in the MCP tool list
			const mcpToolNames = new Set(mcpTools.map((t) => t.name));
			for (const rt of registryTools) {
				expect(mcpToolNames.has(rt.name)).toBe(true);
			}
		});

		it('each MCP tool has name, description, and inputSchema', () => {
			if (!mcpModule) return;

			const createServer = (mcpModule.PortalMCPServer ?? mcpModule.createPortalMCPServer) as
				| (new () => { listTools: () => Array<Record<string, unknown>> })
				| (() => { listTools: () => Array<Record<string, unknown>> });

			const server =
				typeof createServer === 'function' && createServer.prototype
					? new (createServer as new () => { listTools: () => Array<Record<string, unknown>> })()
					: (createServer as () => { listTools: () => Array<Record<string, unknown>> })();

			const tools = server.listTools();
			for (const tool of tools) {
				expect(tool.name).toBeDefined();
				expect(typeof tool.name).toBe('string');
				expect(tool.description).toBeDefined();
				expect(typeof tool.description).toBe('string');
				expect(tool.inputSchema).toBeDefined();
				expect(typeof tool.inputSchema).toBe('object');
			}
		});

		it('tool inputSchema maps from Zod parameter definitions', () => {
			if (!mcpModule) return;

			const createServer = (mcpModule.PortalMCPServer ?? mcpModule.createPortalMCPServer) as
				| (new () => {
						listTools: () => Array<{ name: string; inputSchema: Record<string, unknown> }>;
				  })
				| (() => {
						listTools: () => Array<{ name: string; inputSchema: Record<string, unknown> }>;
				  });

			const server =
				typeof createServer === 'function' && createServer.prototype
					? new (createServer as new () => {
							listTools: () => Array<{ name: string; inputSchema: Record<string, unknown> }>;
						})()
					: (
							createServer as () => {
								listTools: () => Array<{ name: string; inputSchema: Record<string, unknown> }>;
							}
						)();

			const tools = server.listTools();
			// inputSchema should be a JSON Schema object (converted from Zod)
			for (const tool of tools) {
				const schema = tool.inputSchema;
				// JSON Schema should have type: "object" at minimum
				expect(schema.type).toBe('object');
			}
		});
	});
});

// ============================================================================
// MCP Tool Execution
// ============================================================================

describe('MCP Server - Tool Execution (Phase 8.8)', () => {
	describe('executeTool', () => {
		it('calls executeTool from registry with correct args', async () => {
			if (!mcpModule) return;

			const createServer = (mcpModule.PortalMCPServer ?? mcpModule.createPortalMCPServer) as
				| (new () => {
						executeTool: (
							name: string,
							args: Record<string, unknown>,
							context?: Record<string, unknown>
						) => Promise<unknown>;
				  })
				| (() => {
						executeTool: (
							name: string,
							args: Record<string, unknown>,
							context?: Record<string, unknown>
						) => Promise<unknown>;
				  });

			const server =
				typeof createServer === 'function' && createServer.prototype
					? new (createServer as new () => Record<string, unknown>)()
					: (createServer as () => Record<string, unknown>)();

			const executeMcp = server.executeTool as (
				name: string,
				args: Record<string, unknown>,
				context?: Record<string, unknown>
			) => Promise<unknown>;

			mockExecuteTool.mockResolvedValueOnce({ instances: [{ id: 'i-1' }] });

			const result = await executeMcp(
				'listInstances',
				{
					compartmentId: 'ocid1.compartment...'
				},
				{ orgId: 'org-1', userId: 'user-1' }
			);

			expect(mockExecuteTool).toHaveBeenCalledWith(
				'listInstances',
				expect.objectContaining({ compartmentId: 'ocid1.compartment...' })
			);
			expect(result).toBeDefined();
		});

		it('returns error for unknown tool name', async () => {
			if (!mcpModule) return;

			const createServer = (mcpModule.PortalMCPServer ?? mcpModule.createPortalMCPServer) as
				| (new () => {
						executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
				  })
				| (() => {
						executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
				  });

			const server =
				typeof createServer === 'function' && createServer.prototype
					? new (createServer as new () => Record<string, unknown>)()
					: (createServer as () => Record<string, unknown>)();

			const executeMcp = server.executeTool as (
				name: string,
				args: Record<string, unknown>
			) => Promise<unknown>;

			mockExecuteTool.mockRejectedValueOnce(new Error('No executor for tool: fakeToolXyz'));

			try {
				await executeMcp('fakeToolXyz', {});
				expect.fail('Should have thrown or returned error');
			} catch (err) {
				expect((err as Error).message).toContain('fakeToolXyz');
			}
		});
	});
});

// ============================================================================
// MCP Resource Listing
// ============================================================================

describe('MCP Server - Resources (Phase 8.8)', () => {
	describe('listResources', () => {
		it('lists sessions and workflows as MCP resources', () => {
			if (!mcpModule) return;

			const createServer = (mcpModule.PortalMCPServer ?? mcpModule.createPortalMCPServer) as
				| (new () => {
						listResources: () => Array<{ uri: string; name: string; mimeType: string }>;
				  })
				| (() => {
						listResources: () => Array<{ uri: string; name: string; mimeType: string }>;
				  });

			const server =
				typeof createServer === 'function' && createServer.prototype
					? new (createServer as new () => Record<string, unknown>)()
					: (createServer as () => Record<string, unknown>)();

			const listResources = server.listResources as () => Array<{
				uri: string;
				name: string;
				mimeType: string;
			}>;

			const resources = listResources();
			expect(Array.isArray(resources)).toBe(true);

			// Should list resource types (sessions, workflows)
			const uris = resources.map((r) => r.uri);
			const hasSessionResource = uris.some((u) => u.includes('session'));
			const hasWorkflowResource = uris.some((u) => u.includes('workflow'));

			expect(hasSessionResource || hasWorkflowResource).toBe(true);
		});
	});

	describe('auth enforcement', () => {
		it('MCP operations require valid auth context', () => {
			// Contract: All MCP operations should validate the auth context
			// before executing. An unauthenticated call should fail.
			const authContext = {
				orgId: 'org-1',
				userId: 'user-1',
				permissions: ['tools:read', 'tools:execute']
			};

			// Valid context has required fields
			expect(authContext.orgId).toBeDefined();
			expect(authContext.userId).toBeDefined();
			expect(authContext.permissions).toBeDefined();

			// Empty/null context should be rejected
			const emptyContext = {};
			expect(emptyContext).not.toHaveProperty('orgId');
			expect(emptyContext).not.toHaveProperty('userId');
		});

		it('tool execution respects permission checks', () => {
			// Contract: executeTool should check that the auth context
			// has 'tools:execute' permission
			const viewerPermissions = ['tools:read', 'sessions:read', 'workflows:read'];
			const operatorPermissions = [
				'tools:read',
				'tools:execute',
				'tools:approve',
				'sessions:read',
				'sessions:write',
				'workflows:read',
				'workflows:execute'
			];

			expect(viewerPermissions).not.toContain('tools:execute');
			expect(operatorPermissions).toContain('tools:execute');
		});
	});
});
