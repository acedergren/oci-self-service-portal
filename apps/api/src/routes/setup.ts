import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	aiProviderRepository,
	AiProviderTypeSchema,
	BulkSetSettingsInputSchema,
	CreateAiProviderInputSchema,
	CreateIdpInputSchema,
	idpRepository,
	invalidateSetupToken,
	settingsRepository,
	stripAiProviderSecrets,
	stripIdpSecrets,
	validateSetupToken
} from '@portal/shared/server/admin';
import { isValidExternalUrl } from '@portal/shared/server/url-validation';

const TestIdpInputSchema = z.object({
	discoveryUrl: z.string().url().optional(),
	authorizationUrl: z.string().url().optional(),
	tokenUrl: z.string().url().optional(),
	jwksUrl: z.string().url().optional()
});

const TestAiProviderInputSchema = z.object({
	providerType: AiProviderTypeSchema,
	apiKey: z.string().min(1).optional(),
	apiBaseUrl: z.string().url().optional(),
	region: z.string().optional()
});

const SetupErrorResponseSchema = z
	.object({
		error: z.string()
	})
	.passthrough();

const SetupStatusResponseSchema = z.object({
	isSetupComplete: z.boolean(),
	steps: z.object({
		idp: z.boolean(),
		aiProvider: z.boolean(),
		settings: z.boolean()
	}),
	activeIdpCount: z.number(),
	activeAiProviderCount: z.number(),
	defaultIdpId: z.string().nullable(),
	defaultAiProviderId: z.string().nullable()
});

const SetupTestResultSchema = z
	.object({
		success: z.boolean(),
		message: z.string()
	})
	.passthrough();

const SetupCompleteResponseSchema = z.object({
	success: z.literal(true),
	message: z.string(),
	idpCount: z.number(),
	aiProviderCount: z.number()
});

const SetupSettingsResponseSchema = z.object({
	success: z.literal(true),
	count: z.number()
});

async function toWebRequest(request: FastifyRequest): Promise<Request> {
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}

	const url = `${request.protocol}://${request.hostname}${request.url}`;
	return new Request(url, { method: request.method, headers }) as Request;
}

async function sendDeniedResponse(denied: Response, reply: FastifyReply): Promise<void> {
	let payload: unknown = {};
	try {
		payload = await denied.json();
	} catch {
		payload = { error: denied.statusText || 'Request denied' };
	}
	reply.status(denied.status).send(payload);
}

