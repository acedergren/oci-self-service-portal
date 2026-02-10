/**
 * Zod schemas and TypeScript types for MCP (Model Context Protocol) server management.
 *
 * Naming convention (matches admin types.ts pattern):
 * - FooSchema  : Zod schema object  (runtime validation)
 * - Foo        : Inferred TS type   (compile-time checking)
 *
 * MCP Server Management:
 * - Catalog items: Pre-configured MCP servers available for installation
 * - Custom servers: User-configured MCP servers with transport-specific settings
 * - Credentials: Encrypted API keys/tokens required by catalog items
 * - Tool/resource cache: Discovered capabilities from connected servers
 * - Metrics: Tool call tracking and performance monitoring
 */
import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

export const McpServerTypeSchema = z.enum(['catalog', 'custom']);
export type McpServerType = z.infer<typeof McpServerTypeSchema>;

export const McpTransportTypeSchema = z.enum(['stdio', 'sse', 'http']);
export type McpTransportType = z.infer<typeof McpTransportTypeSchema>;

export const McpServerStatusSchema = z.enum(['connected', 'disconnected', 'error', 'connecting']);
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const McpDockerStatusSchema = z.enum(['running', 'stopped', 'starting', 'error']);
export type McpDockerStatus = z.infer<typeof McpDockerStatusSchema>;

// ============================================================================
// Catalog Credential Requirement Schema
// ============================================================================

/**
 * Describes a credential required by a catalog MCP server.
 * Catalog items define what credentials they need, and users provide values during installation.
 */
export const CatalogCredentialRequirementSchema = z.object({
	/** Machine-readable credential key (e.g., "api_key", "github_token") */
	key: z.string(),
	/** Human-readable label shown in UI (e.g., "API Key", "GitHub Personal Access Token") */
	displayName: z.string(),
	/** Help text explaining how to obtain this credential */
	description: z.string(),
	/** Input type hint for UI rendering */
	type: z.enum(['token', 'api_key', 'url', 'text', 'password'])
});
export type CatalogCredentialRequirement = z.infer<typeof CatalogCredentialRequirementSchema>;

// ============================================================================
// Server Config Schema
// ============================================================================

/**
 * Transport-specific configuration for MCP servers.
 * Only relevant fields for the selected transport type should be populated.
 */
