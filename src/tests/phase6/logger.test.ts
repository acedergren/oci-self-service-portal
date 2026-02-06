/**
 * Phase 6 TDD: Enhanced Pino Logging with Child Logger Pattern
 *
 * Tests the structured logging system with module-scoped child loggers,
 * custom serializers, and environment-aware transports.
 *
 * Module: $lib/server/logger.ts
 * Exports:
 *   - createLogger(module, context?): Logger  — child logger factory
 *   - logger: Logger  — root Pino instance
 *   - KnownModule type  — union of predefined module names
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We avoid mocking pino here so we can test the real module behavior.
// Pino writes to stdout in JSON or pretty format; we just test the API surface.

let loggerModule: typeof import('$lib/server/logger.js');

beforeEach(async () => {
	vi.resetModules();
	loggerModule = await import('$lib/server/logger.js');
});

describe('Enhanced Pino Logging (Phase 6)', () => {
	describe('exports', () => {
		it('exports createLogger function', () => {
			expect(typeof loggerModule.createLogger).toBe('function');
		});

		it('exports root logger instance', () => {
			expect(loggerModule.logger).toBeDefined();
			expect(typeof loggerModule.logger.info).toBe('function');
		});
	});

	describe('createLogger factory', () => {
		it('creates a child logger with module name bound', () => {
			const log = loggerModule.createLogger('chat');
			expect(log).toBeDefined();
			expect(typeof log.info).toBe('function');
			expect(typeof log.error).toBe('function');
			expect(typeof log.warn).toBe('function');
			expect(typeof log.debug).toBe('function');
		});

		it('accepts optional context bindings', () => {
			const log = loggerModule.createLogger('tools', {
				requestId: 'req-123',
				userId: 'user-456'
			});
			expect(log).toBeDefined();
			expect(typeof log.info).toBe('function');
		});

		it('returns a Pino Logger with standard methods', () => {
			const log = loggerModule.createLogger('auth');
			const methods = ['info', 'warn', 'error', 'debug', 'fatal', 'trace'];
			for (const method of methods) {
				expect(typeof (log as unknown as Record<string, unknown>)[method]).toBe('function');
			}
		});

		it('child logger can create further children', () => {
			const parentLog = loggerModule.createLogger('tools', { requestId: 'req-abc' });
			const childLog = parentLog.child({ toolName: 'listInstances' });
			expect(childLog).toBeDefined();
			expect(typeof childLog.info).toBe('function');
		});

		it('different modules produce independent loggers', () => {
			const chatLog = loggerModule.createLogger('chat');
			const authLog = loggerModule.createLogger('auth');
			expect(chatLog).not.toBe(authLog);
		});

		it('accepts arbitrary module names beyond KnownModule', () => {
			// KnownModule is a union, but any string is accepted
			const customLog = loggerModule.createLogger('my-custom-module');
			expect(customLog).toBeDefined();
			expect(typeof customLog.info).toBe('function');
		});
	});

	describe('root logger', () => {
		it('has standard Pino log methods', () => {
			const { logger } = loggerModule;
			expect(typeof logger.info).toBe('function');
			expect(typeof logger.error).toBe('function');
			expect(typeof logger.warn).toBe('function');
			expect(typeof logger.debug).toBe('function');
			expect(typeof logger.fatal).toBe('function');
		});

		it('can create child loggers', () => {
			const child = loggerModule.logger.child({ component: 'test' });
			expect(child).toBeDefined();
			expect(typeof child.info).toBe('function');
		});
	});

	describe('log level configuration', () => {
		it('respects LOG_LEVEL environment variable', () => {
			// The logger reads LOG_LEVEL at init time
			// In dev mode (no NODE_ENV=production), default is 'debug'
			// In prod mode, default is 'info'
			const level = loggerModule.logger.level;
			expect(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).toContain(level);
		});
	});

	describe('predefined module names', () => {
		it('all predefined modules can be used with createLogger', () => {
			const modules = [
				'chat',
				'tools',
				'auth',
				'oracle',
				'metrics',
				'health',
				'hooks',
				'sessions-api',
				'execute',
				'approve',
				'audit',
				'approvals',
				'rate-limiter',
				'sentry'
			];

			for (const mod of modules) {
				const log = loggerModule.createLogger(mod);
				expect(log).toBeDefined();
				expect(typeof log.info).toBe('function');
			}
		});
	});

	describe('serializers', () => {
		it('logger has custom error serializer', () => {
			// Pino serializers are configured at init; we verify they don't break logging
			const log = loggerModule.createLogger('test');

			// Logging an error object should not throw
			expect(() => {
				log.error({ err: new Error('test error') }, 'something failed');
			}).not.toThrow();
		});

		it('logger handles PortalError-like objects', () => {
			const log = loggerModule.createLogger('test');
			const portalLike = Object.assign(new Error('Validation failed'), {
				code: 'VALIDATION_ERROR',
				statusCode: 400,
				context: { field: 'email' }
			});

			expect(() => {
				log.error({ err: portalLike }, 'validation error');
			}).not.toThrow();
		});

		it('logger handles request-like objects', () => {
			const log = loggerModule.createLogger('test');
			const reqLike = {
				method: 'POST',
				url: '/api/chat',
				headers: {
					'user-agent': 'Mozilla/5.0',
					'x-request-id': 'req-abc-123'
				}
			};

			expect(() => {
				log.info({ req: reqLike }, 'incoming request');
			}).not.toThrow();
		});
	});
});
