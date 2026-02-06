/**
 * Phase 8 types and Zod schemas for the API Integration Layer.
 *
 * Naming convention (matches workflows/types.ts pattern):
 * - FooSchema  : Zod schema object  (runtime validation)
 * - Foo        : Inferred TS type   (compile-time checking)
 *
 * Oracle row interfaces follow UPPERCASE convention from OUT_FORMAT_OBJECT.
 * Each row interface has a corresponding rowToEntity() converter.
 */
import { z } from 'zod';

// ============================================================================
// API Key Schemas & Types
// ============================================================================

export const ApiKeyPermissionSchema = z.enum([
	'tools:read',
	'tools:execute',
	'tools:approve',
	'sessions:read',
	'sessions:write',
	'workflows:read',
	'workflows:execute',
	'admin:audit'
]);
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;

export const ApiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

/** Context attached to a validated API key request (set on App.Locals) */
export const ApiKeyContextSchema = z.object({
	orgId: z.string(),
	permissions: z.array(z.string()),
	keyId: z.string(),
	keyName: z.string()
});
export type ApiKeyContext = z.infer<typeof ApiKeyContextSchema>;

/** Full API key info returned by listApiKeys (no hash exposed) */
export const ApiKeyInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	keyPrefix: z.string(),
	permissions: z.array(z.string()),
	status: ApiKeyStatusSchema,
	createdAt: z.date(),
	expiresAt: z.date().nullable(),
	revokedAt: z.date().nullable(),
	lastUsedAt: z.date().nullable()
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfoSchema>;

/** Result of creating a new API key (includes plaintext key, shown once) */
export const CreateApiKeyResultSchema = z.object({
	key: z.string(),
	keyHash: z.string(),
	id: z.string()
});
export type CreateApiKeyResult = z.infer<typeof CreateApiKeyResultSchema>;

