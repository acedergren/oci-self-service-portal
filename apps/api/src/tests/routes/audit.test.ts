import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, simulateSession } from './test-helpers.js';
import { auditRoutes } from '../../routes/audit.js';

const mockVerify = vi.fn();
vi.mock('@portal/shared/server/oracle/repositories/blockchain-audit-repository', () => ({
	blockchainAuditRepository: {
		get verify() {
			return mockVerify;
		}
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

describe('GET /api/v1/audit/verify', () => {
	beforeEach(() => {
		mockVerify.mockReset();
	});

	it('returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(auditRoutes);
		await app.ready();
		const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without admin:audit permission', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.register(auditRoutes);
		await app.ready();
		const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
		expect(res.statusCode).toBe(403);
	});

	it('returns verification result on success', async () => {
		mockVerify.mockResolvedValue({
			valid: true,
			rowCount: 42,
			lastVerified: new Date('2026-01-01')
		});
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(auditRoutes);
		await app.ready();
		const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.valid).toBe(true);
		expect(body.rowCount).toBe(42);
		expect(body.verifiedAt).toBeDefined();
	});

	it('returns 503 on verification failure', async () => {
		mockVerify.mockRejectedValue(new Error('ORA-05715'));
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(auditRoutes);
		await app.ready();
		const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
		expect(res.statusCode).toBe(503);
	});
});
