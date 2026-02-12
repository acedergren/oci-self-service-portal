import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const sharedSrc = resolve(__dirname, '../../packages/shared/src');
const serverSrc = resolve(__dirname, '../../packages/server/src');
const typesSrc = resolve(__dirname, '../../packages/types/src');

export default defineConfig({
	resolve: {
		alias: [
			// Order matters: more specific (subpath) before less specific (bare import).
			//
			// @portal/server — resolve directly to packages/server/src
			{ find: /^@portal\/server\/(.+)$/, replacement: `${serverSrc}/$1` },
			{ find: '@portal/server', replacement: `${serverSrc}/index.ts` },

			// @portal/types — resolve to source for consistent mock identity
			{ find: /^@portal\/types\/(.+)$/, replacement: `${typesSrc}/$1` },
			{ find: '@portal/types', replacement: `${typesSrc}/index.ts` },

			// Moved directories: bypass re-export stubs so vi.mock() targets the
			// same physical file that @portal/server code uses via relative imports.
			{
				find: /^@portal\/shared\/server\/(admin|agent-state|auth|mcp-client|oracle)\/(.+)$/,
				replacement: serverSrc + '/$1/$2'
			},
			{
				find: /^@portal\/shared\/server\/(admin|agent-state|auth|mcp-client|oracle)$/,
				replacement: serverSrc + '/$1/index.ts'
			},

			// Moved individual files
			{
				find: /^@portal\/shared\/server\/(logger|metrics|crypto|feature-flags|approvals|embeddings|rate-limiter|sentry|tracing)(\.js)?$/,
				replacement: serverSrc + '/$1.ts'
			},

			// Everything else in @portal/shared stays on the shared path
			{ find: /^@portal\/shared\/(.+)$/, replacement: `${sharedSrc}/$1` },
			{ find: '@portal/shared', replacement: `${sharedSrc}/index.ts` }
		]
	},
	test: {
		include: ['src/**/*.test.ts'],
		setupFiles: ['src/tests/setup.ts'],
		mockReset: true
	}
});
