/**
 * Route tests for MCP (Model Context Protocol) endpoints.
 *
 * Tests:
 * - GET  /api/mcp/tools              — list available tools
 * - POST /api/mcp/tools/:name/execute — execute a tool by name
 * - GET  /api/mcp/resources           — list available resources
 * - GET  /api/mcp/resources/:uri      — get a specific resource
 *
 * tools:read permission required for list/get, tools:execute for execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockListTools = vi.fn();
const mockExecuteTool = vi.fn();
const mockListResources = vi.fn();
const mockGetResource = vi.fn();

vi.mock('../../mastra/mcp/portal-mcp-server.js', () => ({
	PortalMCPServer: class {
		listTools = (...args: unknown[]) => mockListTools(...args);
		executeTool = (...args: unknown[]) => mockExecuteTool(...args);
		listResources = (...args: unknown[]) => mockListResources(...args);
		getResource = (...args: unknown[]) => mockGetResource(...args);
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_TOOLS = [
	{ name: 'list-instances', description: 'List compute instances' },
	{ name: 'create-vcn', description: 'Create a VCN' }
];

const MOCK_RESOURCES = [
	{ uri: 'oci://compartments', name: 'Compartments' },
	{ uri: 'oci://regions', name: 'Regions' }
];

const MOCK_TOOL_RESULT = {
	content: [{ type: 'text', text: 'Created instance i-123' }]
};

const MOCK_RESOURCE_CONTENT = {
	uri: 'oci://compartments',
	name: 'Compartments',
	contents: [{ text: '["comp-1", "comp-2"]' }]
};

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

async function buildMcpApp(
	permissions: string[] = ['tools:read', 'tools:execute']
): Promise<FastifyInstance> {
	const a = await buildTestApp({ withRbac: true });
	simulateSession(a, { id: 'user-1' }, permissions);
	const mcpRoutes = (await import('../../routes/mcp.js')).default;
	await a.register(mcpRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	mockListTools.mockReturnValue(MOCK_TOOLS);
	mockExecuteTool.mockResolvedValue(MOCK_TOOL_RESULT);
	mockListResources.mockReturnValue(MOCK_RESOURCES);
	mockGetResource.mockResolvedValue(MOCK_RESOURCE_CONTENT);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /api/mcp/tools ──────────────────────────────────────────────────

describe('GET /api/mcp/tools', () => {
	it('returns 200 with list of tools', async () => {
		app = await buildMcpApp();

		const res = await app.inject({ method: 'GET', url: '/api/mcp/tools' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.tools).toHaveLength(2);
		expect(body.tools[0].name).toBe('list-instances');
	});

	it('returns 401 for unauthenticated request', async () => {
		app = await buildTestApp({ withRbac: true });
		const mcpRoutes = (await import('../../routes/mcp.js')).default;
		await app.register(mcpRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/mcp/tools' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without tools:read permission', async () => {
		app = await buildMcpApp(['sessions:read']);

		const res = await app.inject({ method: 'GET', url: '/api/mcp/tools' });
		expect(res.statusCode).toBe(403);
	});
});

// ── POST /api/mcp/tools/:name/execute ───────────────────────────────────

describe('POST /api/mcp/tools/:name/execute', () => {
	it('returns 200 with tool execution result', async () => {
		app = await buildMcpApp();

		const res = await app.inject({
			method: 'POST',
			url: '/api/mcp/tools/list-instances/execute',
			payload: { compartmentId: 'comp-123' }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().result).toEqual(MOCK_TOOL_RESULT);
		expect(mockExecuteTool).toHaveBeenCalledWith(
			'list-instances',
			{ compartmentId: 'comp-123' },
			expect.objectContaining({ userId: 'user-1', permissions: ['tools:execute'] })
		);
	});

	it('passes empty args when no body provided', async () => {
		app = await buildMcpApp();

		await app.inject({
			method: 'POST',
			url: '/api/mcp/tools/list-instances/execute',
			payload: {}
		});

		expect(mockExecuteTool).toHaveBeenCalledWith('list-instances', {}, expect.anything());
	});

	it('returns 403 without tools:execute permission', async () => {
		app = await buildMcpApp(['tools:read']);

		const res = await app.inject({
			method: 'POST',
			url: '/api/mcp/tools/list-instances/execute',
			payload: {}
		});
		expect(res.statusCode).toBe(403);
	});
});

// ── GET /api/mcp/resources ──────────────────────────────────────────────

describe('GET /api/mcp/resources', () => {
	it('returns 200 with list of resources', async () => {
		app = await buildMcpApp();

		const res = await app.inject({ method: 'GET', url: '/api/mcp/resources' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.resources).toHaveLength(2);
		expect(body.resources[0].uri).toBe('oci://compartments');
	});
});

// ── GET /api/mcp/resources/:uri ─────────────────────────────────────────

describe('GET /api/mcp/resources/:uri', () => {
	it('returns resource content for a valid URI', async () => {
		app = await buildMcpApp();

		const encodedUri = encodeURIComponent('oci://compartments');
		const res = await app.inject({
			method: 'GET',
			url: `/api/mcp/resources/${encodedUri}`
		});

		expect(res.statusCode).toBe(200);
		expect(mockGetResource).toHaveBeenCalledWith(
			'oci://compartments',
			expect.objectContaining({ userId: 'user-1', permissions: ['tools:read'] })
		);
	});

	it('decodes URI-encoded parameter', async () => {
		app = await buildMcpApp();

		const encodedUri = encodeURIComponent('oci://regions/us-ashburn-1');
		await app.inject({
			method: 'GET',
			url: `/api/mcp/resources/${encodedUri}`
		});

		expect(mockGetResource).toHaveBeenCalledWith('oci://regions/us-ashburn-1', expect.anything());
	});
});
