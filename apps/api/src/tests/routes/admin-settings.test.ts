/**
 * Route tests for admin settings endpoints.
 *
 * Tests:
 * - GET /api/admin/settings   — returns flat PortalSettings object
 * - PATCH /api/admin/settings — updates settings from flat partial object
 *
 * Both endpoints require admin:all permission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGetValue = vi.fn();
const mockSet = vi.fn();

vi.mock('@portal/server/admin/settings-repository', () => ({
	settingsRepository: {
		getValue: (...args: unknown[]) => mockGetValue(...args),
		set: (...args: unknown[]) => mockSet(...args)
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

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

async function buildSettingsApp(): Promise<FastifyInstance> {
	const a = await buildTestApp({ withRbac: true });
	simulateSession(a, { id: 'admin-1' }, ['admin:all']);
	const { adminSettingsRoutes } = await import('../../routes/admin/settings.js');
	await a.register(adminSettingsRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	// Returns null by default (setting not found)
	mockGetValue.mockResolvedValue(null);
	mockSet.mockResolvedValue(undefined);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /api/admin/settings ────────────────────────────────────────────────

describe('GET /api/admin/settings', () => {
	it('returns 200 with flat settings object including configured values', async () => {
		// Only portal.name is configured — others return null and are omitted
		mockGetValue.mockImplementation(async (key: string) => {
			if (key === 'portal.name') return 'CloudNow';
			if (key === 'portal.maintenance_mode') return false;
			return null;
		});
		app = await buildSettingsApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/settings' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.portalName).toBe('CloudNow');
		expect(body.maintenanceMode).toBe(false);
		// Null settings should be omitted
		expect(body.primaryColor).toBeUndefined();
	});

	it('returns 200 with empty object when no settings are configured', async () => {
		mockGetValue.mockResolvedValue(null);
		app = await buildSettingsApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/settings' });

		expect(res.statusCode).toBe(200);
		// All keys are null — result should be an empty object (or only known falsy defaults)
		const body = res.json();
		// Should not contain any undefined/null entries
		for (const val of Object.values(body)) {
			expect(val).not.toBeNull();
		}
	});

	it('returns 401 for unauthenticated request', async () => {
		app = await buildTestApp({ withRbac: true });
		const { adminSettingsRoutes } = await import('../../routes/admin/settings.js');
		await app.register(adminSettingsRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/settings' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 for user without admin:all permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { adminSettingsRoutes } = await import('../../routes/admin/settings.js');
		await app.register(adminSettingsRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/settings' });
		expect(res.statusCode).toBe(403);
	});
});

// ── PATCH /api/admin/settings ─────────────────────────────────────────────

describe('PATCH /api/admin/settings', () => {
	it('updates provided settings fields and returns the updated object', async () => {
		mockGetValue.mockImplementation(async (key: string) => {
			if (key === 'portal.name') return 'CloudNow Updated';
			return null;
		});
		mockSet.mockResolvedValue(undefined);
		app = await buildSettingsApp();

		const res = await app.inject({
			method: 'PATCH',
			url: '/api/admin/settings',
			payload: {
				portalName: 'CloudNow Updated',
				maintenanceMode: false
			}
		});

		expect(res.statusCode).toBe(200);
		// set should be called once per field in the update
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ key: 'portal.name', value: 'CloudNow Updated' })
		);
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ key: 'portal.maintenance_mode', value: false })
		);
	});

	it('ignores unknown field names not in the settings map', async () => {
		mockGetValue.mockResolvedValue(null);
		app = await buildSettingsApp();

		const res = await app.inject({
			method: 'PATCH',
			url: '/api/admin/settings',
			payload: { unknownField: 'should-be-ignored' }
		});

		// Should succeed (200), but not call set for the unknown field
		expect(res.statusCode).toBe(200);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('returns 200 with empty payload (no-op update)', async () => {
		app = await buildSettingsApp();

		const res = await app.inject({
			method: 'PATCH',
			url: '/api/admin/settings',
			payload: {}
		});

		expect(res.statusCode).toBe(200);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('returns 401 for unauthenticated PATCH', async () => {
		app = await buildTestApp({ withRbac: true });
		const { adminSettingsRoutes } = await import('../../routes/admin/settings.js');
		await app.register(adminSettingsRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'PATCH',
			url: '/api/admin/settings',
			payload: { portalName: 'test' }
		});
		expect(res.statusCode).toBe(401);
	});
});
