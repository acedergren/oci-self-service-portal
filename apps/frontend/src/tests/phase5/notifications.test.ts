/**
 * Phase 5 TDD: Notification Utilities
 *
 * Provides typed toast notification helpers wrapping svelte-sonner for
 * consistent UX across the portal. Domain-specific functions for common
 * operations (tool execution, auth, sessions, rate limiting).
 *
 * Backend implementation notes (Task #7):
 *   - Domain-specific names: notifyToolSuccess, notifyToolError, etc.
 *   - Generic helpers: notifyInfo, notifyError
 *   - Uses toast.success/error/warning/info from svelte-sonner
 *
 * Expected module: $lib/utils/notifications.ts
 * Expected exports:
 *   - notifyToolSuccess(toolName: string, message?: string): void
 *   - notifyToolError(toolName: string, error?: string): void
 *   - notifyRateLimit(retryAfter?: number): void
 *   - notifyAuthError(message?: string): void
 *   - notifySessionSaved(title?: string): void
 *   - notifySessionDeleted(): void
 *   - notifyInfo(message: string, description?: string): void
 *   - notifyError(message: string, description?: string): void
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock svelte-sonner since it's a Svelte-specific UI package
const mockToast = {
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
};

vi.mock('svelte-sonner', () => ({
	toast: mockToast
}));

let notificationsModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		notificationsModule = await import('$lib/utils/notifications.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Notification Utilities (Phase 5.5)', () => {
	describe('module availability', () => {
		it('notifications module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`Notifications module not yet available: ${moduleError}. ` +
						'Implement $lib/utils/notifications.ts per Phase 5.5.'
				);
			}
			expect(notificationsModule).not.toBeNull();
		});
	});

	describe('domain-specific notification exports', () => {
		it('exports notifyToolSuccess function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyToolSuccess).toBe('function');
		});

		it('exports notifyToolError function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyToolError).toBe('function');
		});

		it('exports notifyRateLimit function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyRateLimit).toBe('function');
		});

		it('exports notifyAuthError function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyAuthError).toBe('function');
		});

		it('exports notifySessionSaved function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifySessionSaved).toBe('function');
		});

		it('exports notifySessionDeleted function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifySessionDeleted).toBe('function');
		});

		it('exports notifyInfo function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyInfo).toBe('function');
		});

		it('exports notifyError function', () => {
			if (!notificationsModule) return;
			expect(typeof notificationsModule.notifyError).toBe('function');
		});
	});

	describe('toast invocations', () => {
		it('notifyToolSuccess calls toast.success with tool name', () => {
			if (!notificationsModule) return;
			const notifyToolSuccess = notificationsModule.notifyToolSuccess as (
				toolName: string,
				message?: string
			) => void;

			notifyToolSuccess('listInstances', 'Found 3 instances');
			expect(mockToast.success).toHaveBeenCalledWith(
				'Found 3 instances',
				expect.objectContaining({ description: 'listInstances' })
			);
		});

		it('notifyToolError calls toast.error with tool name', () => {
			if (!notificationsModule) return;
			const notifyToolError = notificationsModule.notifyToolError as (
				toolName: string,
				error?: string
			) => void;

			notifyToolError('createInstance', 'Quota exceeded');
			expect(mockToast.error).toHaveBeenCalledWith(
				'createInstance failed',
				expect.objectContaining({ description: 'Quota exceeded' })
			);
		});

		it('notifyRateLimit calls toast.warning', () => {
			if (!notificationsModule) return;
			const notifyRateLimit = notificationsModule.notifyRateLimit as (retryAfter?: number) => void;

			notifyRateLimit(30);
			expect(mockToast.warning).toHaveBeenCalledWith(
				'Rate limit exceeded',
				expect.objectContaining({ description: expect.stringContaining('30') })
			);
		});

		it('notifyInfo calls toast.info', () => {
			if (!notificationsModule) return;
			const notifyInfo = notificationsModule.notifyInfo as (
				message: string,
				description?: string
			) => void;

			notifyInfo('Session restored', 'Loaded previous chat');
			expect(mockToast.info).toHaveBeenCalledWith(
				'Session restored',
				expect.objectContaining({ description: 'Loaded previous chat' })
			);
		});
	});
});
