import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCIAsync, requireCompartmentId } from '../executor.js';
import { executeOCISDK, normalizeSDKResponse } from '@portal/shared/tools/executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const loggingTools: ToolEntry[] = [
	{
		name: 'searchLogs',
		description:
			'Search OCI logs using the Logging Search service. Supports query expressions to filter log entries. Present results with timestamps, source, and message. Useful for debugging, security analysis, and audit trails.',
		category: 'logging',
		approvalLevel: 'auto',
		parameters: z.object({
			query: z
				.string()
				.describe('Search query expression (e.g., "error" or "data.message = \'timeout\'")'),
			period: z.enum(['1h', '6h', '24h', '7d']).default('24h').describe('Time period to search'),
			compartmentId: compartmentIdSchema,
			limit: z.number().default(100).describe('Maximum number of log entries to return')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const query = args.query as string;
			const period = args.period as string;
			const limit = (args.limit as number) || 100;

			const periodHours: Record<string, number> = {
				'1h': 1,
				'6h': 6,
				'24h': 24,
				'7d': 168
			};

			const hoursBack = periodHours[period] || 24;
			const now = new Date();
			const startTime = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

			try {
				const response = await executeOCISDK('logSearch', 'searchLogs', {
					searchLogsDetails: {
						searchQuery: `search "${compartmentId}" | ${query}`,
						timeStart: startTime,
						timeEnd: now,
						isReturnFieldInfo: false
					},
					limit
				});

				const result = normalizeSDKResponse(response);

				return {
					query,
					period,
					timeRange: { start: startTime.toISOString(), end: now.toISOString() },
					data: result
				};
			} catch {
				const result = await executeOCIAsync([
					'logging-search',
					'search-logs',
					'--search-query',
					`search "${compartmentId}" | ${query}`,
					'--time-start',
					startTime.toISOString(),
					'--time-end',
					now.toISOString(),
					'--limit',
					String(limit)
				]);

				return {
					query,
					period,
					timeRange: { start: startTime.toISOString(), end: now.toISOString() },
					data: result
				};
			}
		}
	}
];
