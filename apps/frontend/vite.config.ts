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
		// Externalize server-only dependencies and workspace packages to prevent bundling
		external: [
			// Database drivers (native binaries)
			'oracledb',
			'better-sqlite3',
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
			// Prevent native/heavy server deps from entering the client bundle
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
				// Manual chunking to prevent memory exhaustion
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
