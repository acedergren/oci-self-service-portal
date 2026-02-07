import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('@portal/shared/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
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

describe('Webhook secret encryption at rest', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64')
		};
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('encryptWebhookSecret/decryptWebhookSecret should roundtrip', async () => {
		const { encryptWebhookSecret, decryptWebhookSecret } = await import(
			'@portal/shared/server/crypto'
		);

		const plaintext = 'whsec_roundtrip_secret';
		const encrypted = encryptWebhookSecret(plaintext);
		const decrypted = decryptWebhookSecret(encrypted.ciphertext, encrypted.iv);

		expect(encrypted.ciphertext).not.toContain(plaintext);
		expect(decrypted).toBe(plaintext);
	});

	it('webhookRepository.create should persist encrypted secret + iv', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const { webhookRepository } = await import(
			'@portal/shared/server/oracle/repositories/webhook-repository'
		);

		await webhookRepository.create({
			orgId: 'org-1',
			url: 'https://example.com/webhook',
			secret: 'whsec_plaintext_secret',
			events: ['tool.executed']
		});

		const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(typeof insertBinds.secret).toBe('string');
		expect(typeof insertBinds.secretIv).toBe('string');
		expect(insertBinds.secret).not.toBe('whsec_plaintext_secret');
	});

	it('webhookRepository.getActiveByEvent should decrypt stored ciphertext for dispatch', async () => {
		const { encryptWebhookSecret } = await import('@portal/shared/server/crypto');
		const encrypted = encryptWebhookSecret('whsec_dispatch_secret');

		mockExecute.mockResolvedValueOnce({
			rows: [
				{
					ID: 'wh-1',
					URL: 'https://example.com/webhook',
					SECRET: encrypted.ciphertext,
					SECRET_IV: encrypted.iv,
					EVENTS: '["tool.executed"]',
					STATUS: 'active',
					FAILURE_COUNT: 0
				}
			]
		});

		const { webhookRepository } = await import(
			'@portal/shared/server/oracle/repositories/webhook-repository'
		);
		const rows = await webhookRepository.getActiveByEvent('org-1', 'tool.executed');

		expect(rows).toHaveLength(1);
		expect(rows[0].SECRET).toBe('whsec_dispatch_secret');
	});

	it('webhookRepository.migratePlaintextSecrets should migrate legacy rows', async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ ID: 'wh-legacy', SECRET: 'whsec_legacy_plaintext' }]
			})
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [{ COUNT: 0 }] });

		const { webhookRepository } = await import(
			'@portal/shared/server/oracle/repositories/webhook-repository'
		);

		const result = await webhookRepository.migratePlaintextSecrets(10);
		expect(result.migrated).toBe(1);
		expect(result.remaining).toBe(0);

		const updateCall = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('UPDATE webhook_subscriptions')
		);
		expect(updateCall).toBeDefined();

		const updateBinds = updateCall?.[1] as Record<string, unknown>;
		expect(updateBinds.secret).not.toBe('whsec_legacy_plaintext');
		expect(typeof updateBinds.secretIv).toBe('string');
	});
});
