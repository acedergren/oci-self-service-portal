/**
 * Zod schemas and TypeScript types for all Oracle database entities.
 *
 * Naming convention (matches agent-state pattern):
 * - FooSchema  : Zod schema object  (runtime validation)
 * - Foo        : Inferred TS type   (compile-time checking)
 */
import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

export const OrgStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const UserStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const OrgRoleSchema = z.enum(['admin', 'operator', 'viewer']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const SessionStatusSchema = z.enum(['active', 'completed', 'error']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ToolActionSchema = z.enum(['requested', 'approved', 'rejected', 'executed', 'failed']);
export type ToolAction = z.infer<typeof ToolActionSchema>;

export const ApprovalLevelSchema = z.enum(['auto', 'confirm', 'danger']);
export type ApprovalLevel = z.infer<typeof ApprovalLevelSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const EmbeddingContentTypeSchema = z.enum([
	'user_message',
	'assistant_response',
	'tool_result',
	'summary'
]);
export type EmbeddingContentType = z.infer<typeof EmbeddingContentTypeSchema>;

// ============================================================================
// Entity Schemas — match 001-core.sql tables
// ============================================================================

/** organizations table */
export const OrganizationSchema = z.object({
	id: z.string().uuid(),
	name: z.string().max(255),
	ociCompartmentId: z.string().max(255).optional(),
	settings: z.record(z.string(), z.unknown()).optional(),
	status: OrgStatusSchema,
	createdAt: z.date(),
	updatedAt: z.date()
});
export type Organization = z.infer<typeof OrganizationSchema>;

/** users table (includes Better Auth columns from 003 migration) */
export const UserSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email().max(255),
	displayName: z.string().max(255).optional(),
	oidcSubject: z.string().max(255).optional(),
	oidcIssuer: z.string().max(512).optional(),
	status: UserStatusSchema,
	name: z.string().max(255).optional(),
	emailVerified: z.boolean().optional(),
	image: z.string().max(1024).optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type User = z.infer<typeof UserSchema>;

/** org_members table */
export const OrgMemberSchema = z.object({
	userId: z.string().uuid(),
	orgId: z.string().uuid(),
	role: OrgRoleSchema,
	createdAt: z.date()
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

/** auth_sessions table (includes Better Auth columns from 003 migration) */
export const AuthSessionSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	tokenHash: z.string().max(255),
	ipAddress: z.string().max(45).optional(),
	userAgent: z.string().max(512).optional(),
	expiresAt: z.date(),
	token: z.string().max(255).optional(),
	updatedAt: z.date().optional(),
	activeOrganizationId: z.string().uuid().optional(),
	createdAt: z.date()
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

/** chat_sessions table */
export const ChatSessionSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid().optional(),
	orgId: z.string().uuid().optional(),
	title: z.string().max(500).optional(),
	model: z.string().max(100),
	region: z.string().max(50),
	status: SessionStatusSchema,
	config: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

/** chat_turns table */
export const ChatTurnSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid(),
	turnNumber: z.number().int().positive(),
	userMessage: z.unknown(),
	assistantResponse: z.unknown().optional(),
	toolCalls: z.array(z.unknown()),
	tokensUsed: z.number().int().nonnegative().optional(),
	costUsd: z.number().nonnegative().optional(),
	error: z.string().optional(),
	createdAt: z.date()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** tool_executions table (audit log) */
export const ToolExecutionSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid().optional(),
	userId: z.string().uuid().optional(),
	orgId: z.string().uuid().optional(),
	toolName: z.string().max(100),
	toolCategory: z.string().max(50),
	approvalLevel: ApprovalLevelSchema,
	action: ToolActionSchema,
	args: z.record(z.string(), z.unknown()).optional(),
	redactedArgs: z.record(z.string(), z.unknown()).optional(),
	success: z.boolean().optional(),
	error: z.string().optional(),
	durationMs: z.number().nonnegative().optional(),
	ipAddress: z.string().max(45).optional(),
	userAgent: z.string().max(512).optional(),
	createdAt: z.date()
});
export type ToolExecution = z.infer<typeof ToolExecutionSchema>;

/** pending_approvals table */
export const PendingApprovalSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid().optional(),
	userId: z.string().uuid().optional(),
	toolName: z.string().max(100),
	toolCategory: z.string().max(50),
	approvalLevel: z.string().max(20),
	args: z.record(z.string(), z.unknown()).optional(),
	status: ApprovalStatusSchema,
	expiresAt: z.date(),
	resolvedBy: z.string().uuid().optional(),
	resolvedAt: z.date().optional(),
	createdAt: z.date()
});
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

// ============================================================================
// Entity Schemas — match 002-vector.sql tables
// ============================================================================

/** conversation_embeddings table */
export const ConversationEmbeddingSchema = z.object({
	id: z.string().uuid(),
	sessionId: z.string().uuid(),
	turnId: z.string().uuid().optional(),
	contentType: EmbeddingContentTypeSchema,
	textContent: z.string(),
	embedding: z.array(z.number()).optional(),
	createdAt: z.date()
});
export type ConversationEmbedding = z.infer<typeof ConversationEmbeddingSchema>;

// ============================================================================
// Entity Schemas — match 003-better-auth.sql tables
// ============================================================================

export const InvitationStatusSchema = z.enum([
	'pending',
	'accepted',
	'rejected',
	'cancelled',
	'expired'
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

/** accounts table (OAuth account links) */
export const AccountSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	accountId: z.string().max(255),
	providerId: z.string().max(255),
	accessToken: z.string().optional(),
	refreshToken: z.string().optional(),
	accessTokenExpiresAt: z.date().optional(),
	refreshTokenExpiresAt: z.date().optional(),
	scope: z.string().max(1024).optional(),
	idToken: z.string().optional(),
	password: z.string().max(255).optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type Account = z.infer<typeof AccountSchema>;

/** verifications table (email/token verifications) */
export const VerificationSchema = z.object({
	id: z.string().uuid(),
	identifier: z.string().max(255),
	value: z.string().max(1024),
	expiresAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type Verification = z.infer<typeof VerificationSchema>;

/** org_invitations table */
export const OrgInvitationSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email().max(255),
	inviterId: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	role: OrgRoleSchema,
	status: InvitationStatusSchema,
	expiresAt: z.date(),
	createdAt: z.date()
});
export type OrgInvitation = z.infer<typeof OrgInvitationSchema>;

// ============================================================================
// Insert schemas (omit server-generated fields)
// ============================================================================

export const InsertChatSessionSchema = ChatSessionSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true
});
export type InsertChatSession = z.infer<typeof InsertChatSessionSchema>;

export const InsertToolExecutionSchema = ToolExecutionSchema.omit({
	id: true,
	createdAt: true
});
export type InsertToolExecution = z.infer<typeof InsertToolExecutionSchema>;

export const InsertPendingApprovalSchema = PendingApprovalSchema.omit({
	id: true,
	createdAt: true,
	resolvedBy: true,
	resolvedAt: true
});
export type InsertPendingApproval = z.infer<typeof InsertPendingApprovalSchema>;

export const InsertUserSchema = UserSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true
});
export type InsertUser = z.infer<typeof InsertUserSchema>;
