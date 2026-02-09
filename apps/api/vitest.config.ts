import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const sharedSrc = resolve(__dirname, '../../packages/shared/src');

export default defineConfig({
	resolve: {
		alias: [
			// Order matters: more specific (subpath) before less specific (bare import).
			// Uses regex to match @portal/shared/anything and map to the src directory.
			{ find: /^@portal\/shared\/(.+)$/, replacement: `${sharedSrc}/$1` },
			{ find: '@portal/shared', replacement: `${sharedSrc}/index.ts` }
		]
	},
	test: {
		include: ['src/**/*.test.ts'],
		mockReset: true
	}
});
