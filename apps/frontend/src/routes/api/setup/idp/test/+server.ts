/**
 * POST /api/setup/idp/test
 *
 * Test IDP connection by fetching discovery URL and validating endpoints.
 * Does not create a provider — just validates configuration.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSetupToken } from '@portal/server/admin';
import { createLogger } from '@portal/server/logger';
import { isValidExternalUrl } from '@portal/shared/server/url-validation';
import { toPortalError } from '@portal/server/errors';
import { z } from 'zod';

const log = createLogger('setup');

const TestIdpInputSchema = z.object({
	discoveryUrl: z.string().url().optional(),
	authorizationUrl: z.string().url().optional(),
	tokenUrl: z.string().url().optional(),
	jwksUrl: z.string().url().optional()
});

export const POST: RequestHandler = async ({ request, fetch }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Require setup token for bootstrap auth
		const denied = await validateSetupToken(request);
		if (denied) return denied;

		// Parse and validate input
		const body = await request.json();
		const input = TestIdpInputSchema.parse(body);

		const details: Record<string, unknown> = {};

		// Test 1: Fetch discovery document if provided
		if (input.discoveryUrl) {
			// SSRF prevention: validate URL before fetching
			if (!isValidExternalUrl(input.discoveryUrl)) {
				return json(
					{
						success: false,
						message:
							'Invalid discovery URL: must be HTTPS and not target private networks or localhost',
						details: { discoveryUrl: input.discoveryUrl }
					},
					{ status: 200 }
				);
			}

			try {
				const response = await fetch(input.discoveryUrl, {
					headers: { Accept: 'application/json' }
				});

				if (!response.ok) {
					return json(
						{
							success: false,
							message: `Discovery URL returned ${response.status}`,
							details: { discoveryUrl: input.discoveryUrl, status: response.status }
						},
						{ status: 200 }
					);
				}

				const discovery = await response.json();
				details.discoveryEndpoints = {
					authorization: discovery.authorization_endpoint,
					token: discovery.token_endpoint,
					userinfo: discovery.userinfo_endpoint,
					jwks: discovery.jwks_uri
				};

				// Validate required endpoints exist
				if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
					return json(
						{
							success: false,
							message: 'Discovery document missing required endpoints',
							details
						},
						{ status: 200 }
					);
				}
			} catch (err) {
				const portalError = toPortalError(err);
				return json(
					{
						success: false,
						message: `Failed to fetch discovery URL: ${portalError.message}`,
						details: { discoveryUrl: input.discoveryUrl }
					},
					{ status: 200 }
				);
			}
		}

		// Test 2: Validate manual endpoint configuration
		if (!input.discoveryUrl) {
			if (!input.authorizationUrl || !input.tokenUrl) {
				return json(
					{
						success: false,
						message: 'Either discoveryUrl or both authorizationUrl and tokenUrl are required',
						details: input
					},
					{ status: 200 }
				);
			}

			// SSRF prevention: validate manual URLs (S-5)
			const urlsToValidate = [input.authorizationUrl, input.tokenUrl, input.jwksUrl].filter(
				Boolean
			) as string[];
			for (const url of urlsToValidate) {
				if (!isValidExternalUrl(url)) {
					return json(
						{
							success: false,
							message:
								'Invalid endpoint URL: must be HTTPS and not target private networks or localhost',
							details: { invalidUrl: url }
						},
						{ status: 200 }
					);
				}
			}

			details.manualEndpoints = {
				authorization: input.authorizationUrl,
				token: input.tokenUrl,
				jwks: input.jwksUrl
			};
		}

		log.info({ requestId, hasDiscovery: !!input.discoveryUrl }, 'IDP connection test passed');

		return json({
			success: true,
			message: 'IDP configuration is valid',
			details
		});
	} catch (err) {
		log.error({ err, requestId }, 'IDP connection test failed');

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
