/**
 * Query key factories for TanStack Query v5
 *
 * Keys are structured hierarchically for efficient cache invalidation:
 * - invalidateQueries({ queryKey: queryKeys.sessions.all() }) invalidates ALL session queries
 * - invalidateQueries({ queryKey: queryKeys.sessions.detail(id) }) invalidates that session + its usage
 */
export const queryKeys = {
  /**
   * Key for available models list
   */
  models: () => ['models'] as const,

  /**
   * Keys for session-related queries
   */
  sessions: {
    /**
     * Base key for all session queries - use for broad invalidation
     */
    all: () => ['sessions'] as const,

    /**
     * Key for a specific session's detail
     */
    detail: (id: string) => ['sessions', id] as const,

    /**
     * Key for a session's usage/token stats
     */
    usage: (id: string) => ['sessions', id, 'usage'] as const,

    /**
     * Key for a session's message history
     */
    messages: (id: string) => ['sessions', id, 'messages'] as const,
  },

  /**
   * Key for current region info
   */
  region: () => ['region'] as const,
} as const;
