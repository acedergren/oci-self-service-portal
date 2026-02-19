/**
 * CloudAdvisor findings repository.
 *
 * Handles persistence and retrieval of CloudAdvisor Finding and RunSummary
 * records in Oracle. Upsert semantics prevent duplicate active findings for
 * the same resource and issue.
 */

import type { OracleConnection } from '@portal/server/oracle/connection';
import {
	FindingSchema,
	RunSummarySchema,
	type Finding,
	type FindingDomain,
	type FindingSeverity,
	type FindingStatus,
	type RunSummary
} from '../mastra/findings.js';

type WithConnectionFn = <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;

// ── Row types (Oracle UPPERCASE keys) ─────────────────────────────────────────

interface FindingRow {
	ID: string;
	RUN_ID: string;
	DOMAIN: string;
	SEVERITY: string;
	CONFIDENCE: string;
	TITLE: string;
	SUMMARY: string;
	IMPACT: string;
	RECOMMENDATION: string;
	CHARLIE_ACTION: string | null;
	RESOURCES: string;
	METADATA: string | null;
	STATUS: string;
	CREATED_AT: Date;
	EXPIRES_AT: Date | null;
	UPDATED_AT: Date;
}

interface RunRow {
	RUN_ID: string;
	DOMAIN: string | null;
	STATUS: string;
	STARTED_AT: Date;
	COMPLETED_AT: Date | null;
	DURATION_MS: number | null;
	FINDING_COUNT: number;
	CRITICAL_COUNT: number;
	HIGH_COUNT: number;
	MEDIUM_COUNT: number;
	LOW_COUNT: number;
	INFO_COUNT: number;
	ESTIMATED_SAVINGS: number;
	SUMMARY_JSON: string | null;
}

// ── Converters ────────────────────────────────────────────────────────────────

function rowToFinding(row: FindingRow): Finding {
	return FindingSchema.parse({
		id: row.ID,
		runId: row.RUN_ID,
		domain: row.DOMAIN,
		severity: row.SEVERITY,
		confidence: row.CONFIDENCE,
		title: row.TITLE,
		summary: row.SUMMARY,
		impact: row.IMPACT,
		recommendation: row.RECOMMENDATION,
		charlieAction: row.CHARLIE_ACTION ? JSON.parse(row.CHARLIE_ACTION) : undefined,
		resources: JSON.parse(row.RESOURCES),
		metadata: row.METADATA ? JSON.parse(row.METADATA) : undefined,
		status: row.STATUS,
		createdAt: row.CREATED_AT,
		expiresAt: row.EXPIRES_AT ?? undefined
	});
}

// ── Repository ────────────────────────────────────────────────────────────────

export interface FindingFilter {
	domain?: FindingDomain;
	severity?: FindingSeverity;
	status?: FindingStatus;
	cloud?: string;
	limit?: number;
	offset?: number;
}

