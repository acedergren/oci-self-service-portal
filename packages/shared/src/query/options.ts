import type { QueryKey } from '@tanstack/query-core';
import { queryKeys } from './keys.js';
import { fetchModels, fetchSessions, fetchSessionDetail, fetchSessionUsage } from './fetchers.js';
import type {
	FetcherOptions,
	ModelsResponse,
	SessionsResponse,
	SessionDetailResponse,
	SessionUsage
} from './types.js';

/**
 * Query options shape compatible with TanStack Query v5
 * Framework adapters (react-query, svelte-query, etc.) accept this shape
 */
export interface QueryOptionsBase<TData, TQueryKey extends QueryKey = QueryKey> {
	queryKey: TQueryKey;
	queryFn: (context: { queryKey: TQueryKey; signal: AbortSignal; meta: unknown }) => Promise<TData>;
	staleTime?: number;
}

/**
 * Query options for fetching available models
 *
 * Models rarely change, so we use a long staleTime (10 minutes)
 */
export function modelsQueryOptions(
	options?: FetcherOptions
): QueryOptionsBase<ModelsResponse, readonly ['models']> {
	return {
		queryKey: queryKeys.models(),
		queryFn: () => fetchModels(options),
		staleTime: 10 * 60 * 1000 // 10 minutes
	};
}

/**
 * Query options for fetching all sessions
 *
 * Sessions update more frequently (new sessions, title changes)
 * so we use a shorter staleTime (1 minute)
 */
export function sessionsQueryOptions(
	options?: FetcherOptions
): QueryOptionsBase<SessionsResponse, readonly ['sessions']> {
	return {
		queryKey: queryKeys.sessions.all(),
		queryFn: () => fetchSessions(options),
		staleTime: 60 * 1000 // 1 minute
	};
}

/**
 * Query options for fetching a specific session's detail
 *
 * Includes messages and usage data
 */
export function sessionDetailQueryOptions(
	id: string,
	options?: FetcherOptions
): QueryOptionsBase<SessionDetailResponse, readonly ['sessions', string]> {
	return {
		queryKey: queryKeys.sessions.detail(id),
		queryFn: () => fetchSessionDetail(id, options),
		staleTime: 30 * 1000 // 30 seconds
	};
}

/**
 * Query options for fetching session usage (tokens/cost)
 *
 * Usage changes with each message, so we use a short staleTime
 */
export function sessionUsageQueryOptions(
	id: string,
	options?: FetcherOptions
): QueryOptionsBase<SessionUsage, readonly ['sessions', string, 'usage']> {
	return {
		queryKey: queryKeys.sessions.usage(id),
		queryFn: () => fetchSessionUsage(id, options),
		staleTime: 30 * 1000 // 30 seconds
	};
}
