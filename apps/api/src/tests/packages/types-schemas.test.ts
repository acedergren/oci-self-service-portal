/**
 * Unit tests for the API integration layer types — Zod schemas and
 * row-to-entity converter functions.
 *
 * Pure utility — no mocks needed. Tests validate both schema parsing
 * (valid + invalid inputs) and row converter correctness (UPPERCASE
 * Oracle columns → camelCase typed objects).
 *
 * Source: packages/types/src/server/api/types.ts (404 lines, 0 tests)
 */

import { describe, it, expect } from 'vitest';
import {
	ApiKeyPermissionSchema,
	ApiKeyStatusSchema,
	ApiKeyContextSchema,
	ApiKeyInfoSchema,
	CreateApiKeyInputSchema,
	ToolDefinitionResponseSchema,
	ToolListResponseSchema,
	ToolExecutionResponseSchema,
	WebhookEventTypeSchema,
	WebhookStatusSchema,
	CreateWebhookInputSchema,
	BlockchainAuditEntrySchema,
	BlockchainAuditRecordSchema,
	SearchQuerySchema,
	SearchResultSchema,
	GraphNodeSchema,
	GraphEdgeSchema,
	GraphQueryResultSchema,
	apiKeyRowToInfo,
	apiKeyRowToContext,
	webhookRowToSubscription,
	webhookDeliveryRowToEntity,
	auditRowToRecord,
	searchRowToResult
} from '@portal/types/server/api/types.js';

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_DATE = new Date('2026-02-17T12:00:00Z');

// ── Enum schemas ────────────────────────────────────────────────────────

describe('enum schemas', () => {
	it('ApiKeyPermissionSchema accepts valid permissions', () => {
		expect(ApiKeyPermissionSchema.parse('tools:read')).toBe('tools:read');
		expect(ApiKeyPermissionSchema.parse('admin:audit')).toBe('admin:audit');
	});

	it('ApiKeyPermissionSchema rejects invalid permission', () => {
		expect(() => ApiKeyPermissionSchema.parse('invalid')).toThrow();
	});

	it('ApiKeyStatusSchema accepts active and revoked', () => {
		expect(ApiKeyStatusSchema.parse('active')).toBe('active');
		expect(ApiKeyStatusSchema.parse('revoked')).toBe('revoked');
	});

	it('WebhookEventTypeSchema accepts valid events', () => {
		expect(WebhookEventTypeSchema.parse('tool.executed')).toBe('tool.executed');
		expect(WebhookEventTypeSchema.parse('workflow.completed')).toBe('workflow.completed');
	});

	it('WebhookStatusSchema accepts valid statuses', () => {
		expect(WebhookStatusSchema.parse('active')).toBe('active');
		expect(WebhookStatusSchema.parse('paused')).toBe('paused');
		expect(WebhookStatusSchema.parse('failed')).toBe('failed');
	});
});

// ── Object schemas — API Keys ───────────────────────────────────────────

describe('API key schemas', () => {
	it('ApiKeyContextSchema validates minimal context', () => {
		const result = ApiKeyContextSchema.parse({
			orgId: 'org-1',
			permissions: ['tools:read'],
			keyId: 'key-1',
			keyName: 'My Key'
		});
		expect(result.orgId).toBe('org-1');
		expect(result.permissions).toEqual(['tools:read']);
	});

	it('ApiKeyInfoSchema validates full info with nullable dates', () => {
		const result = ApiKeyInfoSchema.parse({
			id: 'key-1',
			name: 'Production',
			keyPrefix: 'pk_live_abc',
			permissions: ['tools:execute'],
			status: 'active',
			createdAt: MOCK_DATE,
			expiresAt: null,
			revokedAt: null,
			lastUsedAt: MOCK_DATE
		});
		expect(result.status).toBe('active');
		expect(result.expiresAt).toBeNull();
	});

	it('CreateApiKeyInputSchema requires non-empty name and permissions', () => {
		expect(() =>
			CreateApiKeyInputSchema.parse({
				orgId: 'org-1',
				name: '',
				permissions: ['tools:read']
			})
		).toThrow();

		expect(() =>
			CreateApiKeyInputSchema.parse({
				orgId: 'org-1',
				name: 'Key',
				permissions: [] // min(1)
			})
		).toThrow();
	});

	it('CreateApiKeyInputSchema accepts valid input', () => {
		const result = CreateApiKeyInputSchema.parse({
			orgId: 'org-1',
			name: 'CI Key',
			permissions: ['tools:read', 'tools:execute']
		});
		expect(result.name).toBe('CI Key');
		expect(result.permissions).toHaveLength(2);
	});
});

