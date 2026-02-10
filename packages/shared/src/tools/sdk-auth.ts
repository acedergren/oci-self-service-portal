/**
 * OCI SDK Authentication Provider
 *
 * Configures and caches OCI SDK authentication for use across all service clients.
 * Supports config-file auth (dev), instance principals (OCI VMs), and
 * resource principals (OCI Functions/Containers).
 */
import * as oci from 'oci-sdk';
import { createLogger } from '../server/logger.js';

const log = createLogger('oci-sdk-auth');

/** Supported OCI authentication strategies */
export type OCIAuthStrategy = 'config-file' | 'instance-principal' | 'resource-principal';

export interface OCISDKAuthOptions {
	/** Auth strategy to use. Auto-detected from environment if not specified. */
	strategy?: OCIAuthStrategy;
	/** Config file path. Only used with 'config-file' strategy. Defaults to ~/.oci/config */
	configFilePath?: string;
	/** Config profile name. Defaults to 'DEFAULT' */
	profile?: string;
	/** Override region (otherwise from config/IMDS) */
	region?: string;
}

/**
 * Cached auth provider singleton.
 * The OCI SDK provider reads config/certs once and reuses them for all clients.
 */
let cachedProvider: oci.common.AuthenticationDetailsProvider | null = null;
let cachedRegion: string | null = null;

/**
 * Initialize the OCI SDK authentication provider.
 * Call this once at app startup before any SDK calls.
 * Instance/resource principal strategies require async init (IMDS calls).
 */
export async function initOCIAuth(
	options: OCISDKAuthOptions = {}
): Promise<oci.common.AuthenticationDetailsProvider> {
	if (cachedProvider) return cachedProvider;

	const strategy = options.strategy ?? detectAuthStrategy();

	switch (strategy) {
		case 'instance-principal':
			log.info('Using instance principal authentication');
			cachedProvider =
				await new oci.common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
			break;

		case 'resource-principal':
			log.info('Using resource principal authentication');
			cachedProvider = await oci.common.ResourcePrincipalAuthenticationDetailsProvider.builder();
			break;

		case 'config-file':
		default: {
			const profile = options.profile ?? process.env.OCI_CLI_PROFILE ?? 'DEFAULT';
			const configPath = options.configFilePath ?? undefined;
			log.info(
				{ profile, configPath: configPath ?? '~/.oci/config' },
				'Using config file authentication'
			);
			cachedProvider = new oci.common.ConfigFileAuthenticationDetailsProvider(configPath, profile);
			break;
		}
	}

	if (options.region) {
		cachedRegion = options.region;
	}

	return cachedProvider;
}

/**
 * Synchronous initializer for config-file auth only (dev convenience).
 * For instance/resource principal auth, use initOCIAuth() instead.
 */
export function initOCIAuthSync(
	options: Omit<OCISDKAuthOptions, 'strategy'> = {}
): oci.common.AuthenticationDetailsProvider {
	if (cachedProvider) return cachedProvider;

	const profile = options.profile ?? process.env.OCI_CLI_PROFILE ?? 'DEFAULT';
	const configPath = options.configFilePath ?? undefined;
	log.info(
		{ profile, configPath: configPath ?? '~/.oci/config' },
		'Using config file authentication (sync)'
	);
	cachedProvider = new oci.common.ConfigFileAuthenticationDetailsProvider(configPath, profile);

	if (options.region) {
		cachedRegion = options.region;
	}

	return cachedProvider;
}

/**
 * Get the cached auth provider. Auto-initializes with config-file strategy if not yet set.
 */
export function getOCIAuthProvider(): oci.common.AuthenticationDetailsProvider {
	if (!cachedProvider) {
		return initOCIAuthSync();
	}
	return cachedProvider;
}

/**
 * Get the configured OCI region.
 */
export function getOCIRegion(): string | undefined {
	return cachedRegion ?? process.env.OCI_CLI_REGION ?? process.env.OCI_REGION ?? undefined;
}

/**
 * Reset the cached provider (for testing or re-initialization).
 */
export function resetOCIAuth(): void {
	cachedProvider = null;
	cachedRegion = null;
	clientCache.clear();
}

// ── SDK Client Factory ──────────────────────────────────────────────────

/**
 * Map of service names to their SDK namespace and client class.
 * Each factory creates a new client with the cached auth provider.
 */
const CLIENT_MAP = {
	compute: () =>
		new oci.core.ComputeClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	virtualNetwork: () =>
		new oci.core.VirtualNetworkClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	blockstorage: () =>
		new oci.core.BlockstorageClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	objectStorage: () =>
		new oci.objectstorage.ObjectStorageClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	database: () =>
		new oci.database.DatabaseClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	identity: () =>
		new oci.identity.IdentityClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	monitoring: () =>
		new oci.monitoring.MonitoringClient({ authenticationDetailsProvider: getOCIAuthProvider() }),
	loadBalancer: () =>
		new oci.loadbalancer.LoadBalancerClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	networkLoadBalancer: () =>
		new oci.networkloadbalancer.NetworkLoadBalancerClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	containerEngine: () =>
		new oci.containerengine.ContainerEngineClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	logging: () =>
		new oci.logging.LoggingManagementClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	logSearch: () =>
		new oci.loggingsearch.LogSearchClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	resourceSearch: () =>
		new oci.resourcesearch.ResourceSearchClient({
			authenticationDetailsProvider: getOCIAuthProvider()
		}),
	usageApi: () =>
		new oci.usageapi.UsageapiClient({ authenticationDetailsProvider: getOCIAuthProvider() })
} as const;

export type OCIServiceName = keyof typeof CLIENT_MAP;

/** Return type for each service client */
export type OCIClientType<S extends OCIServiceName> = ReturnType<(typeof CLIENT_MAP)[S]>;

/** Cached client instances (one per service) */
const clientCache = new Map<OCIServiceName, unknown>();

/**
 * Get a typed OCI SDK client for the given service.
 * Clients are created lazily and cached for the lifetime of the process.
 *
 * @example
 * const computeClient = getSDKClient('compute');
 * const result = await computeClient.listInstances({ compartmentId: '...' });
 */
export function getSDKClient<S extends OCIServiceName>(service: S): OCIClientType<S> {
	let client = clientCache.get(service);
	if (!client) {
		const factory = CLIENT_MAP[service];
		client = factory();

		// Apply region override if configured
		const region = getOCIRegion();
		if (region && typeof (client as { region?: string }).region === 'string') {
			(client as { region: string }).region = region;
		}

		clientCache.set(service, client);
		log.debug({ service }, 'Created OCI SDK client');
	}
	return client as OCIClientType<S>;
}

/**
 * Close all cached SDK clients (for graceful shutdown).
 */
export async function closeAllSDKClients(): Promise<void> {
	for (const [service, client] of clientCache.entries()) {
		try {
			if (client && typeof (client as { close?: () => void }).close === 'function') {
				(client as { close: () => void }).close();
			}
		} catch (err) {
			log.warn({ service, err }, 'Error closing SDK client');
		}
	}
	clientCache.clear();
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Auto-detect the best auth strategy based on environment.
 */
function detectAuthStrategy(): OCIAuthStrategy {
	if (process.env.OCI_RESOURCE_PRINCIPAL_VERSION) {
		return 'resource-principal';
	}
	if (process.env.OCI_INSTANCE_PRINCIPAL) {
		return 'instance-principal';
	}
	return 'config-file';
}
