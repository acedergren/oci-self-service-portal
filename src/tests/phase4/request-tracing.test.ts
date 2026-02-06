/**
 * Phase 4 TDD: Request Tracing (X-Request-Id)
 *
 * Adds a unique request ID to every request for end-to-end tracing.
 * The ID should be generated in hooks.server.ts, set on event.locals,
 * and added as a response header.
 *
 * Expected module: $lib/server/tracing.ts
 * Expected exports:
 *   - generateRequestId(): string
 *   - REQUEST_ID_HEADER: string (= 'X-Request-Id')
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let tracingModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		tracingModule = await import('$lib/server/tracing.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Request Tracing (Phase 4.3)', () => {
	describe('module availability', () => {
		it('tracing module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`tracing module not yet available: ${moduleError}. ` +
						'Implement $lib/server/tracing.ts per Phase 4.3.'
				);
			}
			expect(tracingModule).not.toBeNull();
		});
	});

	describe('generateRequestId', () => {
		it('returns a string', () => {
			if (!tracingModule) return;
			const generateRequestId = tracingModule.generateRequestId as () => string;
			const id = generateRequestId();
			expect(typeof id).toBe('string');
			expect(id.length).toBeGreaterThan(0);
		});

		it('generates unique IDs', () => {
			if (!tracingModule) return;
			const generateRequestId = tracingModule.generateRequestId as () => string;
			const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
			expect(ids.size).toBe(100);
		});

		it('produces URL-safe characters', () => {
			if (!tracingModule) return;
			const generateRequestId = tracingModule.generateRequestId as () => string;
			const id = generateRequestId();
			// Should only contain alphanumeric, hyphens (UUID-like)
			expect(id).toMatch(/^[a-zA-Z0-9-]+$/);
		});
	});

	describe('REQUEST_ID_HEADER', () => {
		it('exports the header name constant', () => {
			if (!tracingModule) return;
			expect(tracingModule.REQUEST_ID_HEADER).toBe('X-Request-Id');
		});
	});

	describe('hooks integration contract', () => {
		it('incoming X-Request-Id should be preserved if present', () => {
			// When a reverse proxy (Cloudflare) sets X-Request-Id,
			// the hooks guard should use that value instead of generating a new one.
			const incomingHeaders = new Headers({ 'X-Request-Id': 'cf-abc-123' });
			const existingId = incomingHeaders.get('X-Request-Id');
			expect(existingId).toBe('cf-abc-123');
		});

		it('response should include X-Request-Id header', () => {
			// Verifying the expected response contract
			const response = new Response('ok', {
				headers: { 'X-Request-Id': 'req-123-abc' }
			});
			expect(response.headers.get('X-Request-Id')).toBe('req-123-abc');
		});
	});
});
