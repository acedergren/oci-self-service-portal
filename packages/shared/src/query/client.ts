import { QueryClient } from '@tanstack/svelte-query';
import type { QueryClientConfig } from '@tanstack/svelte-query';

/**
 * Default query client options for OCI AI Chat
 *
 * TanStack Query key options:
 * - gcTime (renamed from cacheTime in v5) - how long inactive data stays in cache
 * - staleTime - how long data is considered fresh
 * - refetchOnWindowFocus - disabled for better UX in chat apps
 */
export const defaultQueryClientOptions = {
	queries: {
		staleTime: 1000 * 60 * 5, // 5 minutes - data considered fresh
		gcTime: 1000 * 60 * 60, // 1 hour - keep in cache (v5: renamed from cacheTime)
		retry: 1, // Single retry on failure
		refetchOnWindowFocus: false // Don't refetch when user returns to tab
	}
} as const satisfies NonNullable<QueryClientConfig['defaultOptions']>;

/**
 * Create a QueryClient instance with default options
 *
 * Usage in +layout.svelte:
 * ```svelte
 * <script>
 *   import { QueryClientProvider } from '@tanstack/svelte-query';
 *   import { createQueryClient } from '$lib/query/client';
 *
 *   const queryClient = createQueryClient();
 * </script>
 *
 * <QueryClientProvider client={queryClient}>
 *   <slot />
 * </QueryClientProvider>
 * ```
 */
export function createQueryClient(config?: QueryClientConfig): QueryClient {
	if (!config?.defaultOptions) {
		return new QueryClient({
			defaultOptions: defaultQueryClientOptions,
			...config
		});
	}

	// Merge default options with provided options
	return new QueryClient({
		...config,
		defaultOptions: {
			...defaultQueryClientOptions,
			...config.defaultOptions,
			queries: {
				...defaultQueryClientOptions.queries,
				...config.defaultOptions.queries
			}
		}
	});
}
