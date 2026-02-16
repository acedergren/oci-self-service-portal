/**
 * Zod schemas and types for agent session state.
 *
 * Naming convention:
 * - FooSchema: Zod schema object (for runtime validation)
 * - Foo: Inferred TypeScript type (for compile-time type checking)
 */
import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

/** Session lifecycle status */
export const SessionStatusSchema = z.enum(['active', 'completed', 'error']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** Tool call execution status */
export const ToolCallStatusSchema = z.enum(['pending', 'running', 'completed', 'error']);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

// ============================================================================
// Configuration Schemas
// ============================================================================

/** Session configuration options */
export const SessionConfigSchema = z
	.object({
		temperature: z.number().min(0).max(2).optional(),
		maxTokens: z.number().positive().optional(),
		agentRole: z.string().optional(),
		systemPrompt: z.string().optional()
	})
	.passthrough();

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

// ============================================================================
// Message Schemas
// ============================================================================

/** Chat message (user, assistant, or system) */
export const MessageSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string(),
	reasoning: z.string().optional()
});

export type Message = z.infer<typeof MessageSchema>;

/** Tool/function call with execution state */
export const ToolCallSchema = z.object({
	id: z.string(),
	name: z.string(),
	args: z.record(z.string(), z.unknown()).optional().default({}),
	result: z.unknown().optional(),
	status: ToolCallStatusSchema,
	startedAt: z.number().optional(),
	completedAt: z.number().optional(),
	error: z.string().optional()
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// ============================================================================
// Entity Schemas
// ============================================================================

/** Agent conversation session */
export const SessionSchema = z.object({
	id: z.string().uuid(),
	createdAt: z.number(),
	updatedAt: z.number(),
	title: z.string().optional(),
	model: z.string(),
	region: z.string(),
	status: SessionStatusSchema,
	config: SessionConfigSchema.optional()
});

export type Session = z.infer<typeof SessionSchema>;

/** Single conversation turn (user message + assistant response + tool calls) */
export const TurnSchema = z.object({
	id: z.string(),
	sessionId: z.string().uuid(),
	turnNumber: z.number().int().positive(),
	createdAt: z.number(),
	userMessage: MessageSchema,
	assistantResponse: MessageSchema.optional(),
	toolCalls: z.array(ToolCallSchema),
	tokensUsed: z.number().int().nonnegative().optional(),
	costUsd: z.number().nonnegative().optional(),
	error: z.string().nullable()
});

export type Turn = z.infer<typeof TurnSchema>;

// ============================================================================
// Input/Option Types (for repository methods)
// ============================================================================

/** Input for creating a new session */
export interface CreateSessionInput {
	id?: string;
	model: string;
	region: string;
	title?: string;
	status?: SessionStatus;
	config?: Record<string, unknown>;
}

/** Input for updating a session */
export interface UpdateSessionInput {
	title?: string;
	status?: SessionStatus;
	config?: Record<string, unknown>;
}

/** Input for adding a turn to a session */
export interface AddTurnInput {
	turnNumber: number;
	userMessage: Message;
}

/** Input for updating a turn */
export interface UpdateTurnInput {
	assistantResponse?: Message;
	toolCalls?: ToolCall[];
	tokensUsed?: number;
	costUsd?: number;
	error?: string | null;
}

/** Options for listing sessions */
export interface ListSessionsOptions {
	limit?: number;
	status?: SessionStatus;
}
