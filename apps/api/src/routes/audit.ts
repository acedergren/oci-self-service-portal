import type { FastifyInstance } from 'fastify';
import { blockchainAuditRepository } from '@portal/shared/server/oracle/repositories/blockchain-audit-repository';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api:audit');

export async function auditRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/v1/audit/verify',
		{
			preHandler: requireAuth('admin:audit')
		},
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
