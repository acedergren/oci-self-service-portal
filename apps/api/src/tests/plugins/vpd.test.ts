/**
 * VPD Fastify Plugin Tests (W2-2)
 *
 * Tests the vpdPlugin which wires portal_ctx_pkg tenant isolation into
 * the Fastify request lifecycle:
 * - Decorates request with withVPD helper
 * - withVPD calls set_org_id before query and clear_context after
 * - Handles null org (unauthenticated) by skipping VPD setup
 * - Admin bypass support via admin:all permission
 *
 * Uses forwarding mock pattern to survive mockReset: true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fp from 'fastify-plugin';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInitPool = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockWithConnection = vi.fn();
const mockGetPoolStats = vi.fn().mockResolvedValue(null);
const mockIsPoolInitialized = vi.fn().mockReturnValue(true);
const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockMigratePlaintextSecrets = vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 });

vi.mock('@portal/server/oracle/connection', () => ({
	initPool: (...args: unknown[]) => mockInitPool(...args),
	closePool: (...args: unknown[]) => mockClosePool(...args),
	withConnection: (...args: unknown[]) => mockWithConnection(...args),
	getPoolStats: (...args: unknown[]) => mockGetPoolStats(...args),
	isPoolInitialized: (...args: unknown[]) => mockIsPoolInitialized(...args)
}));

vi.mock('@portal/server/oracle/migrations', () => ({
	runMigrations: (...args: unknown[]) => mockRunMigrations(...args)
}));

vi.mock('@portal/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: (...args: unknown[]) => mockMigratePlaintextSecrets(...args)
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

type WithVPD = <T>(fn: (conn: unknown) => Promise<T>) => Promise<T>;

/**
 * Build a minimal Fastify app with oracle + fake-auth + vpd plugin registered.
 */
