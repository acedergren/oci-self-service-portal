import { z } from 'zod';

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HealthCheckResponseSchema = z.object({
	status: z.enum(['ok', 'degraded', 'unhealthy']),
	service: z.literal('api'),
	timestamp: z.string().datetime(),
	checks: z
		.record(
			z.string(),
			z.object({
				status: z.enum(['ok', 'error']),
				message: z.string().optional()
			})
		)
		.optional()
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SessionsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
	search: z.string().max(200).optional()
});

export type SessionsQuery = z.infer<typeof SessionsQuerySchema>;

export const CreateSessionSchema = z.object({
	title: z.string().max(255).optional(),
	model: z.string().max(100).optional(),
	region: z.string().max(100).optional()
});

export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;

export const SessionParamsSchema = z.object({
	id: z.string().uuid()
});

export type SessionParams = z.infer<typeof SessionParamsSchema>;

export const SessionResponseSchema = z.object({
	id: z.string().uuid(),
	title: z.string().nullable(),
	model: z.string(),
	region: z.string(),
	status: z.string(),
	messageCount: z.number(),
	lastMessage: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	isCurrent: z.boolean().optional()
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SessionListResponseSchema = z.object({
	sessions: z.array(SessionResponseSchema),
	total: z.number()
});

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const ActivityQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0)
});

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ActivityItemSchema = z.object({
	id: z.string(),
	type: z.string(),
	action: z.string(),
	time: z.string().datetime(),
	status: z.enum(['completed', 'pending', 'failed'])
});

export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const ActivityResponseSchema = z.object({
	items: z.array(ActivityItemSchema),
	total: z.number()
});

export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

// ---------------------------------------------------------------------------
// Tools — Execute
// ---------------------------------------------------------------------------

export const ToolExecuteQuerySchema = z.object({
	toolName: z.string().min(1).max(200)
});

export type ToolExecuteQuery = z.infer<typeof ToolExecuteQuerySchema>;

export const ToolExecuteBodySchema = z.object({
	toolCallId: z.string().min(1).max(200),
	toolName: z.string().min(1).max(200),
	args: z.record(z.string(), z.unknown()),
	sessionId: z.string().uuid().optional()
});

export type ToolExecuteBody = z.infer<typeof ToolExecuteBodySchema>;

// ---------------------------------------------------------------------------
// Tools — Approve
// ---------------------------------------------------------------------------

export const ToolApproveBodySchema = z.object({
	toolCallId: z.string().min(1).max(200),
	approved: z.boolean(),
	reason: z.string().max(1000).optional()
});

export type ToolApproveBody = z.infer<typeof ToolApproveBodySchema>;

// ---------------------------------------------------------------------------
// Tools — V1 API
// ---------------------------------------------------------------------------

/** Valid tool categories for v1 API filtering */
export const ToolCategorySchema = z.enum([
	'compute',
	'networking',
	'storage',
	'database',
	'identity',
	'observability',
	'pricing',
	'search',
	'billing',
	'logging'
]);

export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const V1ToolsQuerySchema = z.object({
	category: ToolCategorySchema.optional()
});

export type V1ToolsQuery = z.infer<typeof V1ToolsQuerySchema>;

export const V1ToolNameParamsSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(200)
		.regex(
			/^[a-zA-Z0-9_.-]+$/,
			'Tool name must contain only letters, digits, hyphens, dots, and underscores'
		)
});

export type V1ToolNameParams = z.infer<typeof V1ToolNameParamsSchema>;

export const V1ToolExecuteBodySchema = z.object({
	args: z.record(z.string(), z.unknown()).default({}),
	confirmed: z.boolean().optional()
});

export type V1ToolExecuteBody = z.infer<typeof V1ToolExecuteBodySchema>;

// ---------------------------------------------------------------------------
// Common error response
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = z.object({
	code: z.string(),
	error: z.string(),
	statusCode: z.number(),
	requestId: z.string().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
