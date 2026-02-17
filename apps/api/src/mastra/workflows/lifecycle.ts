/**
 * Workflow Lifecycle Callbacks
 *
 * Hooks for workflow completion and error scenarios:
 * - onWorkflowFinish: writes run result to Oracle audit log
 * - onWorkflowError: reports error to Sentry with context
 */

import { createLogger } from '@portal/server/logger';
import { captureError } from '@portal/server/sentry';
import { withConnection } from '@portal/server/oracle';
import { randomUUID } from 'crypto';

const log = createLogger('workflows:lifecycle');

/**
 * Called when a workflow run completes successfully.
 * Writes an audit record to the Oracle database using the withConnection pattern.
 *
 * @param runId - The workflow run ID
 * @param result - The final workflow result
 * @param orgId - The organization ID for audit isolation
 */
export async function onWorkflowFinish(
	runId: string,
	result: unknown,
	orgId: string
): Promise<void> {
	try {
		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO workflow_audit_log
				   (id, run_id, org_id, event_type, result, created_at)
				 VALUES
				   (:id, :runId, :orgId, :eventType, :result, :createdAt)`,
				{
					id: randomUUID(),
					runId,
					orgId,
					eventType: 'finish',
					result: JSON.stringify(result),
					createdAt: new Date()
				}
			);
		});

		log.info({ runId, orgId }, 'Workflow completed and audited');
	} catch (err) {
		log.error({ err, runId, orgId }, 'Failed to audit workflow completion');
		// Don't throw — audit logging should not block workflow completion
	}
}

/**
 * Called when a workflow run encounters an error.
 * Reports the error to Sentry with workflow context.
 *
 * @param runId - The workflow run ID
 * @param error - The error that occurred
 * @param context - Additional context (orgId, userId, toolName, etc.)
 */
export function onWorkflowError(
	runId: string,
	error: Error,
	context: Record<string, unknown> = {}
): void {
	try {
		captureError(error, {
			runId,
			...context
		});

		log.error({ err: error, runId, context }, 'Workflow error captured');
	} catch (err) {
		log.warn({ err }, 'Failed to capture workflow error in Sentry');
		// Don't throw — error reporting should not block error handling
	}
}
