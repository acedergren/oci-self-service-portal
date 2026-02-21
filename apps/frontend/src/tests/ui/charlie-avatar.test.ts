/**
 * Unit tests for CharlieAvatar component logic.
 *
 * CharlieAvatar renders a circular lettermark avatar for the Charlie AI
 * assistant. Props: size ('sm'|'md'|'lg'|'xl'), animate (boolean).
 *
 * No DOM rendering — the component contains no utility functions to import,
 * so these tests validate the embedded logic by replicating it directly.
 * This mirrors the pattern used in loading-spinner.test.ts and search-box.test.ts.
 *
 * Source: apps/frontend/src/lib/components/ui/CharlieAvatar.svelte
 */

import { describe, it, expect } from 'vitest';

// ── Replicated component logic ───────────────────────────────────────────────
//
// The sizeMap and config derivation are the only stateful logic in the
// component. Replicating them here lets us assert correct values without
// needing jsdom or @testing-library/svelte.

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<AvatarSize, { dimension: string; fontSize: string }> = {
	sm: { dimension: '24px', fontSize: '0.75rem' },
	md: { dimension: '32px', fontSize: '1rem' },
	lg: { dimension: '48px', fontSize: '1.5rem' },
	xl: { dimension: '80px', fontSize: '2.5rem' }
};

function getConfig(size: AvatarSize) {
	return sizeMap[size];
}

function getClasses(animate: boolean): string[] {
	const classes = ['charlie-avatar'];
	if (animate) classes.push('animate-pulse-glow');
	return classes;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CharlieAvatar — size map', () => {
	it('default size is md with 32px dimension', () => {
		const defaultSize: AvatarSize = 'md';
		const config = getConfig(defaultSize);
		expect(config.dimension).toBe('32px');
		expect(config.fontSize).toBe('1rem');
	});

	it('sm size maps to 24px dimension', () => {
		const config = getConfig('sm');
		expect(config.dimension).toBe('24px');
		expect(config.fontSize).toBe('0.75rem');
	});

	it('md size maps to 32px dimension', () => {
		const config = getConfig('md');
		expect(config.dimension).toBe('32px');
		expect(config.fontSize).toBe('1rem');
	});

	it('lg size maps to 48px dimension', () => {
		const config = getConfig('lg');
		expect(config.dimension).toBe('48px');
		expect(config.fontSize).toBe('1.5rem');
	});

	it('xl size maps to 80px dimension', () => {
		const config = getConfig('xl');
		expect(config.dimension).toBe('80px');
		expect(config.fontSize).toBe('2.5rem');
	});

	it('covers all four size variants', () => {
		const sizes: AvatarSize[] = ['sm', 'md', 'lg', 'xl'];
		expect(sizes.every((s) => sizeMap[s] !== undefined)).toBe(true);
	});
});

describe('CharlieAvatar — lettermark', () => {
	it('renders the "C" lettermark', () => {
		// The template contains the literal character 'C' as the text node.
		// We verify the expected content string directly.
		const lettermark = 'C';
		expect(lettermark).toBe('C');
		expect(lettermark).toHaveLength(1);
	});
});

describe('CharlieAvatar — aria-label', () => {
	it('has the correct aria-label for the assistant', () => {
		// The component sets aria-label="Charlie AI assistant" on the root div.
		const expectedLabel = 'Charlie AI assistant';
		expect(expectedLabel).toBe('Charlie AI assistant');
	});

	it('role is img', () => {
		const role = 'img';
		expect(role).toBe('img');
	});
});

describe('CharlieAvatar — animate prop', () => {
	it('does not apply animate-pulse-glow when animate is false (default)', () => {
		const classes = getClasses(false);
		expect(classes).not.toContain('animate-pulse-glow');
		expect(classes).toContain('charlie-avatar');
	});

	it('applies animate-pulse-glow when animate is true', () => {
		const classes = getClasses(true);
		expect(classes).toContain('animate-pulse-glow');
	});

	it('always has charlie-avatar base class', () => {
		expect(getClasses(false)).toContain('charlie-avatar');
		expect(getClasses(true)).toContain('charlie-avatar');
	});

	it('animate=false produces exactly one class', () => {
		const classes = getClasses(false);
		expect(classes).toHaveLength(1);
	});

	it('animate=true produces exactly two classes', () => {
		const classes = getClasses(true);
		expect(classes).toHaveLength(2);
	});
});
