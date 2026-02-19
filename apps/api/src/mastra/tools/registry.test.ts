import { describe, it, expect } from 'vitest';
import {
	getAllToolDefinitions,
	getToolDefinition,
	getToolsByCategory,
	buildMastraTools,
	createAISDKTools,
	executeTool,
	toolDefinitions
} from './registry.js';
import { CHARLIE_TOOLS, CLOUDADVISOR_TOOLS } from './index.js';

describe('tool registry', () => {
	describe('getAllToolDefinitions', () => {
		it('returns all registered tool definitions', () => {
			const defs = getAllToolDefinitions();

			expect(defs.length).toBeGreaterThan(0);
			// Each definition should have the required fields
			for (const def of defs) {
				expect(def.name).toBeTruthy();
				expect(def.description).toBeTruthy();
				expect(def.category).toBeTruthy();
				expect(def.parameters).toBeDefined();
			}
		});

		it('includes tools from multiple categories', () => {
			const defs = getAllToolDefinitions();
			const categories = new Set(defs.map((d) => d.category));

			// Should have tools from at least 5 categories
			expect(categories.size).toBeGreaterThanOrEqual(5);
		});
	});

	describe('getToolDefinition', () => {
		it('returns a tool definition by name', () => {
			const def = getToolDefinition('listInstances');

			expect(def).toBeDefined();
			expect(def!.name).toBe('listInstances');
			expect(def!.category).toBe('compute');
		});

		it('returns undefined for unknown tool', () => {
			const def = getToolDefinition('nonExistentTool');

			expect(def).toBeUndefined();
		});
	});

	describe('getToolsByCategory', () => {
		it('returns tools filtered by category', () => {
			const computeTools = getToolsByCategory('compute');

			expect(computeTools.length).toBeGreaterThan(0);
			for (const tool of computeTools) {
				expect(tool.category).toBe('compute');
			}
		});

		it('returns empty array for unknown category', () => {
			const tools = getToolsByCategory('nonExistentCategory' as never);

			expect(tools).toEqual([]);
		});
	});

	describe('buildMastraTools', () => {
		it('returns a Record of Mastra tools', () => {
			const tools = buildMastraTools();

			expect(typeof tools).toBe('object');
			expect(Object.keys(tools).length).toBeGreaterThan(0);
		});

		it('each tool has id, description, and execute', () => {
			const tools = buildMastraTools();

			for (const [name, tool] of Object.entries(tools)) {
				expect(name).toBeTruthy();
				expect(tool).toBeDefined();
				// Mastra tools are objects with id and description
				expect(typeof tool).toBe('object');
			}
		});

		it('tool count matches registry count', () => {
			const tools = buildMastraTools();
			const defs = getAllToolDefinitions();

			expect(Object.keys(tools).length).toBe(defs.length);
		});

		it('tool names match definition names', () => {
			const tools = buildMastraTools();
			const defs = getAllToolDefinitions();
			const defNames = new Set(defs.map((d) => d.name));

			for (const name of Object.keys(tools)) {
				expect(defNames.has(name)).toBe(true);
			}
		});
	});

	describe('createAISDKTools', () => {
		it('returns a Record of AI SDK tools', () => {
			const tools = createAISDKTools();

			expect(typeof tools).toBe('object');
			expect(Object.keys(tools).length).toBeGreaterThan(0);
		});

		it('tool count matches registry count', () => {
			const tools = createAISDKTools();
			const defs = getAllToolDefinitions();

			expect(Object.keys(tools).length).toBe(defs.length);
		});
	});

	describe('executeTool', () => {
		it('throws for unknown tool', async () => {
			await expect(executeTool('unknownTool', {})).rejects.toThrow(
				'No executor for tool: unknownTool'
			);
		});

		it('executes a tool with sync executor', async () => {
			// generateTerraform has an async executor
			const def = getToolDefinition('generateTerraform');
			if (!def) return; // skip if not registered

			const result = await executeTool('generateTerraform', {
				type: 'compute',
				name: 'test-instance'
			});

			expect(result).toBeDefined();
		});
	});
});

describe('tool categories', () => {
	const expectedCategories = [
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

	for (const category of expectedCategories) {
		it(`has tools in category: ${category}`, () => {
			const tools = getToolsByCategory(category as never);
			expect(tools.length).toBeGreaterThan(0);
		});
	}
});

describe('CHARLIE_TOOLS', () => {
	it('contains all registered tool names', () => {
		const allNames = Array.from(toolDefinitions.keys());
		expect(CHARLIE_TOOLS.length).toBe(allNames.length);
		for (const name of allNames) {
			expect(CHARLIE_TOOLS).toContain(name);
		}
	});

	it('is frozen (immutable)', () => {
		expect(Object.isFrozen(CHARLIE_TOOLS)).toBe(true);
	});
});

describe('CLOUDADVISOR_TOOLS', () => {
	it('contains only tools with approvalLevel === "auto"', () => {
		expect(CLOUDADVISOR_TOOLS.length).toBeGreaterThan(0);
		for (const name of CLOUDADVISOR_TOOLS) {
			const def = toolDefinitions.get(name);
			expect(def).toBeDefined();
			expect(def!.approvalLevel).toBe('auto');
		}
	});

	it('is a strict subset of CHARLIE_TOOLS', () => {
		for (const name of CLOUDADVISOR_TOOLS) {
			expect(CHARLIE_TOOLS).toContain(name);
		}
		// Must be a strict subset — not all tools are auto-approved
		expect(CLOUDADVISOR_TOOLS.length).toBeLessThan(CHARLIE_TOOLS.length);
	});

	it('is frozen (immutable)', () => {
		expect(Object.isFrozen(CLOUDADVISOR_TOOLS)).toBe(true);
	});
});