export function createFindingsRepository(withConnection: WithConnectionFn) {
	/**
	 * Upsert a finding.
	 *
	 * An "active" finding for the same (domain, title, first resource id) is
	 * considered a duplicate — update it rather than insert a new row.
	 */
	async function upsertFinding(finding: Finding): Promise<void> {
		await withConnection(async (conn) => {
			const resourcesJson = JSON.stringify(finding.resources);
			const charlieJson = finding.charlieAction ? JSON.stringify(finding.charlieAction) : null;
			const metaJson = finding.metadata ? JSON.stringify(finding.metadata) : null;
			const primaryResourceId = finding.resources.length > 0 ? finding.resources[0].id : '';

			await conn.execute(
				`MERGE INTO cloud_advisor_findings t
				 USING (
				   SELECT :title AS title, :domain AS domain, :primary_res AS primary_res
				   FROM dual
				 ) s
				 ON (t.title = s.title AND t.domain = s.domain
				     AND JSON_VALUE(t.resources, '$[0].id') = s.primary_res
				     AND t.status = 'active')
				 WHEN MATCHED THEN
				   UPDATE SET
				     run_id         = :run_id,
				     severity       = :severity,
				     confidence     = :confidence,
				     summary        = :summary,
				     impact         = :impact,
				     recommendation = :recommendation,
				     charlie_action = :charlie_action,
				     resources      = :resources,
				     metadata       = :metadata,
				     updated_at     = SYSTIMESTAMP
				 WHEN NOT MATCHED THEN
				   INSERT (id, run_id, domain, severity, confidence, title, summary,
				           impact, recommendation, charlie_action, resources, metadata,
				           status, created_at, expires_at, updated_at)
				   VALUES (:id, :run_id, :domain, :severity, :confidence, :title,
				           :summary, :impact, :recommendation, :charlie_action,
				           :resources, :metadata, 'active', SYSTIMESTAMP, :expires_at, SYSTIMESTAMP)`,
				{
					title: finding.title,
					domain: finding.domain,
					primary_res: primaryResourceId,
					id: finding.id,
					run_id: finding.runId,
					severity: finding.severity,
					confidence: finding.confidence,
					summary: finding.summary,
					impact: finding.impact,
					recommendation: finding.recommendation,
					charlie_action: charlieJson,
					resources: resourcesJson,
					metadata: metaJson,
					expires_at: finding.expiresAt ?? null
				}
			);
			await conn.commit();
		});
	}

	async function upsertFindings(findings: Finding[]): Promise<void> {
		for (const finding of findings) {
			await upsertFinding(finding);
		}
	}

	async function listFindings(filter: FindingFilter = {}): Promise<Finding[]> {
		return withConnection(async (conn) => {
			const conditions: string[] = ["status != 'dismissed'"];
			const binds: Record<string, unknown> = {};

			if (filter.domain) {
				conditions.push('domain = :domain');
				binds['domain'] = filter.domain;
			}
			if (filter.severity) {
				conditions.push('severity = :severity');
				binds['severity'] = filter.severity;
			}
			if (filter.status) {
				conditions.push('status = :status');
				binds['status'] = filter.status;
			}
			if (filter.cloud) {
				conditions.push(`JSON_EXISTS(resources, '$[*].cloud?(@ == :cloud)')`);
				binds['cloud'] = filter.cloud;
			}

			const limit = filter.limit ?? 50;
			const offset = filter.offset ?? 0;

			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			const result = await conn.execute<FindingRow>(
				`SELECT id, run_id, domain, severity, confidence, title, summary, impact,
				        recommendation, charlie_action, resources, metadata, status,
				        created_at, expires_at, updated_at
				 FROM cloud_advisor_findings
				 ${where}
				 ORDER BY
				   CASE severity
				     WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
				     WHEN 'low' THEN 4 ELSE 5
				   END,
				   created_at DESC
				 OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
				{ ...binds, offset, limit },
				{ outFormat: 4002 } // OUT_FORMAT_OBJECT
			);

			return (result.rows ?? []).map(rowToFinding);
		});
	}

	async function getFinding(id: string): Promise<Finding | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<FindingRow>(
				`SELECT id, run_id, domain, severity, confidence, title, summary, impact,
				        recommendation, charlie_action, resources, metadata, status,
				        created_at, expires_at, updated_at
				 FROM cloud_advisor_findings WHERE id = :id`,
				{ id },
				{ outFormat: 4002 }
			);
			const rows = result.rows ?? [];
			return rows.length > 0 ? rowToFinding(rows[0]) : null;
		});
	}

	async function updateFindingStatus(
		id: string,
		status: FindingStatus,
		note?: string
	): Promise<void> {
		await withConnection(async (conn) => {
			const metaUpdate = note
				? `, metadata = JSON_MERGEPATCH(NVL(metadata, '{}'), :notePatch)`
				: '';
			const binds: Record<string, unknown> = { status, id };
			if (note) binds.notePatch = JSON.stringify({ note });
			await conn.execute(
				`UPDATE cloud_advisor_findings
				 SET status = :status, updated_at = SYSTIMESTAMP${metaUpdate}
				 WHERE id = :id`,
				binds
			);
			await conn.commit();
		});
	}

	async function upsertRun(
		runId: string,
		domain: string | null,
		status: 'running' | 'completed' | 'failed',
		opts: {
			completedAt?: Date;
			durationMs?: number;
			findingCount?: number;
			criticalCount?: number;
			highCount?: number;
			mediumCount?: number;
			lowCount?: number;
			infoCount?: number;
			estimatedSavings?: number;
			summaryJson?: string;
			errorMessage?: string;
		} = {}
	): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`MERGE INTO cloud_advisor_runs t
				 USING (SELECT :run_id AS run_id FROM dual) s
				 ON (t.run_id = s.run_id)
				 WHEN MATCHED THEN
				   UPDATE SET
				     status            = :status,
				     completed_at      = :completed_at,
				     duration_ms       = :duration_ms,
				     finding_count     = :finding_count,
				     critical_count    = :critical_count,
				     high_count        = :high_count,
				     medium_count      = :medium_count,
				     low_count         = :low_count,
				     info_count        = :info_count,
				     estimated_savings = :estimated_savings,
				     summary_json      = :summary_json,
				     error_message     = :error_message
				 WHEN NOT MATCHED THEN
				   INSERT (id, run_id, domain, status, started_at, completed_at,
				           duration_ms, finding_count, critical_count, high_count,
				           medium_count, low_count, info_count, estimated_savings,
				           summary_json, error_message)
				   VALUES (SYS_GUID(), :run_id, :domain, :status, SYSTIMESTAMP, :completed_at,
				           :duration_ms, :finding_count, :critical_count, :high_count,
				           :medium_count, :low_count, :info_count, :estimated_savings,
				           :summary_json, :error_message)`,
				{
					run_id: runId,
					domain,
					status,
					completed_at: opts.completedAt ?? null,
					duration_ms: opts.durationMs ?? null,
					finding_count: opts.findingCount ?? 0,
					critical_count: opts.criticalCount ?? 0,
					high_count: opts.highCount ?? 0,
					medium_count: opts.mediumCount ?? 0,
					low_count: opts.lowCount ?? 0,
					info_count: opts.infoCount ?? 0,
					estimated_savings: opts.estimatedSavings ?? 0,
					summary_json: opts.summaryJson ?? null,
					error_message: opts.errorMessage ?? null
				}
			);
			await conn.commit();
		});
	}

	async function getLatestRun(): Promise<RunRow | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<RunRow>(
				`SELECT run_id, domain, status, started_at, completed_at, duration_ms,
				        finding_count, critical_count, high_count, medium_count, low_count,
				        info_count, estimated_savings, summary_json
				 FROM cloud_advisor_runs
				 WHERE domain IS NULL OR domain = 'full'
				 ORDER BY started_at DESC
				 FETCH FIRST 1 ROWS ONLY`,
				{},
				{ outFormat: 4002 }
			);
			return (result.rows ?? [])[0] ?? null;
		});
	}

	async function getLatestRunSummary(): Promise<RunSummary | null> {
		const row = await getLatestRun();
		if (!row || !row.SUMMARY_JSON) return null;
		try {
			return RunSummarySchema.parse(JSON.parse(row.SUMMARY_JSON));
		} catch {
			return null;
		}
	}

	return {
		upsertFinding,
		upsertFindings,
		listFindings,
		getFinding,
		updateFindingStatus,
		upsertRun,
		getLatestRun,
		getLatestRunSummary
	};
}

export type FindingsRepository = ReturnType<typeof createFindingsRepository>;
