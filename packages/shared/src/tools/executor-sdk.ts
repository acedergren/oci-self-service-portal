/**
 * OCI SDK Executor Adapter
 *
 * Replaces CLI-based executeOCI/executeOCIAsync with native SDK client calls.
 * Wraps SDK errors in OCIError for consistent error handling across the portal.
 * Re-exports slimOCIResponse and requireCompartmentId from executor.ts for backward compat.
 */
import { OCIError } from '../server/errors.js';
import { wrapWithSpan, captureError } from '../server/sentry.js';
import { type OCIServiceName, getSDKClient } from './sdk-auth.js';

// Re-export utilities that don't change between CLI and SDK
export { slimOCIResponse, requireCompartmentId, getDefaultCompartmentId } from './executor.js';

/**
 * Execute an OCI SDK operation with standardized error handling and tracing.
 *
 * @param service - OCI service name (e.g., 'compute', 'virtualNetwork')
 * @param operation - Method name on the service client (e.g., 'listInstances')
 * @param request - Request parameters for the SDK method
 * @returns The SDK response object (typically contains items array or single resource)
 *
 * @example
 * const response = await executeOCISDK('compute', 'listInstances', {
 *   compartmentId: 'ocid1.compartment...'
 * });
 * return slimOCIResponse({ data: response.items }, ['displayName', 'id', 'lifecycleState']);
 */
export async function executeOCISDK<S extends OCIServiceName>(
	service: S,
	operation: string,
	request: Record<string, unknown>
): Promise<unknown> {
	return wrapWithSpan(`oci.sdk.${service}.${operation}`, 'oci.sdk', async () => {
		try {
			const client = getSDKClient(service);

			const method = (client as Record<string, unknown>)[operation];
			if (typeof method !== 'function') {
				throw new OCIError(`Unknown SDK operation: ${service}.${operation}`, {
					service,
					operation
				});
			}

			const response = await (method as (req: unknown) => Promise<unknown>).call(client, request);

			return response;
		} catch (error: unknown) {
			// Already an OCIError — re-throw as-is
			if (error instanceof OCIError) {
				captureError(error);
				throw error;
			}

			// SDK errors have statusCode, serviceCode, message, opcRequestId
			const sdkError = error as {
				statusCode?: number;
				serviceCode?: string;
				message?: string;
				opcRequestId?: string;
				targetService?: string;
				operationName?: string;
			};

			const ociErr = new OCIError(
				sdkError.message ?? `OCI SDK error: ${service}.${operation}`,
				{
					service,
					operation,
					statusCode: sdkError.statusCode,
					serviceCode: sdkError.serviceCode,
					opcRequestId: sdkError.opcRequestId
				},
				error instanceof Error ? error : undefined
			);
			captureError(ociErr);
			throw ociErr;
		}
	});
}

/**
 * Normalize SDK response to match CLI response shape.
 *
 * The CLI returns `{ data: [...] }` or `{ data: {...} }`.
 * The SDK returns objects with `items` arrays or direct properties.
 * This function normalizes SDK responses into the `{ data: ... }` shape
 * so slimOCIResponse() can be used unchanged.
 *
 * @example
 * const sdkResponse = await executeOCISDK('compute', 'listInstances', params);
 * return slimOCIResponse(normalizeSDKResponse(sdkResponse), pickFields);
 */
export function normalizeSDKResponse(response: unknown): { data: unknown } {
	if (!response || typeof response !== 'object') {
		return { data: response };
	}

	const resp = response as Record<string, unknown>;

	// List operations return { items: [...], opcNextPage?, opcRequestId }
	if (Array.isArray(resp.items)) {
		return { data: resp.items };
	}

	// Get/Create/Update operations return the resource directly with metadata fields
	// Strip SDK metadata fields, keep the resource data
	const metaKeys = new Set(['opcRequestId', 'opcNextPage', 'opcTotalItems', 'opcWorkRequestId']);
	const dataKeys = Object.keys(resp).filter((k) => !metaKeys.has(k));

	// If there's only one non-meta key, unwrap it
	if (dataKeys.length === 1) {
		return { data: resp[dataKeys[0]] };
	}

	// Otherwise wrap only the non-meta keys
	const filtered: Record<string, unknown> = {};
	for (const k of dataKeys) {
		filtered[k] = resp[k];
	}
	return { data: filtered };
}

/**
 * Convert OCI SDK response field names from camelCase to kebab-case.
 *
 * CLI responses use kebab-case (`display-name`, `lifecycle-state`).
 * SDK responses use camelCase (`displayName`, `lifecycleState`).
 * Our slimOCIResponse pick fields are still in kebab-case for backward compat.
 * This function converts SDK camelCase keys to kebab-case to match existing pick fields.
 */
export function camelToKebab(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(camelToKebab);
	}
	if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
			result[kebabKey] = camelToKebab(value);
		}
		return result;
	}
	return obj;
}

/**
 * High-level helper: execute SDK call → normalize → convert keys → slim.
 * Drop-in replacement for the CLI pattern:
 *   return slimOCIResponse(executeOCI(cliArgs), pickFields);
 *
 * @example
 * // Before (CLI):
 * execute: (args) => slimOCIResponse(executeOCI(['compute', 'instance', 'list', ...]), pickFields)
 *
 * // After (SDK):
 * executeAsync: (args) => executeAndSlim('compute', 'listInstances', { compartmentId }, pickFields)
 */
export async function executeAndSlim(
	service: OCIServiceName,
	operation: string,
	request: Record<string, unknown>,
	pickFields: string[]
): Promise<unknown> {
	const { slimOCIResponse } = await import('./executor.js');
	const response = await executeOCISDK(service, operation, request);
	const normalized = normalizeSDKResponse(response);
	const kebabData = camelToKebab(normalized);
	return slimOCIResponse(kebabData, pickFields);
}
