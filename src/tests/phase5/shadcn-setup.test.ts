/**
 * Phase 5 TDD: shadcn-svelte Setup
 *
 * Verifies that the shadcn-svelte foundation is properly configured:
 *   - cn() utility for class merging (tailwind-merge + clsx)
 *   - bits-ui is importable (headless component primitives)
 *   - svelte-sonner is importable (toast notifications)
 *
 * Expected module: $lib/utils/cn.ts
 * Expected exports:
 *   - cn(...inputs: ClassValue[]): string
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let cnModule: Record<string, unknown> | null = null;
let cnModuleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		cnModule = await import('$lib/utils/cn.js');
	} catch (err) {
		cnModuleError = (err as Error).message;
	}
});

describe('shadcn-svelte Setup (Phase 5.0)', () => {
	describe('cn() utility', () => {
		it('cn module should be importable', () => {
			if (cnModuleError) {
				expect.fail(
					`cn utility not yet available: ${cnModuleError}. ` +
						'Implement $lib/utils/cn.ts with tailwind-merge + clsx.'
				);
			}
			expect(cnModule).not.toBeNull();
		});

		it('exports cn function', () => {
			if (!cnModule) return;
			expect(typeof cnModule.cn).toBe('function');
		});

		it('merges simple class names', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			const result = cn('px-4', 'py-2');
			expect(result).toContain('px-4');
			expect(result).toContain('py-2');
		});

		it('handles conflicting Tailwind classes (last wins)', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			// tailwind-merge should resolve conflicts
			const result = cn('px-4', 'px-8');
			expect(result).toContain('px-8');
			expect(result).not.toContain('px-4');
		});

		it('handles conditional classes', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			const isActive = true;
			const result = cn('base-class', isActive && 'active-class');
			expect(result).toContain('base-class');
			expect(result).toContain('active-class');
		});

		it('handles falsy values', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			const result = cn('base', false, null, undefined, '', 'extra');
			expect(result).toContain('base');
			expect(result).toContain('extra');
			// Should not contain literal "false" or "null" strings
			expect(result).not.toContain('false');
			expect(result).not.toContain('null');
			expect(result).not.toContain('undefined');
		});

		it('handles object syntax for conditional classes', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			const result = cn({ 'bg-red-500': true, 'bg-blue-500': false });
			expect(result).toContain('bg-red-500');
			expect(result).not.toContain('bg-blue-500');
		});

		it('handles array syntax', () => {
			if (!cnModule) return;
			const cn = cnModule.cn as (...inputs: unknown[]) => string;

			const result = cn(['flex', 'items-center'], 'gap-2');
			expect(result).toContain('flex');
			expect(result).toContain('items-center');
			expect(result).toContain('gap-2');
		});
	});

	describe('bits-ui dependency', () => {
		it('bits-ui should be listed in package.json', async () => {
			// bits-ui contains .svelte files which vitest cannot import directly.
			// Instead, verify the package is installed by checking package.json.
			const { readFileSync } = await import('fs');
			const { resolve } = await import('path');
			const pkgPath = resolve(process.cwd(), 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			expect(deps['bits-ui'], 'bits-ui should be in dependencies').toBeDefined();
		});
	});

	describe('svelte-sonner dependency', () => {
		it('svelte-sonner should be listed in package.json', async () => {
			// svelte-sonner contains .svelte files which vitest cannot import directly.
			// Instead, verify the package is installed by checking package.json.
			const { readFileSync } = await import('fs');
			const { resolve } = await import('path');
			const pkgPath = resolve(process.cwd(), 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			expect(deps['svelte-sonner'], 'svelte-sonner should be in dependencies').toBeDefined();
		});
	});

	describe('tailwind-merge dependency', () => {
		it('tailwind-merge should be importable', async () => {
			try {
				const mod = await import('tailwind-merge');
				expect(mod).toBeDefined();
				expect(typeof mod.twMerge).toBe('function');
			} catch (err) {
				expect.fail(
					`tailwind-merge not available: ${(err as Error).message}. ` +
						'Install with: pnpm add tailwind-merge'
				);
			}
		});
	});

	describe('clsx dependency', () => {
		it('clsx should be importable', async () => {
			try {
				const mod = await import('clsx');
				expect(mod).toBeDefined();
			} catch (err) {
				expect.fail(
					`clsx not available: ${(err as Error).message}. ` + 'Install with: pnpm add clsx'
				);
			}
		});
	});
});
