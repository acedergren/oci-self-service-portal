import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock boundaries ──────────────────────────────────────────────────────────
// Mock the shared executor so we can control what it throws.
// The API-layer adapter is what we're testing: it should convert throws → SDKResult.

const mockExecuteOCISDK = vi.fn();

vi.mock('@portal/shared/tools/executor-sdk', () => ({
	executeOCISDK: (...args: unknown[]) => mockExecuteOCISDK(...args),
	normalizeSDKResponse: vi.fn((r: unknown) => ({ data: r })),
	camelToKebab: vi.fn((r: unknown) => r),
	slimOCIResponse: vi.fn((r: unknown) => r),
	requireCompartmentId: vi.fn(() => 'test-compartment'),
	getDefaultCompartmentId: vi.fn(() => 'test-compartment'),
	executeAndSlim: vi.fn().mockResolvedValue({ data: [] })
}));

// sdk-auth re-exports from shared — mock the full module path
vi.mock('@portal/shared/tools/sdk-auth', () => ({
	getSDKClient: vi.fn(),
	getOCIAuthProvider: vi.fn(),
	getOCIRegion: vi.fn(),
	resetOCIAuth: vi.fn(),
	initOCIAuth: vi.fn(),
	closeAllSDKClients: vi.fn()
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

// Import AFTER mocks are defined (avoids TDZ issues)
import { OCIError } from '@portal/types';
import {
	executeSDKOperation,
	createSDKExecutor,
	type SDKResult
} from '../../mastra/tools/executor-sdk.js';

describe('API-layer executor-sdk adapter', () => {
	beforeEach(() => {
		mockExecuteOCISDK.mockResolvedValue({ items: [] });
	});

	// ── executeSDKOperation ──────────────────────────────────────────────

	describe('executeSDKOperation', () => {
		it('returns success result when SDK call succeeds', async () => {
			const responseData = { items: [{ id: 'ocid1.instance.1', displayName: 'web' }] };
			mockExecuteOCISDK.mockResolvedValue(responseData);

			const result = await executeSDKOperation('compute', 'listInstances', {
				compartmentId: 'ocid1.compartment.test'
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(responseData);
			}
			expect(mockExecuteOCISDK).toHaveBeenCalledWith('compute', 'listInstances', {
				compartmentId: 'ocid1.compartment.test'
			});
		});

		it('returns failure result when shared executor throws OCIError', async () => {
			const ociErr = new OCIError('OCI call failed', {
				service: 'compute',
				operation: 'listInstances',
				statusCode: 403
			});
			mockExecuteOCISDK.mockRejectedValue(ociErr);

			const result = await executeSDKOperation('compute', 'listInstances', {
				compartmentId: 'test'
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(OCIError);
				expect(result.error.message).toBe('OCI call failed');
			}
		});

		it('never throws — always returns SDKResult', async () => {
			mockExecuteOCISDK.mockRejectedValue(new Error('Network timeout'));

			// If this throws, the test will fail — that's the assertion
			const result: SDKResult<unknown> = await executeSDKOperation('compute', 'listInstances', {});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(OCIError);
				expect(result.error.message).toBe('Network timeout');
			}
		});

		it('merges caller context into OCIError on failure', async () => {
			const ociErr = new OCIError('Quota exceeded', {
				service: 'compute',
				operation: 'launchInstance'
			});
			mockExecuteOCISDK.mockRejectedValue(ociErr);

			const result = await executeSDKOperation(
				'compute',
				'launchInstance',
				{ compartmentId: 'test' },
				{ toolName: 'createInstance', retryAttempt: 1 }
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.context).toMatchObject({
					service: 'compute',
					operation: 'launchInstance',
					toolName: 'createInstance',
					retryAttempt: 1
				});
			}
		});

		it('wraps non-Error thrown values in OCIError', async () => {
			mockExecuteOCISDK.mockRejectedValue('raw string error');

			const result = await executeSDKOperation('virtualNetwork', 'listVcns', {});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(OCIError);
				// Message should reference the service + operation
				expect(result.error.message).toContain('virtualNetwork');
			}
		});

		it('preserves original Error as cause in wrapped non-OCIError', async () => {
			const originalErr = new Error('Connection refused');
			mockExecuteOCISDK.mockRejectedValue(originalErr);

			const result = await executeSDKOperation('objectStorage', 'listBuckets', {});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.cause).toBe(originalErr);
			}
		});
	});

	// ── createSDKExecutor ────────────────────────────────────────────────

	describe('createSDKExecutor', () => {
		it('creates an executor bound to the given compartmentId', () => {
			const executor = createSDKExecutor({ compartmentId: 'ocid1.compartment.oc1..test' });

			expect(executor.compartmentId).toBe('ocid1.compartment.oc1..test');
			expect(executor.region).toBeUndefined();
		});

		it('stores region when provided', () => {
			const executor = createSDKExecutor({
				compartmentId: 'ocid1.compartment.oc1..test',
				region: 'eu-frankfurt-1'
			});

			expect(executor.region).toBe('eu-frankfurt-1');
		});

		it('execute() returns success result and includes compartmentId in context', async () => {
			const responseData = { items: [] };
			mockExecuteOCISDK.mockResolvedValue(responseData);

			const executor = createSDKExecutor({ compartmentId: 'ocid1.compartment.oc1..test' });
			const result = await executor.execute('compute', 'listInstances', {
				compartmentId: 'ocid1.compartment.oc1..test'
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(responseData);
			}
		});

		it('execute() returns failure when underlying call fails', async () => {
			mockExecuteOCISDK.mockRejectedValue(new OCIError('Not found', { statusCode: 404 }));

			const executor = createSDKExecutor({ compartmentId: 'ocid1.compartment.oc1..test' });
			const result = await executor.execute('compute', 'getInstance', {
				instanceId: 'ocid1.instance.missing'
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(OCIError);
				// compartmentId should be merged into error context
				expect(result.error.context).toMatchObject({
					compartmentId: 'ocid1.compartment.oc1..test'
				});
			}
		});

		it('execute() injects compartmentId into failure context automatically', async () => {
			mockExecuteOCISDK.mockRejectedValue(new OCIError('Service error', {}));

			const executor = createSDKExecutor({ compartmentId: 'ocid1.compartment.oc1..mycomp' });
			const result = await executor.execute('virtualNetwork', 'listVcns', {});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.context).toHaveProperty(
					'compartmentId',
					'ocid1.compartment.oc1..mycomp'
				);
			}
		});

		it('execute() never throws', async () => {
			mockExecuteOCISDK.mockRejectedValue(new TypeError('Cannot read property of undefined'));

			const executor = createSDKExecutor({ compartmentId: 'test' });

			// If this throws, test fails — proving the contract
			const result = await executor.execute('compute', 'listInstances', {});
			expect(result.success).toBe(false);
		});
	});

	// ── SDKResult type narrowing ─────────────────────────────────────────

	describe('SDKResult type narrowing', () => {
		it('success branch carries typed data', async () => {
			type InstanceList = { items: Array<{ id: string }> };
			mockExecuteOCISDK.mockResolvedValue({ items: [{ id: 'ocid1.instance.1' }] });

			const result = await executeSDKOperation<InstanceList>('compute', 'listInstances', {
				compartmentId: 'test'
			});

			if (result.success) {
				// TypeScript ensures result.data is InstanceList here
				expect(result.data.items[0].id).toBe('ocid1.instance.1');
			} else {
				expect.fail('Expected success result');
			}
		});

		it('failure branch has no data property', async () => {
			mockExecuteOCISDK.mockRejectedValue(new OCIError('fail', {}));

			const result = await executeSDKOperation('compute', 'listInstances', {});

			if (!result.success) {
				// TypeScript ensures result.error is OCIError here
				expect(result.error.code).toBe('OCI_ERROR');
				// 'data' should not exist on the failure branch
				expect('data' in result).toBe(false);
			}
		});
	});
});
