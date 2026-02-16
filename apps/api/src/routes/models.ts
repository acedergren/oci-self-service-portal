import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnabledModelIds } from '../mastra/models/index.js';
import { aiProviderRepository } from '@portal/server/admin';
import { FALLBACK_MODEL_ALLOWLIST, DEFAULT_MODEL } from '../mastra/agents/charlie.js';
import { createLogger } from '@portal/server/logger';

const log = createLogger('api:models');

interface ModelEntry {
	id: string;
	provider: string;
	providerType: string;
}

const ModelsResponseSchema = z.object({
	models: z.array(
		z.object({
			id: z.string(),
			provider: z.string(),
			providerType: z.string()
		})
	),
	defaultModel: z.string(),
	region: z.string(),
	dynamic: z.boolean()
});

export async function modelRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/models',
		{ schema: { response: { 200: ModelsResponseSchema } } },
		async (_request, reply) => {
			const region = process.env.OCI_REGION || 'eu-frankfurt-1';

			try {
				const enabledModelIds = await getEnabledModelIds();

				if (enabledModelIds.length > 0) {
					const activeProviders = await aiProviderRepository.listActive();
					const providerMap = new Map(activeProviders.map((p) => [p.providerId, p]));

					const models: ModelEntry[] = enabledModelIds.map((fullId) => {
						const [providerId] = fullId.split(':');
						const provider = providerMap.get(providerId);
						return {
							id: fullId,
							provider: provider?.displayName ?? providerId,
							providerType: provider?.providerType ?? 'unknown'
						};
					});

					return reply.send({ models, defaultModel: DEFAULT_MODEL, region, dynamic: true });
				}
			} catch (err) {
				log.warn({ err }, 'Failed to load dynamic models, falling back to static list');
			}

			const models: ModelEntry[] = FALLBACK_MODEL_ALLOWLIST.map((id) => ({
				id,
				provider: id.split('.')[0],
				providerType: 'oci'
			}));

			return reply.send({ models, defaultModel: DEFAULT_MODEL, region, dynamic: false });
		}
	);
}
