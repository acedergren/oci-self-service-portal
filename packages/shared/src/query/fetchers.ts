import type {
	ModelsResponse,
	SessionsResponse,
	SessionDetailResponse,
	SessionUsage,
	OciSession,
	FetcherOptions
} from './types.js';

/**
 * Fetch available OCI GenAI models
 */
export async function fetchModels(options?: FetcherOptions): Promise<ModelsResponse> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/models`);

	if (!response.ok) {
		throw new Error('Failed to fetch models');
	}

	return response.json();
}

/**
 * Fetch all chat sessions
 */
export async function fetchSessions(options?: FetcherOptions): Promise<SessionsResponse> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/sessions`);

	if (!response.ok) {
		throw new Error('Failed to fetch sessions');
	}

	return response.json();
}

/**
 * Fetch session detail with messages and usage
 */
export async function fetchSessionDetail(
	id: string,
	options?: FetcherOptions
): Promise<SessionDetailResponse> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/sessions/${id}/continue`, {
		method: 'POST'
	});

	if (!response.ok) {
		throw new Error('Failed to fetch session');
	}

	return response.json();
}

/**
 * Fetch session usage (tokens/cost) only
 */
export async function fetchSessionUsage(
	id: string,
	options?: FetcherOptions
): Promise<SessionUsage> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/sessions/${id}/continue`, {
		method: 'POST'
	});

	if (!response.ok) {
		throw new Error('Failed to fetch session usage');
	}

	const data: SessionDetailResponse = await response.json();
	return data.usage ?? { tokens: 0, cost: 0 };
}

/**
 * Create a new chat session
 */
export async function createSession(options?: FetcherOptions): Promise<OciSession> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/sessions`, {
		method: 'POST'
	});

	if (!response.ok) {
		throw new Error('Failed to create session');
	}

	const data = await response.json();
	return data.session;
}

/**
 * Delete a chat session
 */
export async function deleteSession(id: string, options?: FetcherOptions): Promise<void> {
	const baseUrl = options?.baseUrl ?? '';
	const response = await fetch(`${baseUrl}/api/sessions/${id}`, {
		method: 'DELETE'
	});

	if (!response.ok) {
		throw new Error('Failed to delete session');
	}
}