async function buildTestApp(
	opts: {
		orgId?: string | null;
		userId?: string | null;
		adminBypass?: boolean;
	} = {}
) {
	const { orgId = 'org-test-123', userId = 'user-abc', adminBypass = false } = opts;

	const app = Fastify({ logger: false });

	// 1. Oracle plugin
	const { default: oraclePlugin } = await import('../../plugins/oracle.js');
	await app.register(oraclePlugin, { migrate: false });

	// 2. Fake 'auth' named plugin — satisfies vpdPlugin's dependency declaration
	const PERMS_KEY = Symbol('test.permissions');
	await app.register(
		fp(
			async (instance) => {
				instance.decorateRequest('user', null);
				instance.decorateRequest('session', null);
				instance.decorateRequest('apiKeyContext', null);
				instance.decorateRequest('permissions', {
					getter(this: Record<symbol, string[]>) {
						if (!this[PERMS_KEY]) this[PERMS_KEY] = [];
						return this[PERMS_KEY];
					},
					setter(this: Record<symbol, string[]>, value: string[]) {
						this[PERMS_KEY] = value;
					}
				});

				// Inject fake session
				instance.addHook('onRequest', async (request) => {
					if (orgId !== null) {
						(request as Record<string, unknown>).session = { activeOrganizationId: orgId };
						(request as Record<string, unknown>).user = { id: userId };
						request.permissions = adminBypass ? ['admin:all'] : ['tools:read'];
					}
				});
			},
			{ name: 'auth', fastify: '5.x' }
		)
	);

	// 3. VPD plugin under test
	const { default: vpdPlugin } = await import('../../plugins/vpd.js');
	await app.register(vpdPlugin);

	// 4. Test route
	app.get('/test', async (request, reply) => {
		const result = await (request as unknown as { withVPD: WithVPD }).withVPD(
			async (conn) =>
				await (conn as { execute: (sql: string, binds: unknown) => Promise<unknown> }).execute(
					'SELECT 1 FROM DUAL',
					[]
				)
		);
		return reply.send(result);
	});

	await app.ready();
	return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VPD Fastify plugin (W2-2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: simple execute mock
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) => {
			const conn = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
			return fn(conn);
		});
	});

	describe('plugin registration', () => {
		it('registers without error and decorates request with withVPD', async () => {
			const app = await buildTestApp();
			try {
				expect(app.hasRequestDecorator('withVPD')).toBe(true);
			} finally {
				await app.close();
			}
		});
	});

	describe('withVPD — authenticated request with org context', () => {
		it('calls set_org_id before query and clear_context after', async () => {
			const mockExecute = vi
				.fn()
				.mockResolvedValueOnce(undefined) // set_org_id
				.mockResolvedValueOnce({ rows: [{ N: 1 }] }) // SELECT
				.mockResolvedValueOnce(undefined); // clear_context

			mockWithConnection.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) =>
				fn({ execute: mockExecute })
			);

			const app = await buildTestApp({ orgId: 'org-test-123' });
			try {
				const res = await app.inject({ method: 'GET', url: '/test' });
				expect(res.statusCode).toBe(200);

				expect(mockExecute).toHaveBeenCalledTimes(3);
				expect(mockExecute.mock.calls[0][0]).toContain('portal_ctx_pkg.set_org_id');
				expect(mockExecute.mock.calls[0][1]).toEqual({ orgId: 'org-test-123' });
				expect(mockExecute.mock.calls[2][0]).toContain('portal_ctx_pkg.clear_context');
			} finally {
				await app.close();
			}
		});

		it('calls clear_context even when query throws', async () => {
			const mockExecute = vi
				.fn()
				.mockResolvedValueOnce(undefined) // set_org_id
				.mockRejectedValueOnce(new Error('DB error')) // SELECT fails
				.mockResolvedValueOnce(undefined); // clear_context still called

			mockWithConnection.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) =>
				fn({ execute: mockExecute })
			);

			// Build app manually so we can add /fail route before ready()
			const { orgId } = { orgId: 'org-test-123' };
			const appFail = Fastify({ logger: false });
			const { default: oraclePlugin } = await import('../../plugins/oracle.js');
			await appFail.register(oraclePlugin, { migrate: false });
			const PKEY = Symbol('test.p');
			await appFail.register(
				fp(
					async (inst) => {
						inst.decorateRequest('user', null);
						inst.decorateRequest('session', null);
						inst.decorateRequest('apiKeyContext', null);
						inst.decorateRequest('permissions', {
							getter(this: Record<symbol, string[]>) {
								if (!this[PKEY]) this[PKEY] = [];
								return this[PKEY];
							},
							setter(this: Record<symbol, string[]>, v: string[]) {
								this[PKEY] = v;
							}
						});
						inst.addHook('onRequest', async (request) => {
							(request as Record<string, unknown>).session = { activeOrganizationId: orgId };
							(request as Record<string, unknown>).user = { id: 'user-abc' };
							request.permissions = ['tools:read'];
						});
					},
					{ name: 'auth', fastify: '5.x' }
				)
			);
			const { default: vpdPlugin } = await import('../../plugins/vpd.js');
			await appFail.register(vpdPlugin);
			appFail.get('/fail', async (request) => {
				await (request as unknown as { withVPD: WithVPD }).withVPD(async (conn) =>
					(conn as { execute: (sql: string, binds: unknown) => Promise<unknown> }).execute(
						'SELECT 1 FROM DUAL',
						[]
					)
				);
			});
			await appFail.ready();

			try {
				await appFail.inject({ method: 'GET', url: '/fail' });

				const clearCalls = mockExecute.mock.calls.filter(
					(call: unknown[]) =>
						typeof call[0] === 'string' && call[0].includes('portal_ctx_pkg.clear_context')
				);
				expect(clearCalls).toHaveLength(1);
			} finally {
				await appFail.close();
			}
		});
	});

	describe('withVPD — unauthenticated / no org context', () => {
		it('skips all VPD calls when no org is present', async () => {
			const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

			mockWithConnection.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) =>
				fn({ execute: mockExecute })
			);

			const app = await buildTestApp({ orgId: null, userId: null });
			try {
				const res = await app.inject({ method: 'GET', url: '/test' });
				expect(res.statusCode).toBe(200);

				// Only the SELECT itself — no portal_ctx_pkg calls
				const vpdCalls = mockExecute.mock.calls.filter(
					(call: unknown[]) => typeof call[0] === 'string' && call[0].includes('portal_ctx_pkg')
				);
				expect(vpdCalls).toHaveLength(0);
			} finally {
				await app.close();
			}
		});
	});

	describe('withVPD — admin bypass', () => {
		it('calls set_admin_bypass instead of set_org_id for admin:all users', async () => {
			const mockExecute = vi
				.fn()
				.mockResolvedValueOnce(undefined) // set_admin_bypass
				.mockResolvedValueOnce({ rows: [] }) // SELECT
				.mockResolvedValueOnce(undefined); // clear_context

			mockWithConnection.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) =>
				fn({ execute: mockExecute })
			);

			const app = await buildTestApp({ orgId: 'org-test-123', adminBypass: true });
			try {
				const res = await app.inject({ method: 'GET', url: '/test' });
				expect(res.statusCode).toBe(200);

				const bypassCalls = mockExecute.mock.calls.filter(
					(call: unknown[]) =>
						typeof call[0] === 'string' && call[0].includes('portal_ctx_pkg.set_admin_bypass')
				);
				expect(bypassCalls).toHaveLength(1);

				const orgIdCalls = mockExecute.mock.calls.filter(
					(call: unknown[]) =>
						typeof call[0] === 'string' && call[0].includes('portal_ctx_pkg.set_org_id')
				);
				expect(orgIdCalls).toHaveLength(0);
			} finally {
				await app.close();
			}
		});
	});
});
