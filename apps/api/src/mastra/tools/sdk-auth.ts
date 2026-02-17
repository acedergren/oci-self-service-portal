/**
 * OCI SDK Authentication Provider — API layer wrapper
 *
 * Re-exports the shared OCI SDK auth utilities with a graceful fallback
 * that returns null (instead of throwing) when no valid auth config is found.
 * This allows the API to start up in degraded mode when OCI credentials are
 * not configured, rather than crashing on startup.
 *
 * Auth strategy resolution order:
 * 1. ConfigFileAuthenticationDetailsProvider (~/.oci/config)
 * 2. InstancePrincipalsAuthenticationDetailsProvider (OCI-hosted VMs)
 * 3. null with a warning log (non-OCI dev/test environments)
 */
import { createLogger } from '@portal/shared/server/logger';
import {
	type OCIAuthStrategy,
	type OCISDKAuthOptions,
	type OCIServiceName,
	type OCIClientType,
	initOCIAuth,
	getOCIAuthProvider,
	getOCIRegion,
	resetOCIAuth,
	closeAllSDKClients,
	getSDKClient
} from '@portal/shared/tools/sdk-auth';

export type { OCIAuthStrategy, OCISDKAuthOptions, OCIServiceName, OCIClientType };
export { getOCIRegion, resetOCIAuth, closeAllSDKClients, getSDKClient };

/** Opaque type alias for the OCI auth provider (avoids direct oci-sdk import in this package) */
export type OCIAuthProvider = Awaited<ReturnType<typeof initOCIAuth>>;

const log = createLogger('oci-sdk-auth');

/**
 * Get the OCI authentication provider with graceful fallback.
 *
 * - Tries ConfigFileAuthenticationDetailsProvider first (reads ~/.oci/config)
 * - Falls back to InstancePrincipalsAuthenticationDetailsProvider on OCI VMs
 * - Returns null with a warning log if neither succeeds (non-OCI environments)
 *
 * Unlike the shared `getOCIAuthProvider()`, this never throws — it returns null
 * so the API can continue operating in a degraded state without OCI credentials.
 */
export async function getOciAuthProvider(): Promise<OCIAuthProvider | null> {
	// Try config file first (standard dev environment)
	try {
		const provider = await initOCIAuth({ strategy: 'config-file' });
		return provider;
	} catch (configErr) {
		log.debug({ err: configErr }, 'OCI config file auth unavailable, trying instance principals');
	}

	// Try instance principals (OCI VMs / container instances)
	try {
		const provider = await initOCIAuth({ strategy: 'instance-principal' });
		return provider;
	} catch (instanceErr) {
		log.warn(
			{ err: instanceErr },
			'OCI instance principal auth unavailable — SDK tools will be disabled'
		);
	}

	return null;
}

/**
 * Synchronously get the cached auth provider.
 * Returns null if auth has not been initialized or initialization failed.
 *
 * Use getOciAuthProvider() to initialize; use this for subsequent calls
 * where you know auth has already been set up.
 */
export function getCachedAuthProvider(): OCIAuthProvider | null {
	try {
		return getOCIAuthProvider();
	} catch {
		return null;
	}
}
