/**
 * Routing restructure tests — / self-service, /chat chat interface
 *
 * Verifies the routing contract established in commit 7cbf900c:
 *   /      → self-service portal (routes/+page.svelte, no server load)
 *   /chat  → full chat interface  (routes/chat/+page.svelte + +page.server.ts)
 *
 * Three coverage areas:
 *   1. /chat server load shape
 *   2. setup page redirect target (/ not /self-service)
 *   3. PortalHeader nav link destinations
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── vi.hoisted: mock functions available before vi.mock() factory runs ────────

const { mockIsSetupComplete } = vi.hoisted(() => ({
	mockIsSetupComplete: vi.fn()
}));

vi.mock('@portal/server/admin', () => ({
	settingsRepository: {
		isSetupComplete: (...args: unknown[]) => mockIsSetupComplete(...args)
	}
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('/chat server load', () => {
	it('returns the expected initial data shape', async () => {
		const { load } = await import('../routes/chat/+page.server.js');
		// load uses no event params — safe to cast away the SvelteKit event type
		const data = await (load as () => Promise<Record<string, unknown>>)();
		expect(data).toEqual({
			sessions: [],
			currentSessionId: null,
			initialMessages: []
		});
	});

	it('sessions is an empty array, not null or undefined', async () => {
		const { load } = await import('../routes/chat/+page.server.js');
		const data = await (load as () => Promise<{ sessions: unknown[] }>)();
		expect(Array.isArray(data.sessions)).toBe(true);
		expect(data.sessions).toHaveLength(0);
	});

	it('currentSessionId is explicitly null', async () => {
		const { load } = await import('../routes/chat/+page.server.js');
		const data = await (load as () => Promise<{ currentSessionId: unknown }>)();
		expect(data.currentSessionId).toBeNull();
	});

	it('initialMessages is an empty array', async () => {
		const { load } = await import('../routes/chat/+page.server.js');
		const data = await (load as () => Promise<{ initialMessages: unknown[] }>)();
		expect(Array.isArray(data.initialMessages)).toBe(true);
		expect(data.initialMessages).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────

describe('setup page redirect target', () => {
	type MinimalEvent = { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };

	// Default: setup not yet complete — prevents redirect bleed between tests
	beforeEach(() => {
		mockIsSetupComplete.mockResolvedValue(false);
	});

	it('throws a 303 redirect to / when setup is complete', async () => {
		mockIsSetupComplete.mockResolvedValue(true);
		const { load } = await import('../routes/setup/+page.server.js');
		const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

		let thrown: unknown;
		try {
			await (load as (e: MinimalEvent) => Promise<unknown>)({ fetch: mockFetch });
		} catch (err) {
			thrown = err;
		}

		expect(thrown, 'load should throw a redirect').toBeDefined();
		const redirect = thrown as { status: number; location: string };
		expect(redirect.status).toBe(303);
		expect(redirect.location).toBe('/');
	});

	it('redirect target is / and not /self-service', async () => {
		mockIsSetupComplete.mockResolvedValue(true);
		const { load } = await import('../routes/setup/+page.server.js');
		const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

		let thrown: unknown;
		try {
			await (load as (e: MinimalEvent) => Promise<unknown>)({ fetch: mockFetch });
		} catch (err) {
			thrown = err;
		}

		const redirect = thrown as { location: string };
		expect(redirect.location).not.toBe('/self-service');
	});

	it('does not redirect when setup is incomplete', async () => {
		mockIsSetupComplete.mockResolvedValue(false);
		const { load } = await import('../routes/setup/+page.server.js');
		const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

		// Should return data, not throw
		const data = await (load as (e: MinimalEvent) => Promise<unknown>)({ fetch: mockFetch });
		expect(data).toBeDefined();
	});

	it('does not redirect when DB is unavailable (degraded mode)', async () => {
		mockIsSetupComplete.mockRejectedValue(new Error('DB connection failed'));
		const { load } = await import('../routes/setup/+page.server.js');
		const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

		// Setup page allows load to proceed — DB failure → isComplete stays false
		const data = await (load as (e: MinimalEvent) => Promise<unknown>)({ fetch: mockFetch });
		expect(data).toBeDefined();
	});
});

// ─────────────────────────────────────────────────────────────────────────────

describe('App layout navigation links', () => {
	// Navigation lives in +layout.svelte (glass morphism refactor removed PortalHeader.svelte)
	let layoutContent: string;

	beforeAll(() => {
		const layoutPath = resolve(process.cwd(), 'src/routes/+layout.svelte');
		layoutContent = readFileSync(layoutPath, 'utf-8');
	});

	it('layout file exists', () => {
		const layoutPath = resolve(process.cwd(), 'src/routes/+layout.svelte');
		expect(existsSync(layoutPath)).toBe(true);
	});

	it('/chat link is present in the app header', () => {
		// The chat route link uses SvelteKit's resolve() helper
		expect(layoutContent).toContain("'/chat'");
	});

	it('/ home link is present in the app header', () => {
		expect(layoutContent).toContain("'/'");
	});

	it('no nav link hard-codes /self-service', () => {
		expect(layoutContent).not.toContain('/self-service');
	});
});

// ─────────────────────────────────────────────────────────────────────────────

describe('route file structure', () => {
	it('root +page.svelte contains self-service portal components', () => {
		const rootPage = resolve(process.cwd(), 'src/routes/+page.svelte');
		expect(existsSync(rootPage)).toBe(true);
		const content = readFileSync(rootPage, 'utf-8');
		// HeroSection and ServiceCategoryGrid are the landmark self-service components
		expect(content).toContain('HeroSection');
		expect(content).toContain('ServiceCategoryGrid');
	});

	it('chat route has both +page.svelte and +page.server.ts', () => {
		const chatPage = resolve(process.cwd(), 'src/routes/chat/+page.svelte');
		const chatServer = resolve(process.cwd(), 'src/routes/chat/+page.server.ts');
		expect(existsSync(chatPage)).toBe(true);
		expect(existsSync(chatServer)).toBe(true);
	});

	it('root route has no +page.server.ts — self-service needs no server load', () => {
		const rootServer = resolve(process.cwd(), 'src/routes/+page.server.ts');
		expect(existsSync(rootServer)).toBe(false);
	});

	it('self-service directory no longer contains +page.svelte', () => {
		const selfServicePage = resolve(process.cwd(), 'src/routes/self-service/+page.svelte');
		expect(existsSync(selfServicePage)).toBe(false);
	});
});
