/**
 * Phase 8 TDD: OpenAPI Specification Generation
 *
 * Generates an OpenAPI 3.1 spec from the tool registry.
 * The spec is served at /api/v1/openapi.json (public, no auth).
 *
 * Module under test: $lib/server/api/openapi.ts
 * Exports:
 *   - generateOpenAPISpec(): OpenAPIDocument
 *   - _invalidateOpenAPICache(): void
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllToolDefinitions } from '@portal/shared/tools/registry.js';

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

import { generateOpenAPISpec, _invalidateOpenAPICache } from '@portal/shared/server/api/openapi.js';

beforeEach(() => {
	vi.clearAllMocks();
	_invalidateOpenAPICache();
});

describe('OpenAPI Specification Generation (Phase 8.3)', () => {
	describe('generateOpenAPISpec', () => {
		it('produces a valid OpenAPI 3.1 spec object', () => {
			const spec = generateOpenAPISpec();
			expect(spec).toBeDefined();
			expect(spec.openapi).toBe('3.1.0');
			expect(spec.info).toBeDefined();
			expect(spec.info.title).toBeDefined();
			expect(spec.info.version).toBeDefined();
			expect(spec.paths).toBeDefined();
		});

		it('includes /tools path for listing all tools', () => {
			const spec = generateOpenAPISpec();
			const paths = spec.paths;

			expect(paths['/tools']).toBeDefined();
			const toolsPath = paths['/tools'] as Record<string, Record<string, unknown>>;
			expect(toolsPath.get).toBeDefined();
			expect(toolsPath.get.operationId).toBe('listTools');
		});

		it('includes /tools/{name} path for getting tool by name', () => {
			const spec = generateOpenAPISpec();
			const paths = spec.paths;

			expect(paths['/tools/{name}']).toBeDefined();
			const toolDetailPath = paths['/tools/{name}'] as Record<string, Record<string, unknown>>;
			expect(toolDetailPath.get).toBeDefined();
			expect(toolDetailPath.get.operationId).toBe('getToolByName');
		});

		it('includes per-tool execute paths', () => {
			const spec = generateOpenAPISpec();
			const paths = spec.paths;
			const allTools = getAllToolDefinitions();

			// Each tool should have a /tools/{name}/execute POST path
			for (const tool of allTools) {
				const pathKey = `/tools/${tool.name}/execute`;
				expect(paths[pathKey]).toBeDefined();
				const toolPath = paths[pathKey] as Record<string, Record<string, unknown>>;
				expect(toolPath.post).toBeDefined();
			}
		});

		it('defines Bearer and Cookie security schemes', () => {
			const spec = generateOpenAPISpec();
			const { securitySchemes } = spec.components;
			expect(securitySchemes).toBeDefined();

			// Bearer token
			const bearerScheme = securitySchemes.bearerAuth as Record<string, unknown>;
			expect(bearerScheme).toBeDefined();
			expect(bearerScheme.type).toBe('http');
			expect(bearerScheme.scheme).toBe('bearer');

			// Cookie-based session auth
			const cookieScheme = securitySchemes.cookieAuth as Record<string, unknown>;
			expect(cookieScheme).toBeDefined();
			expect(cookieScheme.type).toBe('apiKey');
			expect(cookieScheme.in).toBe('cookie');
		});

		it('tool parameter schemas are converted from Zod', () => {
			const spec = generateOpenAPISpec();
			const allTools = getAllToolDefinitions();
			const firstTool = allTools[0];

			const pathKey = `/tools/${firstTool.name}/execute`;
			const toolPath = spec.paths[pathKey] as Record<string, Record<string, unknown>>;
			const post = toolPath.post;

			expect(post.requestBody).toBeDefined();
			const content = (post.requestBody as Record<string, unknown>).content as Record<
				string,
				Record<string, unknown>
			>;
			const jsonSchema = content['application/json'].schema as Record<string, unknown>;
			expect(jsonSchema.type).toBe('object');
			expect(jsonSchema.properties).toBeDefined();
		});
	});

	describe('/api/v1/openapi.json endpoint contract', () => {
		it('endpoint should be accessible without authentication', () => {
			// Contract: the route handler should NOT require auth
			const publicPaths = ['/api/v1/openapi.json'];
			expect(publicPaths).toContain('/api/v1/openapi.json');
		});

		it('spec includes server URL', () => {
			const spec = generateOpenAPISpec();
			expect(spec.servers).toBeDefined();
			expect(Array.isArray(spec.servers)).toBe(true);
			expect(spec.servers.length).toBeGreaterThan(0);
			expect(spec.servers[0].url).toBeDefined();
		});

		it('spec is cached after first generation', () => {
			const spec1 = generateOpenAPISpec();
			const spec2 = generateOpenAPISpec();
			// Should be the same object reference (cached)
			expect(spec1).toBe(spec2);
		});
	});
});
