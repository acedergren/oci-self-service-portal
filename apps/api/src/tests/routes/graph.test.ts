import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, simulateSession } from './test-helpers.js';
import { graphRoutes } from '../../routes/graph.js';

const mockGetUserActivity = vi.fn();
const mockGetToolAffinity = vi.fn();
const mockGetOrgImpact = vi.fn();

vi.mock('@portal/shared/server/oracle/graph-analytics', () => ({
	get getUserActivity() {
		return mockGetUserActivity;
	},
	get getToolAffinity() {
		return mockGetToolAffinity;
	},
	get getOrgImpact() {
		return mockGetOrgImpact;
	}
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('GET /api/v1/graph', () => {
	beforeEach(() => {
		mockGetUserActivity.mockReset();
		mockGetToolAffinity.mockReset();
		mockGetOrgImpact.mockReset();
	});

	it('returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=user-activity&userId=123'
		});
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without admin:audit permission', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=user-activity&userId=123'
		});
		expect(res.statusCode).toBe(403);
	});

	it('returns 200 for user-activity type with userId', async () => {
		mockGetUserActivity.mockResolvedValue({ nodes: [], edges: [] });
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=user-activity&userId=123'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.type).toBe('user-activity');
	});

	it('returns 200 for tool-affinity type', async () => {
		mockGetToolAffinity.mockResolvedValue({ nodes: [], edges: [] });
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=tool-affinity'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.type).toBe('tool-affinity');
	});

	it('returns 200 for org-impact type with toolName', async () => {
		mockGetOrgImpact.mockResolvedValue({ nodes: [], edges: [] });
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=org-impact&toolName=test-tool'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.type).toBe('org-impact');
	});

	it('returns 400 for user-activity without userId', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=user-activity'
		});
		expect(res.statusCode).toBe(400);
	});

	it('returns 400 for org-impact without toolName', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=org-impact'
		});
		expect(res.statusCode).toBe(400);
	});

	it('returns 503 on analytics failure', async () => {
		mockGetUserActivity.mockRejectedValue(new Error('ORA-12345'));
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(graphRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/graph?type=user-activity&userId=123'
		});
		expect(res.statusCode).toBe(503);
	});
});
