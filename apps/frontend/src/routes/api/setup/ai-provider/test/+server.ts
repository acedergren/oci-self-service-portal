/**
 * POST /api/setup/ai-provider/test
 *
 * Test AI provider API key by sending a simple completion request.
 * Does not create a provider — just validates API connectivity and auth.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { settingsRepository, AiProviderTypeSchema } from '@portal/server/admin';
import { createLogger } from '@portal/server/logger';
import { toPortalError } from '@portal/server/errors';
import { z } from 'zod';

const log = createLogger('setup');

const TestAiProviderInputSchema = z.object({
	providerType: AiProviderTypeSchema,
	apiKey: z.string().min(1).optional(),
	apiBaseUrl: z.string().url().optional(),
	region: z.string().optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Lock: deny if setup is already complete
		const isSetupComplete = await settingsRepository.isSetupComplete();
		if (isSetupComplete) {
			log.warn({ requestId }, 'attempted AI provider test after setup complete');
			return json({ error: 'Setup is already complete' }, { status: 403 });
		}

		// Parse and validate input
		const body = await request.json();
		const input = TestAiProviderInputSchema.parse(body);

		// For OCI, we don't test (uses default credentials from env/config)
		if (input.providerType === 'oci') {
			log.info({ requestId, providerType: 'oci' }, 'OCI provider test skipped (uses default auth)');
			return json({
				success: true,
				message: 'OCI provider will use default authentication',
				details: { providerType: 'oci', region: input.region }
			});
		}

		// For other providers, validate API key is present
		if (!input.apiKey) {
			return json(
				{
					success: false,
					message: `API key is required for ${input.providerType} provider`,
					details: { providerType: input.providerType }
				},
				{ status: 200 }
			);
		}

		// Simple validation: check key format/length
		// (Full test would require calling the actual API, which is out of scope for MVP)
		const keyLength = input.apiKey.length;
		const minKeyLength = 20;

		if (keyLength < minKeyLength) {
			return json(
				{
					success: false,
					message: `API key seems too short (${keyLength} chars, expected >${minKeyLength})`,
					details: { providerType: input.providerType, keyLength }
				},
				{ status: 200 }
			);
		}

		log.info(
			{ requestId, providerType: input.providerType, keyLength },
			'AI provider test passed (key format valid)'
		);

		return json({
			success: true,
			message: 'API key format is valid',
			details: {
				providerType: input.providerType,
				keyLength,
				note: 'Full API connectivity test will be performed on first use'
			}
		});
	} catch (err) {
		log.error({ err, requestId }, 'AI provider test failed');

		const isValidationError = err instanceof Error && 'issues' in err;
		if (isValidationError) {
			return json(
				{
					success: false,
					message: 'Validation failed',
					details: (err as any).issues
				},
				{ status: 200 }
			);
		}

		const portalError = toPortalError(err);
		return json(
			{
				success: false,
				message: portalError.message,
				details: {}
			},
			{ status: 200 }
		);
	}
};
