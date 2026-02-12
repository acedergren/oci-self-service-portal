import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import {
	modelsQueryOptions,
	sessionsQueryOptions,
	sessionDetailQueryOptions,
	sessionUsageQueryOptions,
	createSession,
	deleteSession,
	queryKeys
} from './index';

/**
 * Query hook for fetching available models
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useModels } from '$lib/query/hooks';
 *   const models = useModels();
 * </script>
 *
 * {#if models.isPending}
 *   Loading...
 * {:else if models.data}
 *   {#each models.data.models as model}
 *     <option value={model.id}>{model.name}</option>
 *   {/each}
 * {/if}
 * ```
 */
export function useModels() {
	return createQuery(() => modelsQueryOptions());
}

/**
 * Query hook for fetching all sessions
 */
export function useSessions() {
	return createQuery(() => sessionsQueryOptions());
}

/**
 * Query hook for fetching a specific session's detail
 */
export function useSessionDetail(sessionId: string) {
	return createQuery(() => sessionDetailQueryOptions(sessionId));
}

/**
 * Query hook for fetching session usage (tokens/cost)
 */
export function useSessionUsage(sessionId: string) {
	return createQuery(() => sessionUsageQueryOptions(sessionId));
}

/**
 * Mutation hook for creating a new session
 *
 * Automatically invalidates the sessions list after creation
 */
export function useCreateSession() {
	const queryClient = useQueryClient();

	return createMutation(() => ({
		mutationFn: () => createSession(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
		}
	}));
}

/**
 * Mutation hook for deleting a session
 *
 * Automatically invalidates the sessions list after deletion
 */
export function useDeleteSession() {
	const queryClient = useQueryClient();

	return createMutation(() => ({
		mutationFn: (id: string) => deleteSession(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
		}
	}));
}

/**
 * Helper to invalidate session usage after a chat message
 */
export function useInvalidateSessionUsage() {
	const queryClient = useQueryClient();

	return (sessionId: string) => {
		queryClient.invalidateQueries({ queryKey: queryKeys.sessions.usage(sessionId) });
		// Also invalidate the session detail to get updated title
		queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
	};
}
