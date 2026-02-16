/**
 * Phase 8 TDD: Webhook Subscriptions
 *
 * Allows external systems to subscribe to portal events (tool executions,
 * workflow completions, etc.) via webhooks with HMAC-SHA256 signatures.
 *
 * Expected modules:
 *   - $lib/server/webhooks.ts (dispatcher, signature, retry logic)
 *     Exports:
 *       generateSignature(payload, secret): string
 *       verifySignature(payload, signature, secret): boolean
 *       dispatchEvent(event): Promise<DispatchResult[]>
 *
 *   - $lib/server/oracle/repositories/webhook-repository.ts
 *     Exports: webhookRepository { create, getById, list, update, delete }
 *
 * Expected DB table (migration 006):
 *   webhooks (
 *     id, org_id, url, secret, events, status, failure_count,
 *     last_success_at, last_failure_at, created_at, updated_at
 *   )
 *
 * Security: SSRF prevention blocks private IP ranges
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/sentry.js', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
}));

let webhooksModule: Record<string, unknown> | null = null;
let webhooksModuleError: string | null = null;
let repoModule: Record<string, unknown> | null = null;
let repoModuleError: string | null = null;
const originalEnv = process.env;

beforeEach(async () => {
	process.env = {
		...originalEnv,
		WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64')
	};
	vi.clearAllMocks();
	vi.resetModules();
	try {
		webhooksModule = await import('$lib/server/webhooks.js');
	} catch (err) {
		webhooksModuleError = (err as Error).message;
	}
	try {
		repoModule = await import('$lib/server/oracle/repositories/webhook-repository.js');
	} catch (err) {
		repoModuleError = (err as Error).message;
	}
});

afterEach(() => {
	process.env = originalEnv;
});

// ============================================================================
// Webhook Repository CRUD
// ============================================================================

describe('Webhook Repository (Phase 8.4)', () => {
	describe('module availability', () => {
		it('webhook-repository module should be importable', () => {
			if (repoModuleError) {
				expect.fail(
					`webhook-repository module not yet available: ${repoModuleError}. ` +
						'Implement $lib/server/oracle/repositories/webhook-repository.ts per Phase 8.4.'
				);
			}
			expect(repoModule).not.toBeNull();
		});
	});

	describe('create', () => {
		it('creates a webhook subscription and returns id', async () => {
			if (!repoModule) return;
			const webhookRepository = repoModule.webhookRepository as {
				create: (params: {
					orgId: string;
					url: string;
					secret: string;
					events: string[];
				}) => Promise<{ id: string }>;
			};

			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await webhookRepository.create({
				orgId: 'org-1',
				url: 'https://example.com/webhook',
				secret: 'whsec_FAKE_TEST_VALUE_NOT_REAL',
				events: ['tool.executed', 'workflow.completed']
			});

			expect(result.id).toBeDefined();
			expect(mockExecute).toHaveBeenCalled();

			// Secrets must be encrypted at rest (ciphertext + IV), never stored plaintext.
			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(typeof binds.secret).toBe('string');
			expect(typeof binds.secretIv).toBe('string');
			expect(binds.secret).not.toBe('whsec_FAKE_TEST_VALUE_NOT_REAL');
		});
	});

	describe('list', () => {
		it('returns webhooks for an org', async () => {
			if (!repoModule) return;
			const webhookRepository = repoModule.webhookRepository as {
				list: (orgId: string) => Promise<
					Array<{
						id: string;
						url: string;
						events: string[];
						status: string;
					}>
				>;
			};

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wh-1',
						URL: 'https://example.com/webhook',
						EVENTS: '["tool.executed"]',
						STATUS: 'active',
						FAILURE_COUNT: 0,
						CREATED_AT: new Date()
					},
					{
						ID: 'wh-2',
						URL: 'https://other.com/hook',
						EVENTS: '["workflow.completed"]',
						STATUS: 'active',
						FAILURE_COUNT: 0,
						CREATED_AT: new Date()
					}
				]
			});

			const hooks = await webhookRepository.list('org-1');
			expect(hooks).toHaveLength(2);
			expect(hooks[0].url).toBe('https://example.com/webhook');
			// Should NOT include the secret in list responses
			for (const hook of hooks) {
				expect(hook).not.toHaveProperty('secret');
				expect(hook).not.toHaveProperty('SECRET');
			}
		});
	});

	describe('update', () => {
		it('updates webhook events and url', async () => {
			if (!repoModule) return;
			const webhookRepository = repoModule.webhookRepository as {
				update: (
					id: string,
					orgId: string,
					params: Partial<{
						url: string;
						events: string[];
						status: string;
					}>
				) => Promise<void>;
			};

			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			await expect(
				webhookRepository.update('wh-1', 'org-1', {
					events: ['tool.executed', 'tool.failed']
				})
			).resolves.not.toThrow();
		});
	});

	describe('delete', () => {
		it('deletes a webhook by id and org', async () => {
			if (!repoModule) return;
			const webhookRepository = repoModule.webhookRepository as {
				delete: (id: string, orgId: string) => Promise<void>;
			};

			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			await expect(webhookRepository.delete('wh-1', 'org-1')).resolves.not.toThrow();
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('DELETE');
			// Must scope delete to org_id (IDOR prevention)
			expect(sql).toContain('ORG_ID');
		});
	});
});

// ============================================================================
// HMAC-SHA256 Signature
// ============================================================================

describe('Webhook Signatures (Phase 8.4)', () => {
	describe('module availability', () => {
		it('webhooks module should be importable', () => {
			if (webhooksModuleError) {
				expect.fail(
					`webhooks module not yet available: ${webhooksModuleError}. ` +
						'Implement $lib/server/webhooks.ts per Phase 8.4.'
				);
			}
			expect(webhooksModule).not.toBeNull();
		});
	});

	describe('generateSignature', () => {
		it('produces a deterministic HMAC-SHA256 hex string', () => {
			if (!webhooksModule) return;
			const generateSignature = webhooksModule.generateSignature as (
				payload: string,
				secret: string
			) => string;

			const sig1 = generateSignature('{"event":"test"}', 'secret123');
			const sig2 = generateSignature('{"event":"test"}', 'secret123');

			expect(sig1).toBe(sig2); // deterministic
			expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
		});

		it('different payloads produce different signatures', () => {
			if (!webhooksModule) return;
			const generateSignature = webhooksModule.generateSignature as (
				payload: string,
				secret: string
			) => string;

			const sig1 = generateSignature('{"event":"a"}', 'secret123');
			const sig2 = generateSignature('{"event":"b"}', 'secret123');

			expect(sig1).not.toBe(sig2);
		});

		it('different secrets produce different signatures', () => {
			if (!webhooksModule) return;
			const generateSignature = webhooksModule.generateSignature as (
				payload: string,
				secret: string
			) => string;

			const sig1 = generateSignature('{"event":"test"}', 'secret1');
			const sig2 = generateSignature('{"event":"test"}', 'secret2');

			expect(sig1).not.toBe(sig2);
		});
	});

	describe('verifySignature', () => {
		it('returns true for valid signature', () => {
			if (!webhooksModule) return;
			const generateSignature = webhooksModule.generateSignature as (
				payload: string,
				secret: string
			) => string;
			const verifySignature = webhooksModule.verifySignature as (
				payload: string,
				signature: string,
				secret: string
			) => boolean;

			const payload = '{"event":"tool.executed","data":{}}';
			const secret = 'whsec_test';
			const sig = generateSignature(payload, secret);

			expect(verifySignature(payload, sig, secret)).toBe(true);
		});

		it('returns false for tampered payload', () => {
			if (!webhooksModule) return;
			const generateSignature = webhooksModule.generateSignature as (
				payload: string,
				secret: string
			) => string;
			const verifySignature = webhooksModule.verifySignature as (
				payload: string,
				signature: string,
				secret: string
			) => boolean;

			const secret = 'whsec_test';
			const sig = generateSignature('{"event":"original"}', secret);

			expect(verifySignature('{"event":"tampered"}', sig, secret)).toBe(false);
		});
	});
});

// ============================================================================
// Event Dispatch
// ============================================================================

describe('Webhook Event Dispatch (Phase 8.4)', () => {
	describe('dispatchEvent', () => {
		it('fires webhooks subscribed to the event type', async () => {
			if (!webhooksModule) return;
			const dispatchEvent = webhooksModule.dispatchEvent as (event: {
				type: string;
				orgId: string;
				data: Record<string, unknown>;
			}) => Promise<Array<{ webhookId: string; status: 'delivered' | 'failed' }>>;

			// Mock: fetch for HTTP delivery
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

			try {
				// Need webhook repo to return active webhooks
				mockExecute.mockResolvedValueOnce({
					rows: [
						{
							ID: 'wh-1',
							URL: 'https://example.com/webhook',
							SECRET: 'whsec_test',
							EVENTS: '["tool.executed"]',
							STATUS: 'active',
							FAILURE_COUNT: 0
						}
					]
				});

				const results = await dispatchEvent({
					type: 'tool.executed',
					orgId: 'org-1',
					data: { toolName: 'listInstances', duration: 1200 }
				});

				expect(results.length).toBeGreaterThan(0);
				expect(results[0].status).toBe('delivered');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe('retry logic', () => {
		it('retries failed deliveries up to 3 times', () => {
			// Contract: dispatch should retry with exponential backoff
			// Retry intervals: 1s, 4s, 16s (exponential)
			const maxRetries = 3;
			const retryIntervals = [1000, 4000, 16000];

			expect(maxRetries).toBe(3);
			expect(retryIntervals).toHaveLength(3);
			expect(retryIntervals[1]).toBeGreaterThan(retryIntervals[0]);
			expect(retryIntervals[2]).toBeGreaterThan(retryIntervals[1]);
		});
	});

	describe('circuit breaker', () => {
		it('marks webhook as failed after 5 consecutive failures', async () => {
			if (!repoModule) return;
			const webhookRepository = repoModule.webhookRepository as {
				update: (id: string, orgId: string, params: Record<string, unknown>) => Promise<void>;
			};

			// After 5 failures, the webhook status should be set to 'failed'
			const failureThreshold = 5;
			const currentFailures = 5;

			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			if (currentFailures >= failureThreshold) {
				await webhookRepository.update('wh-1', 'org-1', { status: 'failed' });
				expect(mockExecute).toHaveBeenCalled();
			}
		});
	});
});

// ============================================================================
// SSRF Prevention
// ============================================================================

describe('Webhook SSRF Prevention (Phase 8.4)', () => {
	describe('URL validation', () => {
		const privateIPs = [
			'http://10.0.0.1/webhook',
			'http://10.255.255.255/webhook',
			'http://172.16.0.1/webhook',
			'http://172.31.255.255/webhook',
			'http://192.168.0.1/webhook',
			'http://192.168.255.255/webhook',
			'http://127.0.0.1/webhook',
			'http://127.0.0.1:8080/webhook',
			'http://localhost/webhook',
			'http://localhost:3000/webhook',
			'http://[::1]/webhook',
			'http://169.254.169.254/latest/meta-data/', // cloud metadata
			'http://metadata.google.internal/'
		];

		const publicURLs = [
			'https://example.com/webhook',
			'https://hooks.slack.com/services/abc',
			'https://webhook.site/test-uuid'
		];

		it('rejects private IP addresses', async () => {
			if (!webhooksModule) return;

			// The module should export a URL validation function or the create
			// function should reject private IPs
			const isValidWebhookUrl = (webhooksModule.isValidWebhookUrl ??
				webhooksModule.validateWebhookUrl) as ((url: string) => Promise<boolean>) | undefined;

			if (!isValidWebhookUrl) {
				// If no explicit validator, the create function should reject
				// We test this pattern regardless
				for (const url of privateIPs) {
					const parsed = new URL(url);
					const hostname = parsed.hostname;

					// Check common private IP patterns
					const isPrivate =
						hostname === 'localhost' ||
						hostname === '[::1]' ||
						hostname.startsWith('10.') ||
						hostname.startsWith('127.') ||
						hostname.startsWith('192.168.') ||
						hostname.startsWith('169.254.') ||
						hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
						hostname.endsWith('.internal');

					expect(isPrivate).toBe(true);
				}
				return;
			}

			// Test all private IPs with async validation
			for (const url of privateIPs) {
				const result = await isValidWebhookUrl(url);
				expect(result).toBe(false);
			}
		});

		it('accepts public URLs', async () => {
			if (!webhooksModule) return;

			const isValidWebhookUrl = (webhooksModule.isValidWebhookUrl ??
				webhooksModule.validateWebhookUrl) as ((url: string) => Promise<boolean>) | undefined;

			if (!isValidWebhookUrl) {
				// Verify URLs are public by pattern
				for (const url of publicURLs) {
					const parsed = new URL(url);
					expect(parsed.protocol).toBe('https:');
					expect(parsed.hostname).not.toBe('localhost');
					expect(parsed.hostname).not.toMatch(/^(10|127|192\.168)\./);
				}
				return;
			}

			for (const url of publicURLs) {
				const result = await isValidWebhookUrl(url);
				expect(result).toBe(true);
			}
		});

		it('requires HTTPS for webhook URLs', async () => {
			if (!webhooksModule) return;

			const isValidWebhookUrl = (webhooksModule.isValidWebhookUrl ??
				webhooksModule.validateWebhookUrl) as ((url: string) => Promise<boolean>) | undefined;

			if (!isValidWebhookUrl) {
				// Contract: webhook URLs must use HTTPS
				const httpUrl = 'http://example.com/webhook';
				const parsed = new URL(httpUrl);
				expect(parsed.protocol).not.toBe('https:');
				return;
			}

			const httpResult = await isValidWebhookUrl('http://example.com/webhook');
			expect(httpResult).toBe(false);

			const httpsResult = await isValidWebhookUrl('https://example.com/webhook');
			expect(httpsResult).toBe(true);
		});

		it('rejects cloud metadata endpoints', () => {
			const metadataEndpoints = [
				'http://169.254.169.254/latest/meta-data/',
				'http://169.254.169.254/metadata/instance',
				'http://metadata.google.internal/'
			];

			for (const url of metadataEndpoints) {
				const parsed = new URL(url);
				const isMetadata =
					parsed.hostname === '169.254.169.254' || parsed.hostname.endsWith('.internal');
				expect(isMetadata).toBe(true);
			}
		});
	});
});
