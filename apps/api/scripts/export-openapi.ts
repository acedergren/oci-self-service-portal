#!/usr/bin/env tsx
/**
 * Export OpenAPI spec from Fastify swagger plugin.
 *
 * Usage:
 *   pnpm --filter @portal/api swagger:export
 *   # or from apps/api:
 *   npx tsx scripts/export-openapi.ts [output-path]
 *
 * Default output: ../../openapi.json (repo root)
 *
 * Used by Spectral (OWASP linting) and Cherrybomb (API security analysis).
 * Oracle/auth failures are non-fatal — only route schemas are needed.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createApp } from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Skip '--' separator that pnpm passes when using `pnpm run script -- args`
const args = process.argv.slice(2).filter((a) => a !== '--');
const outPath = args[0] || resolve(__dirname, '../../../openapi.json');

async function main() {
	const app = await createApp({
		enableDocs: true,
		enableRateLimit: false,
		enableHelmet: false
	});

	await app.ready();

	const spec = app.swagger();
	writeFileSync(outPath, JSON.stringify(spec, null, 2));
	console.log(`OpenAPI spec written to ${outPath} (${Object.keys(spec.paths || {}).length} paths)`);

	await app.close();
	process.exit(0);
}

main().catch((err) => {
	console.error('Failed to export OpenAPI spec:', err);
	process.exit(1);
});