// ── Object schemas — Tool Responses ─────────────────────────────────────

describe('tool response schemas', () => {
	it('ToolDefinitionResponseSchema validates with optional parameters', () => {
		const result = ToolDefinitionResponseSchema.parse({
			name: 'list-instances',
			description: 'Lists compute instances',
			category: 'compute',
			approvalLevel: 'auto'
		});
		expect(result.parameters).toBeUndefined();
	});

	it('ToolListResponseSchema validates tools array with count', () => {
		const result = ToolListResponseSchema.parse({
			tools: [
				{
					name: 'list-instances',
					description: 'Lists',
					category: 'compute',
					approvalLevel: 'auto'
				}
			],
			count: 1
		});
		expect(result.tools).toHaveLength(1);
		expect(result.count).toBe(1);
	});

	it('ToolExecutionResponseSchema validates execution result', () => {
		const result = ToolExecutionResponseSchema.parse({
			success: true,
			result: { instances: [] },
			duration: 250,
			approvalLevel: 'auto'
		});
		expect(result.success).toBe(true);
		expect(result.duration).toBe(250);
	});
});

// ── Object schemas — Webhooks ───────────────────────────────────────────

describe('webhook schemas', () => {
	it('CreateWebhookInputSchema validates URL and events', () => {
		const result = CreateWebhookInputSchema.parse({
			orgId: 'org-1',
			url: 'https://example.com/hook',
			events: ['tool.executed']
		});
		expect(result.url).toBe('https://example.com/hook');
	});

	it('CreateWebhookInputSchema rejects invalid URL', () => {
		expect(() =>
			CreateWebhookInputSchema.parse({
				orgId: 'org-1',
				url: 'not-a-url',
				events: ['tool.executed']
			})
		).toThrow();
	});

	it('CreateWebhookInputSchema requires at least one event', () => {
		expect(() =>
			CreateWebhookInputSchema.parse({
				orgId: 'org-1',
				url: 'https://example.com/hook',
				events: []
			})
		).toThrow();
	});

	it('CreateWebhookInputSchema rejects short secret', () => {
		expect(() =>
			CreateWebhookInputSchema.parse({
				orgId: 'org-1',
				url: 'https://example.com/hook',
				events: ['tool.executed'],
				secret: 'short' // min(16)
			})
		).toThrow();
	});
});

// ── Object schemas — Blockchain Audit ───────────────────────────────────

describe('blockchain audit schemas', () => {
	it('BlockchainAuditEntrySchema validates minimal entry', () => {
		const result = BlockchainAuditEntrySchema.parse({
			userId: 'user-1',
			action: 'instance.created'
		});
		expect(result.action).toBe('instance.created');
		expect(result.toolName).toBeUndefined();
	});

	it('BlockchainAuditRecordSchema validates full record with nulls', () => {
		const result = BlockchainAuditRecordSchema.parse({
			id: 'rec-1',
			userId: 'user-1',
			orgId: null,
			action: 'instance.created',
			toolName: null,
			resourceType: null,
			resourceId: null,
			detail: null,
			ipAddress: null,
			requestId: null,
			createdAt: MOCK_DATE
		});
		expect(result.orgId).toBeNull();
		expect(result.toolName).toBeNull();
	});
});

