import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		alias: {
			$lib: resolve(__dirname, './src/lib')
		}
	}
});
