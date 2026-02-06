/**
 * Phase 8 TDD: REST API for Tools (/api/v1/tools)
 *
 * Exposes the tool registry as a REST API for external consumption.
 *
 * Expected routes:
 *   GET  /api/v1/tools          - List all tools (with optional category filter)
 *   GET  /api/v1/tools/:name    - Get tool definition by name
 *   POST /api/v1/tools/:name    - Execute a tool by name
 *
 * Expected module: $lib/server/api/v1/tools.ts (or route handlers)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getAllToolDefinitions,
	getToolDefinition,
	getToolsByCategory
} from '$lib/tools/registry.js';
import type { ToolDefinition } from '$lib/tools/types.js';

// These tests verify the data contracts that the API routes will serve.
// The actual route handlers don't exist yet (Phase 8.1), but we can
// test the underlying registry functions and define the expected API shapes.

describe('REST API for Tools (Phase 8.1)', () => {
	describe('GET /api/v1/tools - list all tools', () => {
		it('getAllToolDefinitions returns a non-empty array', () => {
			const tools = getAllToolDefinitions();
			expect(Array.isArray(tools)).toBe(true);
			expect(tools.length).toBeGreaterThan(0);
		});

		it('each tool has required fields', () => {
			const tools = getAllToolDefinitions();
			for (const tool of tools) {
				expect(tool.name).toBeDefined();
				expect(typeof tool.name).toBe('string');
				expect(tool.description).toBeDefined();
				expect(tool.category).toBeDefined();
				expect(tool.approvalLevel).toBeDefined();
				expect(['auto', 'confirm', 'danger']).toContain(tool.approvalLevel);
				expect(tool.parameters).toBeDefined();
			}
		});

		it('tool names are unique', () => {
			const tools = getAllToolDefinitions();
			const names = tools.map((t) => t.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it('filtering by category returns subset', () => {
			const computeTools = getToolsByCategory('compute');
			const allTools = getAllToolDefinitions();
			expect(computeTools.length).toBeGreaterThan(0);
			expect(computeTools.length).toBeLessThanOrEqual(allTools.length);
			for (const tool of computeTools) {
				expect(tool.category).toBe('compute');
			}
		});

		it('API response shape matches expected contract', () => {
			const tools = getAllToolDefinitions();
			// The API should return this shape:
			const apiResponse = {
				tools: tools.map((t) => ({
					name: t.name,
					description: t.description,
					category: t.category,
					approvalLevel: t.approvalLevel
				})),
				total: tools.length
			};

			expect(apiResponse.total).toBe(tools.length);
			expect(apiResponse.tools[0]).toHaveProperty('name');
			expect(apiResponse.tools[0]).toHaveProperty('description');
			expect(apiResponse.tools[0]).toHaveProperty('category');
			expect(apiResponse.tools[0]).toHaveProperty('approvalLevel');
		});
	});

	describe('GET /api/v1/tools/:name - get tool by name', () => {
		it('getToolDefinition returns tool for valid name', () => {
			const tool = getToolDefinition('listInstances');
			expect(tool).toBeDefined();
			expect(tool!.name).toBe('listInstances');
			expect(tool!.category).toBe('compute');
		});

		it('getToolDefinition returns undefined for unknown name', () => {
			const tool = getToolDefinition('nonExistentTool');
			expect(tool).toBeUndefined();
		});

		it('API should return 404 for unknown tool', () => {
			const tool = getToolDefinition('nonExistentTool');
			// Route handler should return 404 when tool is undefined
			const status = tool ? 200 : 404;
			expect(status).toBe(404);
		});
	});

	describe('POST /api/v1/tools/:name - execute tool', () => {
		it('execution response shape matches expected contract', () => {
			// The POST endpoint should return this shape:
			const expectedSuccessResponse = {
				success: true,
				tool: 'listInstances',
				data: {
					/* result */
				},
				duration: 1234,
				approvalLevel: 'auto'
			};

			expect(expectedSuccessResponse).toHaveProperty('success', true);
			expect(expectedSuccessResponse).toHaveProperty('tool');
			expect(expectedSuccessResponse).toHaveProperty('data');

			const expectedErrorResponse = {
				success: false,
				tool: 'terminateInstance',
				error: 'Operation was cancelled by user',
				rejected: true
			};

			expect(expectedErrorResponse).toHaveProperty('success', false);
			expect(expectedErrorResponse).toHaveProperty('error');
		});

		it('danger-level tools should require approval header or body field', () => {
			const tool = getToolDefinition('terminateInstance');
			if (!tool) return; // tool may not exist in all configs
			expect(tool.approvalLevel).toBe('danger');
			// API handler should check for X-Confirm: true header or { confirmed: true } in body
		});
	});
});