// ── Object schemas — Search ─────────────────────────────────────────────

describe('search schemas', () => {
	it('SearchQuerySchema provides defaults for limit and offset', () => {
		const result = SearchQuerySchema.parse({ query: 'compute instances' });
		expect(result.limit).toBe(20);
		expect(result.offset).toBe(0);
	});

	it('SearchQuerySchema validates content type enum', () => {
		const result = SearchQuerySchema.parse({
			query: 'test',
			contentType: 'user_message'
		});
		expect(result.contentType).toBe('user_message');
	});

	it('SearchQuerySchema rejects empty query', () => {
		expect(() => SearchQuerySchema.parse({ query: '' })).toThrow();
	});

	it('SearchResultSchema validates result', () => {
		const result = SearchResultSchema.parse({
			id: 'emb-1',
			sessionId: 'sess-1',
			textContent: 'How to list instances',
			contentType: 'user_message',
			score: 0.95
		});
		expect(result.score).toBe(0.95);
	});
});

// ── Object schemas — Graph ──────────────────────────────────────────────

describe('graph schemas', () => {
	it('GraphNodeSchema validates node with properties', () => {
		const result = GraphNodeSchema.parse({
			id: 'node-1',
			label: 'person',
			properties: { email: 'alice@example.com' }
		});
		expect(result.label).toBe('person');
	});

	it('GraphEdgeSchema validates edge', () => {
		const result = GraphEdgeSchema.parse({
			sourceId: 'node-1',
			targetId: 'node-2',
			label: 'has_session',
			properties: {}
		});
		expect(result.label).toBe('has_session');
	});

	it('GraphQueryResultSchema validates empty graph', () => {
		const result = GraphQueryResultSchema.parse({ nodes: [], edges: [] });
		expect(result.nodes).toHaveLength(0);
	});
});

// ── Row converters — apiKeyRowToInfo ─────────────────────────────────────

describe('apiKeyRowToInfo', () => {
	it('converts Oracle UPPERCASE row to ApiKeyInfo', () => {
		const result = apiKeyRowToInfo({
			ID: 'key-1',
			ORG_ID: 'org-1',
			KEY_HASH: 'sha256:abc',
			KEY_PREFIX: 'pk_live_abc',
			NAME: 'Production Key',
			PERMISSIONS: '["tools:read","tools:execute"]',
			STATUS: 'active',
			LAST_USED_AT: MOCK_DATE,
			EXPIRES_AT: null,
			REVOKED_AT: null,
			CREATED_AT: MOCK_DATE,
			UPDATED_AT: MOCK_DATE
		});

		expect(result.id).toBe('key-1');
		expect(result.name).toBe('Production Key');
		expect(result.permissions).toEqual(['tools:read', 'tools:execute']);
		expect(result.status).toBe('active');
		expect(result.expiresAt).toBeNull();
		expect(result.lastUsedAt).toEqual(MOCK_DATE);
	});
});

// ── Row converters — apiKeyRowToContext ──────────────────────────────────

describe('apiKeyRowToContext', () => {
	it('converts row to ApiKeyContext (subset of fields)', () => {
		const result = apiKeyRowToContext({
			ID: 'key-1',
			ORG_ID: 'org-1',
			KEY_HASH: 'sha256:abc',
			KEY_PREFIX: 'pk_live_abc',
			NAME: 'CI Key',
			PERMISSIONS: '["admin:audit"]',
			STATUS: 'active',
			LAST_USED_AT: null,
			EXPIRES_AT: null,
			REVOKED_AT: null,
			CREATED_AT: MOCK_DATE,
			UPDATED_AT: MOCK_DATE
		});

		expect(result.orgId).toBe('org-1');
		expect(result.keyId).toBe('key-1');
		expect(result.keyName).toBe('CI Key');
		expect(result.permissions).toEqual(['admin:audit']);
	});
});

// ── Row converters — webhookRowToSubscription ───────────────────────────

