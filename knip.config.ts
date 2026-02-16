import type { KnipConfig } from 'knip';

/**
 * Knip configuration for OCI Self-Service Portal monorepo
 *
 * Detects:
 * - Unused dependencies (both prod and dev)
 * - Unused exports (dead code)
 * - Unused files
 *
 * See: https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
	// Check all workspaces defined in pnpm-workspace.yaml
	workspaces: {
		'.': {
			// Root workspace - typically only dev tooling
			entry: ['**/*.config.{js,ts,mjs,cjs}', '.githooks/**/*'],
			project: ['**/*.{js,ts,mjs,cjs}'],
			ignore: [
				'**/node_modules/**',
				'**/dist/**',
				'**/build/**',
				'**/.svelte-kit/**',
				'**/coverage/**',
				'**/vitest.config.ts' // Vitest configs are used via CLI, not imported
			]
		},
		'apps/api': {
			entry: [
				'src/index.ts',
				'src/app.ts',
				'src/**/*.test.ts',
				'src/tests/**/*.ts',
				'vitest.config.ts'
			],
			project: ['src/**/*.ts'],
			ignore: [
				'src/**/*.test.ts',
				'src/**/*.spec.ts',
				'src/tests/**/*',
				'src/**/*.d.ts',
				'dist/**'
			],
			// Ignore common test/config dependencies that appear unused
			ignoreDependencies: [
				'tsx', // Used by package.json scripts
				'@types/node', // Type-only dependency
				'vitest' // CLI usage
			]
		},
		'apps/frontend': {
			entry: [
				'src/app.html',
				'src/hooks.server.ts',
				'src/routes/**/*.{ts,svelte}',
				'src/lib/**/*.ts',
				'src/**/*.test.ts',
				'vitest.config.ts',
				'svelte.config.js'
			],
			project: ['src/**/*.{ts,svelte}'],
			ignore: [
				'src/**/*.test.ts',
				'src/**/*.spec.ts',
				'src/**/*.d.ts',
				'build/**',
				'.svelte-kit/**'
			],
			ignoreDependencies: [
				'@sveltejs/adapter-node', // Used by svelte.config.js
				'@sveltejs/vite-plugin-svelte', // Used by svelte.config.js
				'@types/node',
				'vitest',
				'svelte',
				'vite'
			]
		},
		'packages/shared': {
			entry: ['src/index.ts', 'src/**/*.test.ts', 'vitest.config.ts'],
			project: ['src/**/*.ts'],
			ignore: [
				'src/**/*.test.ts',
				'src/**/*.spec.ts',
				'src/**/*.d.ts',
				'dist/**',
				// Oracle migrations are data files, not code modules
				'src/server/oracle/migrations/**/*.sql'
			],
			ignoreDependencies: [
				'@types/node',
				'vitest',
				'@types/better-auth' // Type-only
			]
		}
	},

	// Global ignores across all workspaces
	ignore: [
		'**/node_modules/**',
		'**/dist/**',
		'**/build/**',
		'**/.svelte-kit/**',
		'**/coverage/**',
		'**/*.config.{js,ts,mjs,cjs}', // Config files often have unused exports
		'**/*.d.ts', // Type declaration files
		'**/*.sql', // SQL migration files
		'**/*.md', // Documentation
		'.githooks/**', // Git hooks are executed, not imported
		'.claude/**' // Claude Code configuration
	],

	// Ignore specific dependency patterns
	ignoreDependencies: [
		// CLI tools used via npm scripts
		'tsx',
		'typescript',
		'vitest'
	],

	// Don't report unused exports in test files
	ignoreExportsUsedInFile: {
		interface: true,
		type: true
	}
};

export default config;
