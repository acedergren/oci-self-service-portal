/**
 * GET /api/v1/audit/verify — Validate blockchain audit chain integrity.
 *
 * Requires admin:audit permission. Uses Oracle's DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS
 * to confirm no rows in the audit_blockchain table have been tampered with.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireApiAuth } from '@portal/shared/server/api/require-auth';
import { blockchainAuditRepository } from '@portal/server/oracle/repositories/blockchain-audit-repository';
import { createLogger } from '@portal/server/logger';

const log = createLogger('api:audit:verify');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'admin:audit');

	try {
		const result = await blockchainAuditRepository.verify();

		return json({
			valid: result.valid,
			rowCount: result.rowCount,
			lastVerified: result.lastVerified?.toISOString() ?? null,
			verifiedAt: new Date().toISOString()
		});
	} catch (err) {
		log.error({ err, requestId: event.locals.requestId }, 'Blockchain verification failed');
		return json({ error: 'Verification failed', valid: false }, { status: 503 });
	}
};
