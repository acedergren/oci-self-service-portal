import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	optimizeDeps: {
		exclude: ['@tanstack/svelte-query']
	},
	ssr: {
		noExternal: ['@tanstack/svelte-query'],
		// Externalize native binaries and heavy server deps to prevent SSR bundling.
		// Note: workspace packages with .ts exports (@portal/shared, @portal/types)
		// get bundled regardless since Vite can't emit bare imports for .ts sources.
		external: [
			// Database drivers (native binaries)
			'oracledb',
			'better-sqlite3',
			// Heavy server SDKs
			'oci-sdk',
			// Server utilities
			'pino',
			'ws',
			'@sentry/node',
			'@modelcontextprotocol/sdk',
			// Workspace packages (contain server-only code + native deps)
			'@portal/server',
			'@portal/shared',
			'@portal/types'
		]
	},
	build: {
		// Disable source maps to save memory during build
		sourcemap: false,
		// Reduce memory usage during minification
		minify: 'esbuild',
		rollupOptions: {
			// Prevent native/heavy server deps from entering the client bundle.
			// @portal/shared and @portal/types are intentionally omitted here:
			// client-side .svelte files import isomorphic modules from them.
			external: [
				'ws',
				'@sentry/node',
				'oracledb',
				'better-sqlite3',
				'oci-sdk',
				'pino',
				'@modelcontextprotocol/sdk',
				'@portal/server'
			],
			output: {
				// Split SSR server bundle vendors to reduce Rollup memory pressure
				manualChunks(id) {
					// Vendor chunks for large dependencies
					if (id.includes('node_modules')) {
						if (id.includes('@xyflow')) return 'xyflow';
						if (id.includes('@sentry')) return 'sentry';
						if (id.includes('layerchart')) return 'layerchart';
						if (id.includes('@tanstack')) return 'tanstack';
						if (id.includes('better-auth')) return 'better-auth';
						// Rest of vendor code
						return 'vendor';
					}
				},
				// Warn on large chunks
				chunkFileNames: 'chunks/[name]-[hash].js'
			}
		},
		// Increase chunk size warning threshold (default 500 KiB)
		chunkSizeWarningLimit: 1000 // 1 MB warning threshold
	}
});
