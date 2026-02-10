import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock boundaries ─────────────────────────────────────────────────────
// Mock getSDKClient (the function executeOCISDK calls internally)
// rather than the entire oci-sdk package. This avoids mockReset issues
// with constructor mocks, and tests the adapter logic in isolation.

const mockClient: Record<string, vi.Mock> = {};

vi.mock('@portal/shared/tools/sdk-auth', () => ({
	getSDKClient: (...args: unknown[]) => mockGetSDKClient(...args),
	getOCIAuthProvider: vi.fn(),
	getOCIRegion: vi.fn(),
	resetOCIAuth: vi.fn(),
	initOCIAuth: vi.fn(),
	initOCIAuthSync: vi.fn(),
	closeAllSDKClients: vi.fn()
}));

vi.mock('@portal/shared/server/sentry', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
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

const mockGetSDKClient = vi.fn(() => mockClient);

import {
	executeOCISDK,
	normalizeSDKResponse,
	camelToKebab,
	executeAndSlim
} from '@portal/shared/tools/executor-sdk';

// Import OCIError from the same alias that executor-sdk uses internally
import { OCIError } from '@portal/shared/server/errors';

describe('executor-sdk', () => {
	beforeEach(() => {
		// Reset the shared mock client
		for (const key of Object.keys(mockClient)) {
			delete mockClient[key];
		}
		mockClient.listInstances = vi.fn();
		mockClient.getInstance = vi.fn();
		mockClient.close = vi.fn();
		mockGetSDKClient.mockReturnValue(mockClient);
	});

	// ── executeOCISDK ───────────────────────────────────────────────────

	describe('executeOCISDK', () => {
		it('calls the correct SDK client method and returns the response', async () => {
			const mockResponse = {
				items: [{ id: 'ocid1.instance.1', displayName: 'web-server' }],
				opcRequestId: 'req-123'
			};
			mockClient.listInstances.mockResolvedValue(mockResponse);

			const result = await executeOCISDK('compute', 'listInstances', {
				compartmentId: 'ocid1.compartment.test'
			});

			expect(result).toEqual(mockResponse);
			expect(mockClient.listInstances).toHaveBeenCalledWith({
				compartmentId: 'ocid1.compartment.test'
			});
			expect(mockGetSDKClient).toHaveBeenCalledWith('compute');
		});

		it('wraps SDK errors in OCIError with service context', async () => {
			const sdkError = Object.assign(new Error('Not authorized'), {
				statusCode: 401,
				serviceCode: 'NotAuthenticated',
				opcRequestId: 'req-456'
			});
			mockClient.listInstances.mockRejectedValue(sdkError);

			try {
				await executeOCISDK('compute', 'listInstances', { compartmentId: 'test' });
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(OCIError);
				const ociErr = err as OCIError;
				expect(ociErr.context).toMatchObject({
					service: 'compute',
					operation: 'listInstances',
					statusCode: 401,
					serviceCode: 'NotAuthenticated',
					opcRequestId: 'req-456'
				});
			}
		});

		it('re-throws existing OCIError without double-wrapping', async () => {
			const original = new OCIError('Already wrapped', { custom: 'context' });
			mockClient.getInstance.mockRejectedValue(original);

			try {
				await executeOCISDK('compute', 'getInstance', { instanceId: 'test' });
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBe(original);
				expect((err as OCIError).message).toBe('Already wrapped');
				expect((err as OCIError).context).toHaveProperty('custom', 'context');
			}
		});

		it('throws OCIError for unknown operation', async () => {
			await expect(executeOCISDK('compute', 'nonExistentMethod', {})).rejects.toThrow(
				/Unknown SDK operation: compute.nonExistentMethod/
			);
		});

		it('handles non-Error thrown values', async () => {
			mockClient.listInstances.mockRejectedValue('string error');

			try {
				await executeOCISDK('compute', 'listInstances', {});
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(OCIError);
			}
		});
	});

	// ── normalizeSDKResponse ────────────────────────────────────────────

	describe('normalizeSDKResponse', () => {
		it('normalizes list responses (items array)', () => {
			const sdkResponse = {
				items: [
					{ id: '1', displayName: 'server-1' },
					{ id: '2', displayName: 'server-2' }
				],
				opcRequestId: 'req-789'
			};

			const result = normalizeSDKResponse(sdkResponse);
			expect(result).toEqual({
				data: [
					{ id: '1', displayName: 'server-1' },
					{ id: '2', displayName: 'server-2' }
				]
			});
		});

		it('normalizes single-resource get responses', () => {
			const sdkResponse = {
				instance: { id: '1', displayName: 'server-1' },
				opcRequestId: 'req-101'
			};

			const result = normalizeSDKResponse(sdkResponse);
			expect(result).toEqual({
				data: { id: '1', displayName: 'server-1' }
			});
		});

		it('wraps multi-key responses, stripping SDK metadata', () => {
			const sdkResponse = {
				bucket: { name: 'my-bucket' },
				namespace: 'my-namespace',
				opcRequestId: 'req-102'
			};

			const result = normalizeSDKResponse(sdkResponse);
			expect(result.data).toEqual({
				bucket: { name: 'my-bucket' },
				namespace: 'my-namespace'
			});
			// opcRequestId should be stripped
			expect(result.data).not.toHaveProperty('opcRequestId');
		});

		it('handles null/undefined response', () => {
			expect(normalizeSDKResponse(null)).toEqual({ data: null });
			expect(normalizeSDKResponse(undefined)).toEqual({ data: undefined });
		});

		it('handles empty items array', () => {
			const result = normalizeSDKResponse({ items: [], opcRequestId: 'req-103' });
			expect(result).toEqual({ data: [] });
		});
	});

	// ── camelToKebab ────────────────────────────────────────────────────

	describe('camelToKebab', () => {
		it('converts camelCase keys to kebab-case', () => {
			const input = {
				displayName: 'web-server',
				lifecycleState: 'RUNNING',
				timeCreated: '2026-01-15T00:00:00Z'
			};

			const result = camelToKebab(input);
			expect(result).toEqual({
				'display-name': 'web-server',
				'lifecycle-state': 'RUNNING',
				'time-created': '2026-01-15T00:00:00Z'
			});
		});

		it('converts nested objects recursively', () => {
			const input = {
				shapeConfig: {
					ocpus: 4,
					memoryInGbs: 64
				}
			};

			const result = camelToKebab(input) as Record<string, unknown>;
			expect(result['shape-config']).toEqual({
				ocpus: 4,
				'memory-in-gbs': 64
			});
		});

		it('converts arrays of objects', () => {
			const input = [
				{ displayName: 'a', lifecycleState: 'RUNNING' },
				{ displayName: 'b', lifecycleState: 'STOPPED' }
			];

			const result = camelToKebab(input) as Record<string, unknown>[];
			expect(result[0]).toEqual({
				'display-name': 'a',
				'lifecycle-state': 'RUNNING'
			});
		});

		it('handles already-lowercase keys', () => {
			const input = { id: '123', name: 'test' };
			expect(camelToKebab(input)).toEqual({ id: '123', name: 'test' });
		});

		it('passes through primitive values', () => {
			expect(camelToKebab('hello')).toBe('hello');
			expect(camelToKebab(42)).toBe(42);
			expect(camelToKebab(null)).toBe(null);
		});

		it('preserves Date objects', () => {
			const date = new Date('2026-01-01');
			expect(camelToKebab(date)).toBe(date);
		});
	});

	// ── executeAndSlim ──────────────────────────────────────────────────

	describe('executeAndSlim', () => {
		it('executes SDK call, normalizes, and slims response', async () => {
			mockClient.listInstances.mockResolvedValue({
				items: [
					{
						id: 'ocid1.instance.1',
						displayName: 'web-server',
						lifecycleState: 'RUNNING',
						shape: 'VM.Standard.E4.Flex',
						internalField: 'should-be-excluded'
					}
				],
				opcRequestId: 'req-200'
			});

			const result = await executeAndSlim(
				'compute',
				'listInstances',
				{ compartmentId: 'ocid1.compartment.test' },
				['display-name', 'id', 'lifecycle-state', 'shape']
			);

			const data = (result as { data: Record<string, unknown>[] }).data;
			expect(data).toHaveLength(1);
			expect(data[0]).toEqual({
				'display-name': 'web-server',
				id: 'ocid1.instance.1',
				'lifecycle-state': 'RUNNING',
				shape: 'VM.Standard.E4.Flex'
			});
			// internal-field should NOT be present
			expect(data[0]).not.toHaveProperty('internal-field');
		});

		it('handles empty results from SDK', async () => {
			mockClient.listInstances.mockResolvedValue({
				items: [],
				opcRequestId: 'req-201'
			});

			const result = await executeAndSlim('compute', 'listInstances', { compartmentId: 'test' }, [
				'display-name'
			]);

			const data = (result as { data: unknown[] }).data;
			expect(data).toEqual([]);
		});

		it('propagates OCIError from failed SDK call', async () => {
			mockClient.listInstances.mockRejectedValue(
				Object.assign(new Error('Service unavailable'), {
					statusCode: 503,
					serviceCode: 'InternalError'
				})
			);

			await expect(
				executeAndSlim('compute', 'listInstances', { compartmentId: 'test' }, [])
			).rejects.toThrow(OCIError);
		});
	});
});
