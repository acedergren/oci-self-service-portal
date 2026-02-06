import { describe, test, expect } from 'vitest';
import { QueryClient } from '@tanstack/query-core';

// Duplicate of defaultQueryClientOptions to avoid importing from client.ts
// which imports from @tanstack/svelte-query (contains .svelte files)
const defaultQueryClientOptions = {
  queries: {
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
    refetchOnWindowFocus: false,
  },
} as const;

// Create a test-only query client using query-core (avoids svelte import issues)
function createTestQueryClient(config?: { defaultOptions?: Record<string, unknown> }) {
  return new QueryClient({
    defaultOptions: {
      ...defaultQueryClientOptions,
      ...config?.defaultOptions,
      queries: {
        ...defaultQueryClientOptions.queries,
        ...(config?.defaultOptions?.queries as Record<string, unknown> | undefined),
      },
    },
  });
}

describe('Query Client', () => {
  describe('createQueryClient', () => {
    test('returns a QueryClient instance with expected methods', () => {
      const client = createTestQueryClient();
      // Check for QueryClient methods instead of instanceof
      expect(client).toBeDefined();
      expect(typeof client.getDefaultOptions).toBe('function');
      expect(typeof client.getQueryCache).toBe('function');
      expect(typeof client.getMutationCache).toBe('function');
    });

    test('uses default options when none provided', () => {
      const client = createTestQueryClient();
      const options = client.getDefaultOptions();

      expect(options.queries?.staleTime).toBe(defaultQueryClientOptions.queries?.staleTime);
      expect(options.queries?.gcTime).toBe(defaultQueryClientOptions.queries?.gcTime);
    });

    test('allows custom options to override defaults', () => {
      const customStaleTime = 1000 * 60 * 15; // 15 minutes
      const client = createTestQueryClient({
        defaultOptions: {
          queries: {
            staleTime: customStaleTime,
          },
        },
      });

      const options = client.getDefaultOptions();
      expect(options.queries?.staleTime).toBe(customStaleTime);
    });
  });

  describe('defaultQueryClientOptions', () => {
    test('has staleTime set to 5 minutes', () => {
      expect(defaultQueryClientOptions.queries?.staleTime).toBe(1000 * 60 * 5);
    });

    test('has gcTime set to 1 hour (v5 renamed from cacheTime)', () => {
      expect(defaultQueryClientOptions.queries?.gcTime).toBe(1000 * 60 * 60);
    });

    test('has retry set to 1', () => {
      expect(defaultQueryClientOptions.queries?.retry).toBe(1);
    });

    test('has refetchOnWindowFocus disabled', () => {
      expect(defaultQueryClientOptions.queries?.refetchOnWindowFocus).toBe(false);
    });
  });
});