async function requireSetupToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const denied = await validateSetupToken(await toWebRequest(request));
	if (denied) {
		await sendDeniedResponse(denied, reply);
		return;
	}
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/setup/status',
		{
			preHandler: requireSetupToken,
			schema: {
				response: {
					200: SetupStatusResponseSchema,
					401: SetupErrorResponseSchema,
					403: SetupErrorResponseSchema
				}
			}
		},
		async (_request, reply) => {
			const isSetupComplete = await settingsRepository.isSetupComplete();
			const [idps, aiProviders] = await Promise.all([
				idpRepository.listActive(),
				aiProviderRepository.listActive()
			]);

			const defaultIdp = idps.find((idp) => idp.isDefault);
			const defaultAiProvider = aiProviders.find((p) => p.isDefault);

			return reply.send({
				isSetupComplete,
				steps: {
					idp: idps.length > 0,
					aiProvider: aiProviders.length > 0,
					settings: isSetupComplete
				},
				activeIdpCount: idps.length,
				activeAiProviderCount: aiProviders.length,
				defaultIdpId: defaultIdp?.id ?? null,
				defaultAiProviderId: defaultAiProvider?.id ?? null
			});
		}
	);

	app.post(
		'/api/setup/idp',
		{
			preHandler: requireSetupToken,
			schema: {
				body: CreateIdpInputSchema,
				response: { 201: z.object({ id: z.string() }).passthrough() }
			}
		},
		async (request, reply) => {
			const idp = await idpRepository.create(request.body as z.infer<typeof CreateIdpInputSchema>);
			return reply.status(201).send(stripIdpSecrets(idp));
		}
	);

	app.post(
		'/api/setup/idp/test',
		{
			preHandler: requireSetupToken,
			schema: {
				body: TestIdpInputSchema,
				response: { 200: SetupTestResultSchema }
			}
		},
		async (request, reply) => {
			const input = request.body as z.infer<typeof TestIdpInputSchema>;
			const details: Record<string, unknown> = {};

			if (input.discoveryUrl) {
				if (!isValidExternalUrl(input.discoveryUrl)) {
					return reply.send({
						success: false,
						message:
							'Invalid discovery URL: must be HTTPS and not target private networks or localhost',
						details: { discoveryUrl: input.discoveryUrl }
					});
				}

				const response = await fetch(input.discoveryUrl, {
					headers: { Accept: 'application/json' }
				});
				if (!response.ok) {
					return reply.send({
						success: false,
						message: `Discovery URL returned ${response.status}`,
						details: { discoveryUrl: input.discoveryUrl, status: response.status }
					});
				}

				const discovery = (await response.json()) as {
					authorization_endpoint?: string;
					token_endpoint?: string;
					userinfo_endpoint?: string;
					jwks_uri?: string;
				};
				details.discoveryEndpoints = {
					authorization: discovery.authorization_endpoint,
					token: discovery.token_endpoint,
					userinfo: discovery.userinfo_endpoint,
					jwks: discovery.jwks_uri
				};

				if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
					return reply.send({
						success: false,
						message: 'Discovery document missing required endpoints',
						details
					});
				}
			}

			if (!input.discoveryUrl) {
				if (!input.authorizationUrl || !input.tokenUrl) {
					return reply.send({
						success: false,
						message: 'Either discoveryUrl or both authorizationUrl and tokenUrl are required',
						details: input
					});
				}

				const urls = [input.authorizationUrl, input.tokenUrl, input.jwksUrl].filter(Boolean);
				for (const url of urls) {
					if (!isValidExternalUrl(url as string)) {
						return reply.send({
							success: false,
							message:
								'Invalid endpoint URL: must be HTTPS and not target private networks or localhost',
							details: { invalidUrl: url }
						});
					}
				}
			}

			return reply.send({ success: true, message: 'IDP configuration is valid', details });
		}
	);

	app.post(
		'/api/setup/ai-provider',
		{
			preHandler: requireSetupToken,
			schema: {
				body: CreateAiProviderInputSchema,
				response: { 201: z.object({ id: z.string() }).passthrough() }
			}
		},
		async (request, reply) => {
			const provider = await aiProviderRepository.create(
				request.body as z.infer<typeof CreateAiProviderInputSchema>
			);
			return reply.status(201).send(stripAiProviderSecrets(provider));
		}
	);

	app.post(
		'/api/setup/ai-provider/test',
		{
			schema: {
				body: TestAiProviderInputSchema,
				response: {
					200: SetupTestResultSchema,
					403: SetupErrorResponseSchema
				}
			}
		},
		async (request, reply) => {
			const isSetupComplete = await settingsRepository.isSetupComplete();
			if (isSetupComplete) {
				return reply.status(403).send({ error: 'Setup is already complete' });
			}

			const input = request.body as z.infer<typeof TestAiProviderInputSchema>;
			if (input.providerType === 'oci') {
				return reply.send({
					success: true,
					message: 'OCI provider will use default authentication',
					details: { providerType: 'oci', region: input.region }
				});
			}

			if (!input.apiKey) {
				return reply.send({
					success: false,
					message: `API key is required for ${input.providerType} provider`,
					details: { providerType: input.providerType }
				});
			}

			const keyLength = input.apiKey.length;
			if (keyLength < 20) {
				return reply.send({
					success: false,
					message: `API key seems too short (${keyLength} chars, expected >20)`,
					details: { providerType: input.providerType, keyLength }
				});
			}

			return reply.send({
				success: true,
				message: 'API key format is valid',
				details: {
					providerType: input.providerType,
					keyLength,
					note: 'Full API connectivity test will be performed on first use'
				}
			});
		}
	);

	app.post(
		'/api/setup/settings',
		{
			preHandler: requireSetupToken,
			schema: {
				body: BulkSetSettingsInputSchema,
				response: { 200: SetupSettingsResponseSchema }
			}
		},
		async (request, reply) => {
			const input = request.body as z.infer<typeof BulkSetSettingsInputSchema>;
			await settingsRepository.bulkSet(input.settings);
			return reply.send({ success: true, count: input.settings.length });
		}
	);

	app.post(
		'/api/setup/complete',
		{
			preHandler: requireSetupToken,
			schema: {
				response: {
					200: SetupCompleteResponseSchema,
					400: SetupErrorResponseSchema,
					401: SetupErrorResponseSchema,
					403: SetupErrorResponseSchema
				}
			}
		},
		async (_request, reply) => {
			const [idps, aiProviders] = await Promise.all([
				idpRepository.listActive(),
				aiProviderRepository.listActive()
			]);

			if (idps.length === 0) {
				return reply
					.status(400)
					.send({ error: 'Cannot complete setup: no IDP providers configured' });
			}

			if (aiProviders.length === 0) {
				return reply
					.status(400)
					.send({ error: 'Cannot complete setup: no AI providers configured' });
			}

			await settingsRepository.markSetupComplete();
			invalidateSetupToken();

			return reply.send({
				success: true,
				message: 'Setup completed successfully',
				idpCount: idps.length,
				aiProviderCount: aiProviders.length
			});
		}
	);
}