export const McpServerConfigSchema = z.object({
	/** Transport type (overrides server-level transportType if specified) */
	transport: McpTransportTypeSchema.optional(),
	/** SSE/HTTP endpoint URL */
	url: z.string().optional(),
	/** stdio: Command to execute (e.g., "npx", "node", "python") */
	command: z.string().optional(),
	/** stdio: Command arguments */
	args: z.array(z.string()).optional(),
	/** stdio: Environment variables for subprocess */
	env: z.record(z.string(), z.string()).optional(),
	/** SSE/HTTP: Request headers (e.g., Authorization) */
	headers: z.record(z.string(), z.string()).optional(),
	/** stdio: File paths the server is allowed to access (security constraint) */
	allowedPaths: z.array(z.string()).optional()
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// ============================================================================
// MCP Catalog Item Schema
// ============================================================================

/**
 * Catalog entry for pre-configured MCP servers.
 * Defines Docker image, required credentials, and default configuration.
 */
export const McpCatalogItemSchema = z.object({
	id: z.string().uuid(),
	/** Unique catalog identifier (e.g., "github", "filesystem", "postgres") */
	catalogId: z.string().min(1).max(100),
	/** Human-readable name shown in UI */
	displayName: z.string().min(1).max(255),
	/** Multi-line description of server capabilities */
	description: z.string(),
	/** Catalog section (e.g., "Code", "Data", "Cloud", "Communication") */
	category: z.string().max(100),
	/** Icon URL for UI display */
	iconUrl: z.string().url().max(1024).nullable().optional(),
	/** Link to external documentation */
	documentationUrl: z.string().url().max(2000).nullable().optional(),
	/** Docker image name (e.g., "mcp/github-server") */
	dockerImage: z.string().max(500).nullable().optional(),
	/** Docker image tag (e.g., "latest", "v1.2.0") */
	dockerTag: z.string().max(100).default('latest'),
	/** Default transport-specific configuration (JSON) */
	defaultConfig: McpServerConfigSchema,
	/** Credentials required by this server (empty array if none) */
	requiredCredentials: z.array(CatalogCredentialRequirementSchema),
	/** Whether server provides tools (most do) */
	supportsTools: z.boolean().default(true),
	/** Whether server provides resources (files, prompts, etc.) */
	supportsResources: z.boolean().default(false),
	/** Show prominently in catalog UI */
	isFeatured: z.boolean().default(false),
	/** Display order in catalog (lower = earlier) */
	sortOrder: z.number().int().default(0),
	/** Search tags (e.g., ["github", "git", "version-control"]) */
	tags: z.array(z.string()),
	/** Catalog item lifecycle status */
	status: z.enum(['active', 'deprecated', 'preview']).default('active'),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type McpCatalogItem = z.infer<typeof McpCatalogItemSchema>;

// ============================================================================
// MCP Server Schema
// ============================================================================

/**
 * Installed MCP server instance (catalog-based or custom).
 * Represents a running or configured server that provides tools/resources.
 */
export const McpServerSchema = z.object({
	id: z.string().uuid(),
	/** Organization owning this server (IDOR prevention) */
	orgId: z.string().max(36),
	/** Unique server name within org (URL-safe identifier) */
	serverName: z.string().min(1).max(100),
	/** Human-readable display name */
	displayName: z.string().min(1).max(255),
	/** Admin notes about this server instance */
	description: z.string().optional(),
	/** Source: catalog installation or custom configuration */
	serverType: McpServerTypeSchema,
	/** Transport protocol used for communication */
	transportType: McpTransportTypeSchema,
	/** Reference to catalog item (null for custom servers) */
	catalogItemId: z.string().uuid().nullable().optional(),
	/** Transport-specific configuration (stdio command/args, SSE URL, etc.) */
	config: McpServerConfigSchema,
	/** Docker image name (for catalog servers running in containers) */
	dockerImage: z.string().max(500).nullable().optional(),
	/** Docker container ID (populated when server is running) */
	dockerContainerId: z.string().max(100).nullable().optional(),
	/** Docker container runtime status */
	dockerStatus: McpDockerStatusSchema.nullable().optional(),
	/** MCP protocol connection status */
	status: McpServerStatusSchema.default('disconnected'),
	/** Whether server is active (can be disabled without deleting) */
	enabled: z.boolean().default(true),
	/** Last successful connection timestamp */
	lastConnectedAt: z.date().nullable().optional(),
	/** Most recent error message (cleared on successful connection) */
	lastError: z.string().max(2000).nullable().optional(),
	/** Health check result (JSON: { healthy: boolean, latencyMs?: number }) */
	healthStatus: z.record(z.string(), z.unknown()).nullable().optional(),
	/** User-defined tags for organization */
	tags: z.array(z.string()),
	/** Display order in server list */
	sortOrder: z.number().int().default(0),
	/** Number of tools discovered (denormalized for list views) */
	toolCount: z.number().int().nonnegative().default(0),
	/** Decrypted credentials (only populated in getById, never in list) */
	credentials: z
		.array(
			z.object({
				key: z.string(),
				displayName: z.string(),
				value: z.string(),
				type: z.string()
			})
		)
		.optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Decrypted credential returned by getById() operations.
 * NEVER include in list operations to prevent secret leakage.
 */
export const DecryptedCredentialSchema = z.object({
	key: z.string(),
	displayName: z.string(),
	value: z.string(),
	type: z.string()
});
export type DecryptedCredential = z.infer<typeof DecryptedCredentialSchema>;

// ============================================================================
// Cached Tool Schema
// ============================================================================

/**
 * Tool discovered from an MCP server via protocol negotiation.
 * Cached in Oracle to avoid re-discovery on every connection.
 */
export const CachedToolSchema = z.object({
	id: z.string().uuid(),
	/** Foreign key to mcp_servers */
	serverId: z.string().uuid(),
	/** Tool name as reported by MCP server (e.g., "github_create_issue") */
	toolName: z.string().min(1).max(255),
	/** Human-readable tool description */
	toolDescription: z.string(),
	/** JSON Schema for tool input parameters */
	inputSchema: z.record(z.string(), z.unknown()),
	/** When this tool was last seen during discovery */
	discoveredAt: z.date()
});
export type CachedTool = z.infer<typeof CachedToolSchema>;

// ============================================================================
// Cached Resource Schema
// ============================================================================

/**
 * Resource (file, prompt, etc.) exposed by an MCP server.
 * Cached to avoid protocol round-trips when listing available resources.
 */
export const CachedResourceSchema = z.object({
	id: z.string().uuid(),
	/** Foreign key to mcp_servers */
	serverId: z.string().uuid(),
	/** Resource URI (e.g., "file:///path/to/file", "prompt://system-prompt") */
	resourceUri: z.string().min(1).max(2000),
	/** Human-readable resource name */
	resourceName: z.string().max(255),
	/** Optional description of resource content */
	description: z.string().nullable().optional(),
	/** MIME type (e.g., "text/plain", "application/json", null if unknown) */
	mimeType: z.string().max(100).nullable().optional(),
	/** When this resource was last seen during discovery */
	discoveredAt: z.date()
});
export type CachedResource = z.infer<typeof CachedResourceSchema>;

// ============================================================================
// Tool Call Metric Schema
// ============================================================================

/**
 * Individual tool call measurement for performance tracking.
 * Recorded for every tool invocation (success or failure).
 */
export const ToolCallMetricSchema = z.object({
	/** Foreign key to mcp_servers */
	serverId: z.string().uuid(),
	/** Organization context (for usage billing/quotas) */
	orgId: z.string().max(36),
	/** Tool name that was invoked */
	toolName: z.string().max(255),
	/** Execution time in milliseconds */
	durationMs: z.number().int().nonnegative(),
	/** Whether the call completed successfully */
	success: z.boolean(),
	/** Error message if success=false */
	errorMessage: z.string().max(2000).nullable().optional()
});
export type ToolCallMetric = z.infer<typeof ToolCallMetricSchema>;

// ============================================================================
// Metrics Summary Schema
// ============================================================================

/**
 * Aggregated metrics for a server or time period.
 * Computed from mcp_metrics table for dashboard display.
 */
export const MetricsSummarySchema = z.object({
	totalCalls: z.number().int().nonnegative(),
	successCount: z.number().int().nonnegative(),
	failureCount: z.number().int().nonnegative(),
	avgDurationMs: z.number().nonnegative(),
	toolBreakdown: z.array(
		z.object({
			toolName: z.string(),
			calls: z.number().int().nonnegative(),
			avgMs: z.number().nonnegative(),
			successRate: z.number().min(0).max(1)
		})
	)
});
export type MetricsSummary = z.infer<typeof MetricsSummarySchema>;

// ============================================================================
// Input Schemas — for API endpoints
// ============================================================================

/**
 * Input for creating a custom MCP server (not from catalog).
 */
export const CreateMcpServerInputSchema = z.object({
	serverName: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, 'Server name must be lowercase alphanumeric with hyphens'),
	displayName: z.string().min(1).max(255),
	description: z.string().optional(),
	serverType: McpServerTypeSchema,
	transportType: McpTransportTypeSchema,
	config: McpServerConfigSchema,
	dockerImage: z.string().max(500).optional(),
	tags: z.array(z.string()).optional(),
	sortOrder: z.number().int().default(0)
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInputSchema>;

/**
 * Input for updating an existing MCP server.
 * All fields optional (partial update), cannot change serverName.
 */
export const UpdateMcpServerInputSchema = CreateMcpServerInputSchema.partial().omit({
	serverName: true
});
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInputSchema>;

/**
 * Input for installing an MCP server from the catalog.
 */
export const InstallFromCatalogInputSchema = z.object({
	catalogItemId: z.string().uuid(),
	serverName: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, 'Server name must be lowercase alphanumeric with hyphens'),
	displayName: z.string().min(1).max(255).optional(),
	/** Credentials as key-value pairs (keys must match catalogItem.requiredCredentials) */
	credentials: z.record(z.string(), z.string()).optional()
});
export type InstallFromCatalogInput = z.infer<typeof InstallFromCatalogInputSchema>;

/**
 * Input for setting a single credential value (encrypted storage).
 */
export const SetCredentialInputSchema = z.object({
	value: z.string().min(1),
	displayName: z.string().optional(),
	credentialType: z.string().min(1)
});
export type SetCredentialInput = z.infer<typeof SetCredentialInputSchema>;

/**
 * Input for testing a tool invocation.
 */
export const TestToolInputSchema = z.object({
	args: z.record(z.string(), z.unknown()).default({})
});
export type TestToolInput = z.infer<typeof TestToolInputSchema>;

// ============================================================================
// Oracle Row Interfaces (UPPERCASE keys from OUT_FORMAT_OBJECT)
// ============================================================================

export interface McpCatalogRow {
	ID: string;
	CATALOG_ID: string;
	DISPLAY_NAME: string;
	DESCRIPTION: string;
	CATEGORY: string;
	ICON_URL: string | null;
	DOCUMENTATION_URL: string | null;
	DOCKER_IMAGE: string | null;
	DOCKER_TAG: string;
	DEFAULT_CONFIG: string; // JSON string → McpServerConfig
	REQUIRED_CREDENTIALS: string | null; // JSON string → CatalogCredentialRequirement[]
	SUPPORTS_TOOLS: number; // 1 or 0
	SUPPORTS_RESOURCES: number; // 1 or 0
	IS_FEATURED: number; // 1 or 0
	SORT_ORDER: number;
	TAGS: string | null; // JSON string → string[]
	STATUS: string;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

export interface McpServerRow {
	ID: string;
	ORG_ID: string;
	SERVER_NAME: string;
	DISPLAY_NAME: string;
	DESCRIPTION: string | null;
	SERVER_TYPE: string;
	TRANSPORT_TYPE: string;
	CATALOG_ITEM_ID: string | null;
	CONFIG: string; // JSON string → McpServerConfig
	DOCKER_IMAGE: string | null;
	DOCKER_CONTAINER_ID: string | null;
	DOCKER_STATUS: string | null;
	STATUS: string;
	ENABLED: number; // 1 or 0
	LAST_CONNECTED_AT: Date | null;
	LAST_ERROR: string | null;
	HEALTH_STATUS: string | null; // JSON string → Record<string, unknown>
	TAGS: string | null; // JSON string → string[]
	SORT_ORDER: number;
	TOOL_COUNT: number;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

export interface McpCredentialRow {
	ID: string;
	SERVER_ID: string;
	CREDENTIAL_KEY: string;
	DISPLAY_NAME: string;
	CREDENTIAL_TYPE: string;
	VALUE_ENC: Buffer; // Encrypted value
	VALUE_IV: Buffer; // AES-GCM IV
	VALUE_TAG: Buffer; // AES-GCM auth tag
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

export interface McpToolCacheRow {
	ID: string;
	SERVER_ID: string;
	TOOL_NAME: string;
	TOOL_DESCRIPTION: string;
	INPUT_SCHEMA: string; // JSON string → Record<string, unknown>
	DISCOVERED_AT: Date;
}

export interface McpResourceCacheRow {
	ID: string;
	SERVER_ID: string;
	RESOURCE_URI: string;
	RESOURCE_NAME: string;
	DESCRIPTION: string | null;
	MIME_TYPE: string | null;
	DISCOVERED_AT: Date;
}

export interface McpMetricRow {
	ID: string;
	SERVER_ID: string;
	ORG_ID: string;
	TOOL_NAME: string;
	DURATION_MS: number;
	SUCCESS: number; // 1 or 0
	ERROR_MESSAGE: string | null;
	CREATED_AT: Date;
}

// ============================================================================
// Row-to-Entity Converter Functions
// ============================================================================

/**
 * Converts Oracle row to McpCatalogItem entity.
 * Handles JSON parsing for CLOB fields and boolean conversion.
 */
export function catalogRowToItem(row: McpCatalogRow): McpCatalogItem {
	return {
		id: row.ID,
		catalogId: row.CATALOG_ID,
		displayName: row.DISPLAY_NAME,
		description: row.DESCRIPTION,
		category: row.CATEGORY,
		iconUrl: row.ICON_URL ?? undefined,
		documentationUrl: row.DOCUMENTATION_URL ?? undefined,
		dockerImage: row.DOCKER_IMAGE ?? undefined,
		dockerTag: row.DOCKER_TAG,
		defaultConfig: JSON.parse(row.DEFAULT_CONFIG),
		requiredCredentials: row.REQUIRED_CREDENTIALS ? JSON.parse(row.REQUIRED_CREDENTIALS) : [],
		supportsTools: row.SUPPORTS_TOOLS === 1,
		supportsResources: row.SUPPORTS_RESOURCES === 1,
		isFeatured: row.IS_FEATURED === 1,
		sortOrder: row.SORT_ORDER,
		tags: row.TAGS ? JSON.parse(row.TAGS) : [],
		status: row.STATUS as McpCatalogItem['status'],
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

/**
 * Converts Oracle row to McpServer entity WITHOUT decrypted credentials.
 * Use for list operations where secrets must not be exposed.
 */
export function serverRowToServer(row: McpServerRow): Omit<McpServer, 'credentials'> {
	return {
		id: row.ID,
		orgId: row.ORG_ID,
		serverName: row.SERVER_NAME,
		displayName: row.DISPLAY_NAME,
		description: row.DESCRIPTION ?? undefined,
		serverType: row.SERVER_TYPE as McpServerType,
		transportType: row.TRANSPORT_TYPE as McpTransportType,
		catalogItemId: row.CATALOG_ITEM_ID ?? undefined,
		config: JSON.parse(row.CONFIG),
		dockerImage: row.DOCKER_IMAGE ?? undefined,
		dockerContainerId: row.DOCKER_CONTAINER_ID ?? undefined,
		dockerStatus: (row.DOCKER_STATUS as McpDockerStatus) ?? undefined,
		status: row.STATUS as McpServerStatus,
		enabled: row.ENABLED === 1,
		lastConnectedAt: row.LAST_CONNECTED_AT ?? undefined,
		lastError: row.LAST_ERROR ?? undefined,
		healthStatus: row.HEALTH_STATUS ? JSON.parse(row.HEALTH_STATUS) : undefined,
		tags: row.TAGS ? JSON.parse(row.TAGS) : [],
		sortOrder: row.SORT_ORDER,
		toolCount: row.TOOL_COUNT,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

/**
 * Converts Oracle row to CachedTool entity.
 */
export function toolCacheRowToTool(row: McpToolCacheRow): CachedTool {
	return {
		id: row.ID,
		serverId: row.SERVER_ID,
		toolName: row.TOOL_NAME,
		toolDescription: row.TOOL_DESCRIPTION,
		inputSchema: JSON.parse(row.INPUT_SCHEMA),
		discoveredAt: row.DISCOVERED_AT
	};
}

/**
 * Converts Oracle row to CachedResource entity.
 */
export function resourceCacheRowToResource(row: McpResourceCacheRow): CachedResource {
	return {
		id: row.ID,
		serverId: row.SERVER_ID,
		resourceUri: row.RESOURCE_URI,
		resourceName: row.RESOURCE_NAME,
		description: row.DESCRIPTION ?? undefined,
		mimeType: row.MIME_TYPE ?? undefined,
		discoveredAt: row.DISCOVERED_AT
	};
}

/**
 * Converts Oracle row to ToolCallMetric entity.
 */
export function metricRowToMetric(row: McpMetricRow): ToolCallMetric {
	return {
		serverId: row.SERVER_ID,
		orgId: row.ORG_ID,
		toolName: row.TOOL_NAME,
		durationMs: row.DURATION_MS,
		success: row.SUCCESS === 1,
		errorMessage: row.ERROR_MESSAGE ?? undefined
	};
}
