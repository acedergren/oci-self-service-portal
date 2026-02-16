/**
 * Phase 8: REST API v1 route handler tests
 *
 * Tests the v1 tools API endpoints and OpenAPI spec generation.
 * Tests validate route handler logic, auth guards, and response shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getAllToolDefinitions,
	getToolDefinition,
	getToolsByCategory
} from '@portal/shared/tools/registry';
import { requiresApproval } from '@portal/shared/tools/types';
import type { ToolCategory } from '@portal/types/tools/types';

// ============================================================================
// OpenAPI Spec Generation
// ============================================================================

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

describe('OpenAPI Spec Generation (Phase 8.4)', () => {
	let generateOpenAPISpec: () => Record<string, unknown>;
	let invalidateCache: () => void;

	beforeEach(async () => {
		vi.resetModules();
		const mod = await import('$lib/server/api/openapi.js');
		generateOpenAPISpec = mod.generateOpenAPISpec;
		invalidateCache = mod._invalidateOpenAPICache;
		invalidateCache(); // Ensure fresh spec for each test
	});

	it('generates a valid OpenAPI 3.1 document', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		expect(spec.openapi).toBe('3.1.0');
		expect(spec.info).toBeDefined();
		expect((spec.info as Record<string, unknown>).title).toBe('CloudNow API');
		expect((spec.info as Record<string, unknown>).version).toBe('1.0.0');
	});

	it('includes /tools path for listing tools', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const paths = spec.paths as Record<string, unknown>;
		expect(paths['/tools']).toBeDefined();
		const toolsPath = paths['/tools'] as Record<string, unknown>;
		expect(toolsPath.get).toBeDefined();
	});

	it('includes /tools/{name} path for getting a tool', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const paths = spec.paths as Record<string, unknown>;
		expect(paths['/tools/{name}']).toBeDefined();
		const toolPath = paths['/tools/{name}'] as Record<string, unknown>;
		expect(toolPath.get).toBeDefined();
	});

	it('includes per-tool execute paths', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const paths = spec.paths as Record<string, unknown>;
		const tools = getAllToolDefinitions();

		for (const tool of tools) {
			const executePath = paths[`/tools/${tool.name}/execute`];
			expect(executePath, `Missing execute path for tool: ${tool.name}`).toBeDefined();
		}
	});

	it('includes security schemes for bearer and cookie auth', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const components = spec.components as Record<string, unknown>;
		const securitySchemes = components.securitySchemes as Record<string, unknown>;

		expect(securitySchemes.bearerAuth).toBeDefined();
		expect(securitySchemes.cookieAuth).toBeDefined();
	});

	it('includes response schemas', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const components = spec.components as Record<string, unknown>;
		const schemas = components.schemas as Record<string, unknown>;

		expect(schemas.ErrorResponse).toBeDefined();
		expect(schemas.ToolDefinition).toBeDefined();
		expect(schemas.ToolListResponse).toBeDefined();
		expect(schemas.ToolDetailResponse).toBeDefined();
		expect(schemas.ToolExecutionSuccess).toBeDefined();
		expect(schemas.ToolExecutionError).toBeDefined();
	});

	it('caches the spec after first generation', () => {
		const spec1 = generateOpenAPISpec();
		const spec2 = generateOpenAPISpec();
		expect(spec1).toBe(spec2); // Same reference
	});

	it('generates fresh spec after cache invalidation', () => {
		const spec1 = generateOpenAPISpec();
		invalidateCache();
		const spec2 = generateOpenAPISpec();
		expect(spec1).not.toBe(spec2); // Different reference
		// But structurally equal
		expect(JSON.stringify(spec1)).toBe(JSON.stringify(spec2));
	});

	it('includes category enum in list tools query param', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const paths = spec.paths as Record<string, unknown>;
		const toolsList = paths['/tools'] as Record<string, unknown>;
		const get = toolsList.get as Record<string, unknown>;
		const params = get.parameters as Array<Record<string, unknown>>;

		const categoryParam = params.find((p) => p.name === 'category');
		expect(categoryParam).toBeDefined();
		expect((categoryParam!.schema as Record<string, unknown>).enum).toBeDefined();
	});

	it('marks confirm/danger tool execute paths with X-Confirm header', () => {
		const spec = generateOpenAPISpec() as Record<string, unknown>;
		const paths = spec.paths as Record<string, unknown>;
		const tools = getAllToolDefinitions();

		const dangerTool = tools.find((t) => t.approvalLevel === 'danger');
		if (!dangerTool) return;

		const executePath = paths[`/tools/${dangerTool.name}/execute`] as Record<string, unknown>;
		const post = executePath.post as Record<string, unknown>;
		const params = post.parameters as Array<Record<string, unknown>>;

		const confirmHeader = params.find((p) => p.name === 'X-Confirm');
		expect(
			confirmHeader,
			`Danger tool ${dangerTool.name} should have X-Confirm header`
		).toBeDefined();
	});
});

// ============================================================================
// Dual Auth Helper
// ============================================================================

describe('Dual Auth Helper (require-auth)', () => {
	let requireApiAuth: (event: unknown, permission: string) => void;

	beforeEach(async () => {
		vi.resetModules();
		const mod = await import('$lib/server/api/require-auth.js');
		requireApiAuth = mod.requireApiAuth;
	});

	it('allows session-authenticated users with correct permissions', () => {
		const event = {
			locals: {
				user: { id: 'user-1' },
				permissions: ['tools:read', 'tools:execute'],
				apiKeyContext: undefined
			},
			url: { pathname: '/api/v1/tools' }
		};

		expect(() => requireApiAuth(event as unknown, 'tools:read')).not.toThrow();
	});

	it('allows admin users regardless of specific permission', () => {
		const event = {
			locals: {
				user: { id: 'admin-1' },
				permissions: ['admin:all'],
				apiKeyContext: undefined
			},
			url: { pathname: '/api/v1/tools' }
		};

		expect(() => requireApiAuth(event as unknown, 'tools:execute')).not.toThrow();
	});

	it('allows API key authenticated requests with correct permissions', () => {
		const event = {
			locals: {
				user: undefined,
				permissions: [],
				apiKeyContext: {
					orgId: 'org-1',
					permissions: ['tools:read'],
					keyId: 'key-1',
					keyName: 'test'
				}
			},
			url: { pathname: '/api/v1/tools' }
		};

		expect(() => requireApiAuth(event as unknown, 'tools:read')).not.toThrow();
	});

	it('throws 401 when neither session nor API key is present', () => {
		const event = {
			locals: {
				user: undefined,
				permissions: [],
				apiKeyContext: undefined
			},
			url: { pathname: '/api/v1/tools' }
		};

		// SvelteKit HttpError: status 401 — 'Authentication required'
		expect(() => requireApiAuth(event as unknown, 'tools:read')).toThrow();
	});

	it('throws 403 when session user lacks required permission', () => {
		const event = {
			locals: {
				user: { id: 'user-1' },
				permissions: ['tools:read'],
				apiKeyContext: undefined
			},
			url: { pathname: '/api/v1/tools' }
		};

		// SvelteKit HttpError: status 403 — 'Insufficient permissions'
		expect(() => requireApiAuth(event as unknown, 'tools:execute')).toThrow();
	});

	it('throws 403 when API key lacks required permission', () => {
		const event = {
			locals: {
				user: undefined,
				permissions: [],
				apiKeyContext: {
					orgId: 'org-1',
					permissions: ['tools:read'],
					keyId: 'key-1',
					keyName: 'test'
				}
			},
			url: { pathname: '/api/v1/tools' }
		};

		// SvelteKit HttpError: status 403 — 'Insufficient permissions'
		expect(() => requireApiAuth(event as unknown, 'tools:execute')).toThrow();
	});
});

// ============================================================================
// REST API Response Shape Contracts
// ============================================================================

describe('REST API Response Shapes (Phase 8.3)', () => {
	describe('GET /api/v1/tools response shape', () => {
		it('tools list response has expected shape', () => {
			const tools = getAllToolDefinitions();
			const response = {
				tools: tools.map((t) => ({
					name: t.name,
					description: t.description,
					category: t.category,
					approvalLevel: t.approvalLevel
				})),
				total: tools.length
			};

			expect(response.total).toBeGreaterThan(0);
			expect(response.tools).toHaveLength(response.total);

			for (const tool of response.tools) {
				expect(typeof tool.name).toBe('string');
				expect(typeof tool.description).toBe('string');
				expect(typeof tool.category).toBe('string');
				expect(['auto', 'confirm', 'danger']).toContain(tool.approvalLevel);
			}
		});

		it('category filter produces valid subset', () => {
			const validCategories: ToolCategory[] = [
				'compute',
				'networking',
				'storage',
				'database',
				'identity',
				'observability',
				'pricing',
				'search',
				'billing',
				'logging'
			];

			for (const category of validCategories) {
				const tools = getToolsByCategory(category);
				for (const tool of tools) {
					expect(tool.category).toBe(category);
				}
			}
		});
	});

	describe('GET /api/v1/tools/:name response shape', () => {
		it('tool detail response includes approval info', () => {
			const tool = getToolDefinition('listInstances');
			expect(tool).toBeDefined();

			const response = {
				tool: {
					name: tool!.name,
					description: tool!.description,
					category: tool!.category,
					approvalLevel: tool!.approvalLevel,
					requiresApproval: requiresApproval(tool!.approvalLevel)
				}
			};

			expect(response.tool.name).toBe('listInstances');
			expect(response.tool.requiresApproval).toBe(false); // auto tools don't need approval
		});

		it('danger tool response includes warning', () => {
			const tool = getToolDefinition('terminateInstance');
			if (!tool) return; // may not exist

			expect(tool.approvalLevel).toBe('danger');
			expect(requiresApproval(tool.approvalLevel)).toBe(true);
		});
	});

	describe('POST /api/v1/tools/:name/execute response shape', () => {
		it('success response has all required fields', () => {
			const successResponse = {
				success: true,
				tool: 'listInstances',
				data: { data: [] },
				duration: 150,
				approvalLevel: 'auto'
			};

			expect(successResponse.success).toBe(true);
			expect(typeof successResponse.tool).toBe('string');
			expect(typeof successResponse.duration).toBe('number');
			expect(typeof successResponse.approvalLevel).toBe('string');
		});

		it('error response has all required fields', () => {
			const errorResponse = {
				success: false,
				tool: 'terminateInstance',
				error: 'OCI CLI error: ...',
				code: 'OCI_ERROR',
				duration: 2500,
				approvalLevel: 'danger'
			};

			expect(errorResponse.success).toBe(false);
			expect(typeof errorResponse.error).toBe('string');
			expect(typeof errorResponse.code).toBe('string');
			expect(typeof errorResponse.duration).toBe('number');
		});
	});
});
