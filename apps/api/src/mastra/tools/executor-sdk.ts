/**
 * OCI SDK Executor Adapter — API layer
 *
 * Wraps the shared `executeOCISDK` (which throws OCIError) with a
 * Result-type interface that never throws, making it easier to compose
 * multi-step tool operations without try/catch at every call site.
 *
 * Two-layer design:
 * - packages/shared/src/tools/executor-sdk.ts  → throws OCIError (framework-agnostic)
 * - apps/api/src/mastra/tools/executor-sdk.ts  → returns SDKResult<T> (API-layer convenience)
 */
import { OCIError } from '@portal/types';
import { executeOCISDK } from '@portal/shared/tools/executor-sdk';
import { type OCIServiceName } from './sdk-auth.js';

// Re-export utilities consumers may also need
export { normalizeSDKResponse, camelToKebab } from '@portal/shared/tools/executor-sdk';
export type { OCIServiceName };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for creating a bound SDK executor. */
export type SDKExecutorOptions = {
	/** OCI compartment OCID to bind this executor to. */
	compartmentId: string;
	/** Optional OCI region override (e.g. 'eu-frankfurt-1'). */
	region?: string;
};

/**
 * Discriminated union result — never throws.
 * Success carries typed data; failure carries a structured OCIError.
 */
export type SDKResult<T> = { success: true; data: T } | { success: false; error: OCIError };

// ---------------------------------------------------------------------------
// Core adapter
// ---------------------------------------------------------------------------

/**
 * Execute an OCI SDK operation and return a `SDKResult<T>` instead of throwing.
 *
 * Catches `OCIError` from the shared executor and maps it into the failure branch.
 * Non-OCIError exceptions (e.g. programming errors) are still wrapped in OCIError.
 *
 * @param service  - OCI service name (e.g. 'compute', 'virtualNetwork')
 * @param operation - Method name on the service client (e.g. 'listInstances')
 * @param request  - Request parameters for the SDK method
 * @param context  - Additional metadata logged on failure
 *
 * @example
 * const result = await executeSDKOperation('compute', 'listInstances', { compartmentId });
 * if (!result.success) {
 *   log.warn({ err: result.error }, 'OCI list failed');
 *   return fallback;
 * }
 * return slimOCIResponse(normalizeSDKResponse(result.data), pickFields);
 */
export async function executeSDKOperation<T>(
	service: OCIServiceName,
	operation: string,
	request: Record<string, unknown>,
	context: Record<string, unknown> = {}
): Promise<SDKResult<T>> {
	try {
		const data = (await executeOCISDK(service, operation, request)) as T;
		return { success: true, data };
	} catch (err) {
		if (err instanceof OCIError) {
			// Merge caller context into the existing error context
			const enriched = new OCIError(err.message, { ...err.context, ...context }, err.cause);
			return { success: false, error: enriched };
		}

		// Non-OCIError — wrap for a consistent failure branch
		const cause = err instanceof Error ? err : undefined;
		const message = cause?.message ?? `Unexpected error in ${service}.${operation}`;
		return {
			success: false,
			error: new OCIError(message, { service, operation, ...context }, cause)
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an SDK executor bound to a specific compartment.
 *
 * Useful when a tool always operates against the same compartment — avoids
 * passing `compartmentId` on every call.
 *
 * @example
 * const executor = createSDKExecutor({ compartmentId: 'ocid1.compartment...' });
 * const result = await executor.execute<ListInstancesResponse>(
 *   'compute', 'listInstances', { compartmentId: executor.compartmentId }
 * );
 */
export function createSDKExecutor(options: SDKExecutorOptions): {
	/** Execute an OCI SDK operation, returning SDKResult<T> (never throws). */
	execute<T>(
		service: OCIServiceName,
		operation: string,
		request: Record<string, unknown>,
		context?: Record<string, unknown>
	): Promise<SDKResult<T>>;
	/** The compartment OCID this executor is bound to. */
	compartmentId: string;
	/** The region override, if any. */
	region?: string;
} {
	return {
		compartmentId: options.compartmentId,
		region: options.region,

		execute<T>(
			service: OCIServiceName,
			operation: string,
			request: Record<string, unknown>,
			context: Record<string, unknown> = {}
		): Promise<SDKResult<T>> {
			return executeSDKOperation<T>(service, operation, request, {
				compartmentId: options.compartmentId,
				...context
			});
		}
	};
}
