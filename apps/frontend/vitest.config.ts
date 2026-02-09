import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		alias: {
			'$lib/server': resolve(__dirname, '../../packages/shared/src/server'),
			'$lib/tools': resolve(__dirname, '../../packages/shared/src/tools'),
			$lib: resolve(__dirname, './src/lib'),
			'@portal/shared': resolve(__dirname, '../../packages/shared/src')
		}
	}
});
