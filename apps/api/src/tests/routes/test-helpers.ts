/**
 * Shared test utilities for route tests.
 *
 * Centralises the fake-auth Fastify plugin, session simulation, and common
 * mocks so that individual route test files stay focused on route-specific
 * behaviour.
 */

import { vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
	serializerCompiler,
	validatorCompiler
} from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Fake auth plugin
// ---------------------------------------------------------------------------

const PERMS_KEY = Symbol('permissions');

/**
 * Registers Fastify request decorators that mirror the real auth plugin,
 * without performing any actual authentication.
 */
const fakeAuthPlugin = fp(
	async (fastify) => {
		fastify.decorateRequest('user', null);
		fastify.decorateRequest('session', null);
		fastify.decorateRequest('permissions', {
			getter(this: FastifyRequest) {
				const self = this as FastifyRequest & { [PERMS_KEY]?: string[] };
				if (!self[PERMS_KEY]) self[PERMS_KEY] = [];
				return self[PERMS_KEY];
			},
			setter(this: FastifyRequest, value: string[]) {
				(this as FastifyRequest & { [PERMS_KEY]?: string[] })[PERMS_KEY] = value;
			}
		});
		fastify.decorateRequest('apiKeyContext', null);
		fastify.decorateRequest('dbAvailable', true);
	},
	{ name: 'auth', fastify: '5.x' }
);

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

interface BuildAppOptions {
	/** Register the RBAC plugin (required for auth-protected routes). */
	withRbac?: boolean;
}

/**
 * Builds a minimal Fastify app with Zod validation, fake auth decorators, and
 * optionally the real RBAC plugin.  Call `registerRoutes` on the returned app
 * to add route-specific handlers before calling `app.ready()`.
 */
export async function buildTestApp(
	opts: BuildAppOptions = { withRbac: true }
): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	await app.register(fakeAuthPlugin);

	if (opts.withRbac) {
		const rbacPlugin = (await import('../../plugins/rbac.js')).default;
		await app.register(rbacPlugin);
	}

	return app;
}

// ---------------------------------------------------------------------------
// Session simulation
// ---------------------------------------------------------------------------

/**
 * Injects user and permissions into every incoming request, simulating an
 * authenticated session.
 */
export function simulateSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[]
): void {
	app.addHook('onRequest', async (request) => {
		(request as FastifyRequest).user = user as any;
		(request as FastifyRequest).permissions = permissions;
	});
}

/**
 * Marks the database as unavailable for every incoming request.
 */
export function simulateDbUnavailable(app: FastifyInstance): void {
	app.addHook('onRequest', async (request) => {
		(request as any).dbAvailable = false;
	});
}

// ---------------------------------------------------------------------------
// Common mock factories
// ---------------------------------------------------------------------------

/** Creates the standard logger mock shape expected by `@portal/shared/server/logger`. */
export function createLoggerMock(): Record<string, ReturnType<typeof vi.fn>> {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	};
}
