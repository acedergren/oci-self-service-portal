import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  queryKeys,
  modelsQueryOptions,
  sessionsQueryOptions,
} from '$lib/query';
import { QueryClient } from '@tanstack/query-core';

// Inline the default options to avoid importing from $lib/query/client.js
// (which imports from @tanstack/svelte-query and causes .svelte import errors in vitest)
const testQueryClientOptions = {
  queries: {
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
    refetchOnWindowFocus: false,
  },
} as const;

// Create a test-only query client using query-core (avoids svelte import issues)
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: testQueryClientOptions,
  });
}

// Mock fetch for testing
const mockFetch = vi.fn();

describe('Query Integration with oci-genai-query', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('queryKeys from shared package', () => {
    test('models key is available', () => {
      expect(queryKeys.models()).toEqual(['models']);
    });

    test('sessions keys are available', () => {
      expect(queryKeys.sessions.all()).toEqual(['sessions']);
      expect(queryKeys.sessions.detail('test-id')).toEqual(['sessions', 'test-id']);
    });
  });

  describe('query options from shared package', () => {
    test('modelsQueryOptions returns valid options', () => {
      const options = modelsQueryOptions();
      expect(options.queryKey).toEqual(['models']);
      expect(typeof options.queryFn).toBe('function');
      expect(options.staleTime).toBeGreaterThan(0);
    });

    test('sessionsQueryOptions returns valid options', () => {
      const options = sessionsQueryOptions();
      expect(options.queryKey).toEqual(['sessions']);
      expect(typeof options.queryFn).toBe('function');
    });
  });

  describe('QueryClient with shared options', () => {
    test('can prefetch using shared query options', async () => {
      const mockResponse = {
        models: [{ id: 'test', name: 'Test', description: 'Test model', provider: 'test' }],
        region: 'test-region',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const queryClient = createTestQueryClient();

      // Prefetch using shared options
      await queryClient.prefetchQuery(modelsQueryOptions());

      // Verify data is in cache
      const cachedData = queryClient.getQueryData(queryKeys.models());
      expect(cachedData).toEqual(mockResponse);
    });

    test('can invalidate queries using shared keys', async () => {
      const mockResponse = {
        sessions: [{ id: 's1', title: 'Test', model: 'test', createdAt: '2026-02-02T10:00:00Z', updatedAt: '2026-02-02T10:00:00Z' }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const queryClient = createTestQueryClient();

      // Prefetch sessions
      await queryClient.prefetchQuery(sessionsQueryOptions());

      // Invalidate using shared key
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });

      // Data should be marked as stale
      const state = queryClient.getQueryState(queryKeys.sessions.all());
      expect(state?.isInvalidated).toBe(true);
    });
  });
});
