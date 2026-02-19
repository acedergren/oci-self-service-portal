/**
 * Phase 5 TDD: Component Extraction from self-service page
 *
 * The self-service page (~2000 lines) is being decomposed into smaller
 * reusable components under $lib/components/portal/.
 *
 * Architect spec (types.ts):
 *   +page.svelte (orchestrator, ~120 lines)
 *   +-- HeroSection (contains SearchBox, QuickActionBar, HeroGraphic)
 *   +-- ServiceCategoryGrid (contains ServiceCategoryCard)
 *   +-- WorkflowGallery (contains WorkflowCard)
 *   +-- BottomInfoSection (contains RecentActivityPanel, ResourceLinksPanel, HelpPanel)
 *   +-- ChatOverlay (contains ChatMessageList, ChatMessage, ToolCallCard, TypingIndicator, ChatInput)
 *
 * Note: .svelte files cannot be dynamically imported in vitest (no Svelte
 * compiler). Tests verify file existence via fs and validate the barrel
 * export source, types module, and self-service page structure.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

const PORTAL_DIR = resolve(process.cwd(), 'src/lib/components/portal');

// ── Top-level components expected from portal barrel ──────────────────────

const TOP_LEVEL_COMPONENTS = [
	'HeroSection',
	'ServiceCategoryGrid',
	'WorkflowGallery',
	'BottomInfoSection',
	'ChatOverlay'
];

// ── Child / internal components ───────────────────────────────────────────

const CHILD_COMPONENTS = [
	'QuickActionBar',
	'ServiceCategoryCard',
	'WorkflowCard',
	'RecentActivityPanel',
	'ResourceLinksPanel',
	'HelpPanel'
];

// ── Chat sub-components (already created) ─────────────────────────────────

const CHAT_COMPONENTS = [
	'ChatInput',
	'ChatMessage',
	'ChatMessageList',
	'ToolCallCard',
	'TypingIndicator'
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Component Extraction (Phase 5.1)', () => {
	describe('portal directory structure', () => {
		it('portal directory exists', () => {
			expect(existsSync(PORTAL_DIR)).toBe(true);
		});

		it('types.ts exists', () => {
			expect(existsSync(resolve(PORTAL_DIR, 'types.ts'))).toBe(true);
		});

		it('index.ts barrel exists', () => {
			expect(existsSync(resolve(PORTAL_DIR, 'index.ts'))).toBe(true);
		});
	});

	describe('portal types module', () => {
		it('portal types module should be importable', async () => {
			const mod = await import('$lib/components/portal/types.js');
			expect(mod).toBeDefined();
		});
	});

	describe('top-level components', () => {
		for (const name of TOP_LEVEL_COMPONENTS) {
			it(`${name}.svelte file exists`, () => {
				const filePath = resolve(PORTAL_DIR, `${name}.svelte`);
				expect(
					existsSync(filePath),
					`Expected ${name}.svelte at ${filePath}. Create per Phase 5.1 spec.`
				).toBe(true);
			});
		}
	});

	describe('child components', () => {
		for (const name of CHILD_COMPONENTS) {
			it(`${name}.svelte file exists`, () => {
				const filePath = resolve(PORTAL_DIR, `${name}.svelte`);
				expect(
					existsSync(filePath),
					`Expected ${name}.svelte at ${filePath}. Create per Phase 5.1 spec.`
				).toBe(true);
			});
		}
	});

	describe('chat sub-components (already created)', () => {
		for (const name of CHAT_COMPONENTS) {
			it(`${name}.svelte file exists`, () => {
				const filePath = resolve(PORTAL_DIR, `${name}.svelte`);
				expect(existsSync(filePath), `Expected ${name}.svelte at ${filePath}.`).toBe(true);
			});
		}
	});

	describe('barrel export source validation', () => {
		it('barrel index.ts re-exports all top-level components', async () => {
			const { readFileSync } = await import('fs');
			const barrelSource = readFileSync(resolve(PORTAL_DIR, 'index.ts'), 'utf-8');

			for (const name of TOP_LEVEL_COMPONENTS) {
				expect(barrelSource, `Barrel should re-export ${name}`).toContain(`${name}`);
			}
		});

		it('barrel index.ts re-exports all child components', async () => {
			const { readFileSync } = await import('fs');
			const barrelSource = readFileSync(resolve(PORTAL_DIR, 'index.ts'), 'utf-8');

			for (const name of CHILD_COMPONENTS) {
				expect(barrelSource, `Barrel should re-export ${name}`).toContain(`${name}`);
			}
		});

		it('barrel index.ts re-exports all chat components', async () => {
			const { readFileSync } = await import('fs');
			const barrelSource = readFileSync(resolve(PORTAL_DIR, 'index.ts'), 'utf-8');

			for (const name of CHAT_COMPONENTS) {
				expect(barrelSource, `Barrel should re-export ${name}`).toContain(`${name}`);
			}
		});

		it('barrel index.ts re-exports types', async () => {
			const { readFileSync } = await import('fs');
			const barrelSource = readFileSync(resolve(PORTAL_DIR, 'index.ts'), 'utf-8');

			expect(barrelSource).toContain('ServiceCategory');
			expect(barrelSource).toContain('ActivityItem');
		});
	});

	describe('portal root page', () => {
		it('portal root page file exists', () => {
			const pagePath = resolve(process.cwd(), 'src/routes/+page.svelte');
			expect(existsSync(pagePath), 'Portal root page should exist at src/routes/+page.svelte').toBe(
				true
			);
		});
	});
});
