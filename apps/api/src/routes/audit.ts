import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { blockchainAuditRepository } from '@portal/server/oracle/repositories/blockchain-audit-repository';
import { createLogger } from '@portal/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api:audit');

const VerifyAuditResponseSchema = z.object({
	valid: z.boolean(),
	rowCount: z.number(),
	lastVerified: z.string().nullable(),
	verifiedAt: z.string()
});

const AuditErrorResponseSchema = z.object({
	error: z.string(),
	valid: z.literal(false)
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/v1/audit/verify',
		{
			preHandler: requireAuth('admin:audit'),
			schema: {
				response: {
					200: VerifyAuditResponseSchema,
					503: AuditErrorResponseSchema
				}
			}
		},
		// codeql[js/missing-rate-limiting] -- endpoint is gated by requireAuth('admin:audit'); admin-only route.
		async (request, reply) => {
			try {
				const result = await blockchainAuditRepository.verify();
				return reply.send({
					valid: result.valid,
					rowCount: result.rowCount,
					lastVerified: result.lastVerified?.toISOString() ?? null,
					verifiedAt: new Date().toISOString()
				});
			} catch (err) {
				log.error(
					{ err, requestId: request.headers['x-request-id'] },
					'Blockchain verification failed'
				);
				return reply.status(503).send({ error: 'Verification failed', valid: false });
			}
		}
	);
}