describe('webhookRowToSubscription', () => {
	it('converts row with JSON EVENTS and nullable dates', () => {
		const result = webhookRowToSubscription({
			ID: 'wh-1',
			ORG_ID: 'org-1',
			URL: 'https://example.com/hook',
			EVENTS: '["tool.executed","workflow.completed"]',
			SECRET: null,
			STATUS: 'active',
			FAILURE_COUNT: 0,
			MAX_RETRIES: 3,
			LAST_FIRED_AT: MOCK_DATE,
			LAST_ERROR: null,
			CREATED_AT: MOCK_DATE,
			UPDATED_AT: MOCK_DATE
		});

		expect(result.events).toEqual(['tool.executed', 'workflow.completed']);
		expect(result.failureCount).toBe(0);
		expect(result.lastFiredAt).toEqual(MOCK_DATE);
		expect(result.lastError).toBeNull();
	});
});

// ── Row converters — webhookDeliveryRowToEntity ─────────────────────────

describe('webhookDeliveryRowToEntity', () => {
	it('converts delivery row with JSON PAYLOAD', () => {
		const result = webhookDeliveryRowToEntity({
			ID: 'del-1',
			SUBSCRIPTION_ID: 'wh-1',
			EVENT_TYPE: 'tool.executed',
			PAYLOAD: '{"toolName":"list-instances","result":{}}',
			STATUS: 'delivered',
			HTTP_STATUS: 200,
			RESPONSE_BODY: null,
			ATTEMPT_COUNT: 1,
			NEXT_RETRY_AT: null,
			DELIVERED_AT: MOCK_DATE,
			CREATED_AT: MOCK_DATE
		});

		expect(result.eventType).toBe('tool.executed');
		expect(result.payload).toEqual({ toolName: 'list-instances', result: {} });
		expect(result.httpStatus).toBe(200);
		expect(result.attemptCount).toBe(1);
	});
});

// ── Row converters — auditRowToRecord ───────────────────────────────────

describe('auditRowToRecord', () => {
	it('converts row with JSON DETAIL', () => {
		const result = auditRowToRecord({
			ID: 'audit-1',
			USER_ID: 'user-1',
			ORG_ID: 'org-1',
			ACTION: 'instance.created',
			TOOL_NAME: 'launch-instance',
			RESOURCE_TYPE: 'instance',
			RESOURCE_ID: 'i-abc123',
			DETAIL: '{"shape":"VM.Standard.E4.Flex"}',
			IP_ADDRESS: '10.0.0.1',
			REQUEST_ID: 'req-1',
			CREATED_AT: MOCK_DATE
		});

		expect(result.action).toBe('instance.created');
		expect(result.detail).toEqual({ shape: 'VM.Standard.E4.Flex' });
		expect(result.toolName).toBe('launch-instance');
	});

	it('handles null DETAIL', () => {
		const result = auditRowToRecord({
			ID: 'audit-2',
			USER_ID: 'user-1',
			ORG_ID: null,
			ACTION: 'login',
			TOOL_NAME: null,
			RESOURCE_TYPE: null,
			RESOURCE_ID: null,
			DETAIL: null,
			IP_ADDRESS: null,
			REQUEST_ID: null,
			CREATED_AT: MOCK_DATE
		});

		expect(result.detail).toBeNull();
		expect(result.orgId).toBeNull();
		expect(result.toolName).toBeNull();
	});
});

// ── Row converters — searchRowToResult ──────────────────────────────────

describe('searchRowToResult', () => {
	it('converts search result row', () => {
		const result = searchRowToResult({
			ID: 'emb-1',
			SESSION_ID: 'sess-1',
			TEXT_CONTENT: 'How do I list compute instances?',
			CONTENT_TYPE: 'user_message',
			SCORE: 0.87
		});

		expect(result.id).toBe('emb-1');
		expect(result.sessionId).toBe('sess-1');
		expect(result.textContent).toBe('How do I list compute instances?');
		expect(result.score).toBe(0.87);
	});
});
