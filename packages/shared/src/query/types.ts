/**
 * OCI GenAI Model representation
 */
export interface OciModel {
	id: string;
	name: string;
	description: string;
	provider: string;
	capabilities?: string[];
}

/**
 * Chat session representation
 */
export interface OciSession {
	id: string;
	title: string | null;
	model: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Token usage and cost for a session
 */
export interface SessionUsage {
	tokens: number;
	cost: number;
}

/**
 * Chat message in a session
 */
export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

/**
 * API response for models endpoint
 */
export interface ModelsResponse {
	models: OciModel[];
	region: string;
}

/**
 * API response for sessions list endpoint
 */
export interface SessionsResponse {
	sessions: OciSession[];
}

/**
 * API response for session detail/continue endpoint
 */
export interface SessionDetailResponse {
	session: OciSession;
	messages: ChatMessage[];
	usage?: SessionUsage;
}

/**
 * Options for API fetchers
 */
export interface FetcherOptions {
	baseUrl?: string;
}
