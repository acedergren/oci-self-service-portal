/**
 * Unit tests for the webhook subscription repository.
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and mock `execute` with counter-based sequencing.
 * Mock `crypto.ts` functions for encryption/decryption.
 *
 * Source: packages/server/src/oracle/repositories/webhook-repository.ts (369 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();
const mockEncryptWebhookSecret = vi.fn();
const mockDecryptWebhookSecret = vi.fn();
const mockIsWebhookEncryptionEnabled = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockWithConnection(...args)
}));

vi.mock('@portal/server/crypto', () => ({
	encryptWebhookSecret: (...args: unknown[]) => mockEncryptWebhookSecret(...args),
	decryptWebhookSecret: (...args: unknown[]) => mockDecryptWebhookSecret(...args),
	isWebhookEncryptionEnabled: (...args: unknown[]) => mockIsWebhookEncryptionEnabled(...args)
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

const MOCK_DATE = new Date('2026-02-17T12:00:00Z');

const MOCK_LIST_ROW = {
	ID: 'wh-1',
	URL: 'https://example.com/hook',
	EVENTS: '["session.created","tool.executed"]',
	STATUS: 'active',
	FAILURE_COUNT: 0,
	CREATED_AT: MOCK_DATE
};

const MOCK_DISPATCH_ROW = {
	ID: 'wh-1',
	URL: 'https://example.com/hook',
	SECRET: 'encrypted-data',
	SECRET_IV: 'iv-data',
	EVENTS: '["session.created"]',
	STATUS: 'active',
	FAILURE_COUNT: 0
};

// ── Setup ─────────────────────────────────────────────────────────────────

let callCount: number;

beforeEach(() => {
	vi.clearAllMocks();
	callCount = 0;

	// Default: withConnection invokes the callback with our mock connection
	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
	);

	// Default: execute returns empty result
	mockExecute.mockImplementation(async () => {
		callCount++;
		return { rows: [] };
	});

	// Default crypto mocks
	mockEncryptWebhookSecret.mockReturnValue({ ciphertext: 'enc-ct', iv: 'enc-iv' });
	mockDecryptWebhookSecret.mockReturnValue('decrypted-secret');
	mockIsWebhookEncryptionEnabled.mockReturnValue(true);
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getRepo() {
	const mod = await import('@portal/server/oracle/repositories/webhook-repository.js');
	return mod.webhookRepository;
}

// ── Smoke test ──────────────────────────────────────────────────────────

describe('webhook-repository (smoke)', () => {
	it('list returns empty array when no rows', async () => {
		const repo = await getRepo();
		const result = await repo.list('org-1');
		expect(result).toEqual([]);
	});
});

// ── create ──────────────────────────────────────────────────────────────

describe('create', () => {
	it('inserts with encrypted secret and returns UUID', async () => {
		const repo = await getRepo();
		const result = await repo.create({
			orgId: 'org-1',
			url: 'https://example.com/hook',
			secret: 'my-secret',
			events: ['session.created']
		});

		expect(result.id).toBeDefined();
		expect(typeof result.id).toBe('string');
		expect(mockEncryptWebhookSecret).toHaveBeenCalledWith('my-secret');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO webhook_subscriptions'),
			expect.objectContaining({
				orgId: 'org-1',
				url: 'https://example.com/hook',
				secret: 'enc-ct',
				secretIv: 'enc-iv',
				events: '["session.created"]'
			})
		);
	});
});

// ── getById ─────────────────────────────────────────────────────────────

describe('getById', () => {
	it('returns webhook scoped by orgId', async () => {
		mockExecute.mockResolvedValue({
			rows: [
				{
					ID: 'wh-1',
					ORG_ID: 'org-1',
					URL: 'https://example.com/hook',
					EVENTS: '["session.created"]',
					SECRET: null,
					STATUS: 'active',
					FAILURE_COUNT: 0,
					MAX_RETRIES: 3,
					LAST_FIRED_AT: null,
					LAST_ERROR: null,
					CREATED_AT: MOCK_DATE,
					UPDATED_AT: MOCK_DATE
				}
			]
		});

		const repo = await getRepo();
		const result = await repo.getById('wh-1', 'org-1');
		expect(result).toBeTruthy();
		expect(result!.id).toBe('wh-1');
		expect(result!.orgId).toBe('org-1');
	});

	it('returns null when not found', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const repo = await getRepo();
		const result = await repo.getById('nonexistent', 'org-1');
		expect(result).toBeNull();
	});
});

// ── list ────────────────────────────────────────────────────────────────

describe('list', () => {
	it('maps Oracle UPPERCASE rows to camelCase', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_LIST_ROW] });

		const repo = await getRepo();
		const result = await repo.list('org-1');

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: 'wh-1',
			url: 'https://example.com/hook',
			events: ['session.created', 'tool.executed'],
			status: 'active',
			failureCount: 0,
			createdAt: MOCK_DATE
		});
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });
		const repo = await getRepo();
		const result = await repo.list('org-1');
		expect(result).toEqual([]);
	});
});

// ── update ──────────────────────────────────────────────────────────────

describe('update', () => {
	it('builds dynamic SET clause for partial updates', async () => {
		const repo = await getRepo();
		await repo.update('wh-1', 'org-1', { url: 'https://new.example.com' });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('url = :url'),
			expect.objectContaining({ id: 'wh-1', orgId: 'org-1', url: 'https://new.example.com' })
		);
	});

	it('skips when no params provided', async () => {
		const repo = await getRepo();
		await repo.update('wh-1', 'org-1', {});

		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('includes events as JSON string', async () => {
		const repo = await getRepo();
		await repo.update('wh-1', 'org-1', { events: ['tool.executed'] });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('events = :events'),
			expect.objectContaining({ events: '["tool.executed"]' })
		);
	});
});

// ── delete ──────────────────────────────────────────────────────────────

describe('delete', () => {
	it('deletes org-scoped', async () => {
		const repo = await getRepo();
		await repo.delete('wh-1', 'org-1');

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('DELETE FROM webhook_subscriptions'),
			expect.objectContaining({ id: 'wh-1', orgId: 'org-1' })
		);
	});
});

// ── getActiveByEvent ────────────────────────────────────────────────────

describe('getActiveByEvent', () => {
	it('decrypts secrets for dispatch', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_DISPATCH_ROW] });

		const repo = await getRepo();
		const result = await repo.getActiveByEvent('org-1', 'session.created');

		expect(result).toHaveLength(1);
		expect(result[0].SECRET).toBe('decrypted-secret');
		expect(mockDecryptWebhookSecret).toHaveBeenCalledWith('encrypted-data', 'iv-data');
	});

	it('skips webhook on decrypt failure', async () => {
		mockDecryptWebhookSecret.mockImplementation(() => {
			throw new Error('decrypt failed');
		});
		mockExecute.mockResolvedValue({ rows: [MOCK_DISPATCH_ROW] });

		const repo = await getRepo();
		const result = await repo.getActiveByEvent('org-1', 'session.created');

		expect(result).toHaveLength(0);
	});

	it('lazy-migrates plaintext secrets when encryption is enabled', async () => {
		const plaintextRow = {
			...MOCK_DISPATCH_ROW,
			SECRET: 'plaintext-secret',
			SECRET_IV: null
		};
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			// First call: SELECT returning plaintext row
			if (callCount === 1) return { rows: [plaintextRow] };
			// Second call: UPDATE to migrate
			return { rows: [] };
		});

		const repo = await getRepo();
		await repo.getActiveByEvent('org-1', 'session.created');

		// Should have called encrypt for migration
		expect(mockEncryptWebhookSecret).toHaveBeenCalledWith('plaintext-secret');
		// Should have called execute twice: SELECT + UPDATE
		expect(callCount).toBe(2);
	});

	it('returns plaintext secret when encryption key is not configured', async () => {
		mockIsWebhookEncryptionEnabled.mockReturnValue(false);
		const plaintextRow = {
			...MOCK_DISPATCH_ROW,
			SECRET: 'plaintext-secret',
			SECRET_IV: null
		};
		mockExecute.mockResolvedValue({ rows: [plaintextRow] });

		const repo = await getRepo();
		const result = await repo.getActiveByEvent('org-1', 'session.created');

		expect(result).toHaveLength(1);
		expect(result[0].SECRET).toBe('plaintext-secret');
		expect(mockEncryptWebhookSecret).not.toHaveBeenCalled();
	});
});

// ── recordFailure ───────────────────────────────────────────────────────

describe('recordFailure', () => {
	it('passes error message to bind variables', async () => {
		const repo = await getRepo();
		await repo.recordFailure('wh-1', 'Connection timeout');

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('failure_count = failure_count + 1'),
			expect.objectContaining({ id: 'wh-1', error: 'Connection timeout' })
		);
	});

	it('includes circuit breaker SQL (trips at 5)', async () => {
		const repo = await getRepo();
		await repo.recordFailure('wh-1', 'err');

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain("WHEN failure_count + 1 >= 5 THEN 'failed'");
	});
});

// ── recordSuccess ───────────────────────────────────────────────────────

describe('recordSuccess', () => {
	it('resets failure count and last error', async () => {
		const repo = await getRepo();
		await repo.recordSuccess('wh-1');

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('failure_count = 0');
		expect(sql).toContain('last_error = NULL');
		expect(sql).toContain('last_fired_at = SYSTIMESTAMP');
	});
});

// ── migratePlaintextSecrets ─────────────────────────────────────────────

describe('migratePlaintextSecrets', () => {
	it('encrypts legacy rows and returns count', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// SELECT legacy rows
				return { rows: [{ ID: 'wh-old-1', SECRET: 'plaintext-1' }] };
			}
			if (callCount === 2) {
				// UPDATE row
				return { rows: [] };
			}
			// SELECT COUNT remaining
			return { rows: [{ COUNT: 0 }] };
		});

		const repo = await getRepo();
		const result = await repo.migratePlaintextSecrets(100);

		expect(result).toEqual({ migrated: 1, remaining: 0 });
		expect(mockEncryptWebhookSecret).toHaveBeenCalledWith('plaintext-1');
	});

	it('returns zero when encryption is not enabled', async () => {
		mockIsWebhookEncryptionEnabled.mockReturnValue(false);

		const repo = await getRepo();
		const result = await repo.migratePlaintextSecrets();

		expect(result).toEqual({ migrated: 0, remaining: 0 });
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('caps batch size to safe range', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [] };
			return { rows: [{ COUNT: 0 }] };
		});

		const repo = await getRepo();
		await repo.migratePlaintextSecrets(5000); // exceeds 1000 cap

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('FETCH FIRST 1000 ROWS ONLY');
	});
});
