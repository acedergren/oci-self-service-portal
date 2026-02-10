import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const sharedSrc = resolve(__dirname, '../../packages/shared/src');
const serverSrc = resolve(__dirname, '../../packages/server/src');
const typesSrc = resolve(__dirname, '../../packages/types/src');

export default defineConfig({
	resolve: {
		alias: [
			// @portal/server — resolve directly to packages/server/src
			{ find: /^@portal\/server\/(.+)$/, replacement: `${serverSrc}/$1` },
			{ find: '@portal/server', replacement: `${serverSrc}/index.ts` },

			// @portal/types — resolve to source for consistent mock identity
			{ find: /^@portal\/types\/(.+)$/, replacement: `${typesSrc}/$1` },
			{ find: '@portal/types', replacement: `${typesSrc}/index.ts` },

			// $lib/server moved directories: bypass re-export stubs so vi.mock()
			// targets the same physical file that @portal/server code reaches via
			// relative imports. Stubs' re-exports will also flow through the mock.
			{
				find: /^\$lib\/server\/(admin|agent-state|auth|mcp-client|oracle)\/(.+)$/,
				replacement: serverSrc + '/$1/$2'
			},
			{
				find: /^\$lib\/server\/(admin|agent-state|auth|mcp-client|oracle)$/,
				replacement: serverSrc + '/$1/index.ts'
			},

			// $lib/server moved individual files
			{
				find: /^\$lib\/server\/(logger|metrics|crypto|feature-flags|approvals|embeddings|rate-limiter|sentry|tracing)(\.js)?$/,
				replacement: serverSrc + '/$1.ts'
			},

			// $lib/server fallback — stayed modules resolve to shared
			{ find: '$lib/server', replacement: `${sharedSrc}/server` },

			// $lib/tools stays in shared
			{ find: '$lib/tools', replacement: `${sharedSrc}/tools` },

			// $lib — SvelteKit source
			{ find: '$lib', replacement: resolve(__dirname, './src/lib') },

			// @portal/shared moved directories: bypass stubs for same mock identity
			{
				find: /^@portal\/shared\/server\/(admin|agent-state|auth|mcp-client|oracle)\/(.+)$/,
				replacement: serverSrc + '/$1/$2'
			},
			{
				find: /^@portal\/shared\/server\/(admin|agent-state|auth|mcp-client|oracle)$/,
				replacement: serverSrc + '/$1/index.ts'
			},

			// @portal/shared moved individual files
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
		include: ['src/**/*.test.ts']
	}
});