/** Input for creating a new API key */
export const CreateApiKeyInputSchema = z.object({
	orgId: z.string(),
	name: z.string().min(1).max(255),
	permissions: z.array(ApiKeyPermissionSchema).min(1),
	expiresAt: z.date().nullable().optional()
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

// ============================================================================
// REST API Response Schemas
// ============================================================================

/** Serializable tool definition for REST API responses */
export const ToolDefinitionResponseSchema = z.object({
	name: z.string(),
	description: z.string(),
	category: z.string(),
	approvalLevel: z.string(),
	parameters: z.record(z.string(), z.unknown()).optional()
});
export type ToolDefinitionResponse = z.infer<typeof ToolDefinitionResponseSchema>;

export const ToolListResponseSchema = z.object({
	tools: z.array(ToolDefinitionResponseSchema),
	count: z.number().int().nonnegative()
});
export type ToolListResponse = z.infer<typeof ToolListResponseSchema>;

export const ToolDetailResponseSchema = z.object({
	tool: ToolDefinitionResponseSchema
});
export type ToolDetailResponse = z.infer<typeof ToolDetailResponseSchema>;

export const ToolExecutionResponseSchema = z.object({
	success: z.boolean(),
	result: z.unknown().optional(),
	error: z.string().optional(),
	duration: z.number().nonnegative(),
	approvalLevel: z.string()
});
export type ToolExecutionResponse = z.infer<typeof ToolExecutionResponseSchema>;

// ============================================================================
// Webhook Schemas & Types
// ============================================================================

export const WebhookEventTypeSchema = z.enum([
	'tool.executed',
	'workflow.completed',
	'workflow.failed',
	'approval.requested'
]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookStatusSchema = z.enum(['active', 'paused', 'failed']);
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;

export const WebhookSubscriptionSchema = z.object({
	id: z.string(),
	orgId: z.string(),
	url: z.string().url(),
	events: z.array(WebhookEventTypeSchema),
	status: WebhookStatusSchema,
	failureCount: z.number().int().nonnegative(),
	maxRetries: z.number().int().positive().default(3),
	lastFiredAt: z.date().nullable(),
	lastError: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>;

export const CreateWebhookInputSchema = z.object({
	orgId: z.string(),
	url: z.string().url().max(2000),
	events: z.array(WebhookEventTypeSchema).min(1),
	secret: z.string().min(16).optional()
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

export const WebhookDeliveryStatusSchema = z.enum(['pending', 'delivered', 'failed', 'retrying']);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

export const WebhookDeliverySchema = z.object({
	id: z.string(),
	subscriptionId: z.string(),
	eventType: WebhookEventTypeSchema,
	payload: z.record(z.string(), z.unknown()),
	status: WebhookDeliveryStatusSchema,
	httpStatus: z.number().nullable(),
	attemptCount: z.number().int().nonnegative(),
	nextRetryAt: z.date().nullable(),
	deliveredAt: z.date().nullable(),
	createdAt: z.date()
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

// ============================================================================
// Blockchain Audit Schemas & Types
// ============================================================================

/** Entry written to the blockchain audit table */
export const BlockchainAuditEntrySchema = z.object({
	userId: z.string(),
	orgId: z.string().optional(),
	action: z.string().min(1).max(100),
	toolName: z.string().max(100).optional(),
	resourceType: z.string().max(100).optional(),
	resourceId: z.string().max(255).optional(),
	detail: z.record(z.string(), z.unknown()).optional(),
	ipAddress: z.string().max(45).optional(),
	requestId: z.string().max(50).optional()
});
export type BlockchainAuditEntry = z.infer<typeof BlockchainAuditEntrySchema>;

/** Row read back from audit_blockchain */
export const BlockchainAuditRecordSchema = z.object({
	id: z.string(),
	userId: z.string(),
	orgId: z.string().nullable(),
	action: z.string(),
	toolName: z.string().nullable(),
	resourceType: z.string().nullable(),
	resourceId: z.string().nullable(),
	detail: z.record(z.string(), z.unknown()).nullable(),
	ipAddress: z.string().nullable(),
	requestId: z.string().nullable(),
	createdAt: z.date()
});
export type BlockchainAuditRecord = z.infer<typeof BlockchainAuditRecordSchema>;

// ============================================================================
// Search Schemas & Types
// ============================================================================

/** Hybrid search result combining Oracle Text + vector similarity */
export const SearchResultSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	textContent: z.string(),
	contentType: z.string(),
	score: z.number()
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchQuerySchema = z.object({
	query: z.string().min(1).max(1000),
	limit: z.number().int().positive().max(100).default(20),
	offset: z.number().int().nonnegative().default(0),
	sessionId: z.string().optional(),
	contentType: z.enum(['user_message', 'assistant_response', 'tool_result', 'summary']).optional()
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResponseSchema = z.object({
	results: z.array(SearchResultSchema),
	total: z.number().int().nonnegative(),
	query: z.string()
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ============================================================================
// Graph Analytics Schemas & Types
// ============================================================================

/** Result of a property graph traversal query */
export const GraphNodeSchema = z.object({
	id: z.string(),
	label: z.string(),
	properties: z.record(z.string(), z.unknown())
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
	sourceId: z.string(),
	targetId: z.string(),
	label: z.string(),
	properties: z.record(z.string(), z.unknown())
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphQueryResultSchema = z.object({
	nodes: z.array(GraphNodeSchema),
	edges: z.array(GraphEdgeSchema)
});
export type GraphQueryResult = z.infer<typeof GraphQueryResultSchema>;

// ============================================================================
// Oracle Row Interfaces (UPPERCASE keys from OUT_FORMAT_OBJECT)
// ============================================================================

export interface ApiKeyRow {
	ID: string;
	ORG_ID: string;
	KEY_HASH: string;
	KEY_PREFIX: string;
	NAME: string;
	PERMISSIONS: string; // JSON string
	STATUS: string;
	LAST_USED_AT: Date | null;
	EXPIRES_AT: Date | null;
	REVOKED_AT: Date | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

export interface WebhookSubscriptionRow {
	ID: string;
	ORG_ID: string;
	URL: string;
	EVENTS: string; // JSON string
	SECRET: string | null;
	STATUS: string;
	FAILURE_COUNT: number;
	MAX_RETRIES: number;
	LAST_FIRED_AT: Date | null;
	LAST_ERROR: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

export interface WebhookDeliveryRow {
	ID: string;
	SUBSCRIPTION_ID: string;
	EVENT_TYPE: string;
	PAYLOAD: string; // JSON string
	STATUS: string;
	HTTP_STATUS: number | null;
	RESPONSE_BODY: string | null;
	ATTEMPT_COUNT: number;
	NEXT_RETRY_AT: Date | null;
	DELIVERED_AT: Date | null;
	CREATED_AT: Date;
}

export interface BlockchainAuditRow {
	ID: string; // RAW(16) returned as hex string
	USER_ID: string;
	ORG_ID: string | null;
	ACTION: string;
	TOOL_NAME: string | null;
	RESOURCE_TYPE: string | null;
	RESOURCE_ID: string | null;
	DETAIL: string | null; // JSON CLOB
	IP_ADDRESS: string | null;
	REQUEST_ID: string | null;
	CREATED_AT: Date;
}

export interface SearchResultRow {
	ID: string;
	SESSION_ID: string;
	TEXT_CONTENT: string;
	CONTENT_TYPE: string;
	SCORE: number;
}

// ============================================================================
// Row-to-Entity Converters
// ============================================================================

export function apiKeyRowToInfo(row: ApiKeyRow): ApiKeyInfo {
	return {
		id: row.ID,
		name: row.NAME,
		keyPrefix: row.KEY_PREFIX,
		permissions: JSON.parse(row.PERMISSIONS),
		status: row.STATUS as ApiKeyStatus,
		createdAt: row.CREATED_AT,
		expiresAt: row.EXPIRES_AT,
		revokedAt: row.REVOKED_AT,
		lastUsedAt: row.LAST_USED_AT
	};
}

export function apiKeyRowToContext(row: ApiKeyRow): ApiKeyContext {
	return {
		orgId: row.ORG_ID,
		permissions: JSON.parse(row.PERMISSIONS),
		keyId: row.ID,
		keyName: row.NAME
	};
}

export function webhookRowToSubscription(row: WebhookSubscriptionRow): WebhookSubscription {
	return {
		id: row.ID,
		orgId: row.ORG_ID,
		url: row.URL,
		events: JSON.parse(row.EVENTS) as WebhookEventType[],
		status: row.STATUS as WebhookStatus,
		failureCount: row.FAILURE_COUNT,
		maxRetries: row.MAX_RETRIES,
		lastFiredAt: row.LAST_FIRED_AT,
		lastError: row.LAST_ERROR,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

export function webhookDeliveryRowToEntity(row: WebhookDeliveryRow): WebhookDelivery {
	return {
		id: row.ID,
		subscriptionId: row.SUBSCRIPTION_ID,
		eventType: row.EVENT_TYPE as WebhookEventType,
		payload: JSON.parse(row.PAYLOAD),
		status: row.STATUS as WebhookDeliveryStatus,
		httpStatus: row.HTTP_STATUS,
		attemptCount: row.ATTEMPT_COUNT,
		nextRetryAt: row.NEXT_RETRY_AT,
		deliveredAt: row.DELIVERED_AT,
		createdAt: row.CREATED_AT
	};
}

export function auditRowToRecord(row: BlockchainAuditRow): BlockchainAuditRecord {
	return {
		id: row.ID,
		userId: row.USER_ID,
		orgId: row.ORG_ID,
		action: row.ACTION,
		toolName: row.TOOL_NAME,
		resourceType: row.RESOURCE_TYPE,
		resourceId: row.RESOURCE_ID,
		detail: row.DETAIL ? JSON.parse(row.DETAIL) : null,
		ipAddress: row.IP_ADDRESS,
		requestId: row.REQUEST_ID,
		createdAt: row.CREATED_AT
	};
}

export function searchRowToResult(row: SearchResultRow): SearchResult {
	return {
		id: row.ID,
		sessionId: row.SESSION_ID,
		textContent: row.TEXT_CONTENT,
		contentType: row.CONTENT_TYPE,
		score: row.SCORE
	};
}
