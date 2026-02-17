import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI, executeOCIAsync, requireCompartmentId } from '../executor.js';
import { executeOCISDK, normalizeSDKResponse } from '@portal/shared/tools/executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const observabilityTools: ToolEntry[] = [
	{
		name: 'listAlarms',
		description:
			'List monitoring alarms in a compartment. Present as a table: Name | Severity | State (OK/FIRING/SUSPENDED) | Metric. Highlight any FIRING alarms that need attention. If no alarms exist, suggest creating basic health alarms for compute CPU, memory, and disk usage.',
		category: 'observability',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			displayName: z.string().optional()
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = { compartmentId };
				if (args.displayName) request.displayName = args.displayName as string;
				const response = await executeOCISDK('monitoring', 'listAlarms', request);
				return normalizeSDKResponse(response);
			} catch {
				const cliArgs = ['monitoring', 'alarm', 'list', '--compartment-id', compartmentId, '--all'];
				if (args.displayName) cliArgs.push('--display-name', args.displayName as string);
				return executeOCI(cliArgs);
			}
		}
	},
	{
		name: 'summarizeMetrics',
		description:
			'Query metric data with aggregation using MQL (Monitoring Query Language). Prefer getComputeMetrics for common compute metrics — use this tool only for custom namespaces/queries. MQL syntax examples: "CpuUtilization[1h].mean()", "DiskBytesRead[5m]{resourceId = \\"ocid1...\\"}.sum()". If startTime/endTime are omitted, defaults to last 3 hours.',
		category: 'observability',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			namespace: z
				.string()
				.describe('Metric namespace (e.g., oci_computeagent, oci_vcn, oci_blockstore)'),
			query: z.string().describe('MQL query string, e.g. "CpuUtilization[1h].mean()"'),
			startTime: z.string().optional().describe('Start time (ISO 8601) — defaults to 3 hours ago'),
			endTime: z.string().optional().describe('End time (ISO 8601) — defaults to now'),
			resolution: z.string().optional().describe('Data resolution (e.g., 1m, 5m, 1h)')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const now = new Date();
			const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
			const startTime = (args.startTime as string) || threeHoursAgo.toISOString();
			const endTime = (args.endTime as string) || now.toISOString();

			try {
				const summarizeMetricsDataDetails: Record<string, unknown> = {
					namespace: args.namespace,
					query: args.query,
					startTime: new Date(startTime),
					endTime: new Date(endTime)
				};
				if (args.resolution) summarizeMetricsDataDetails.resolution = args.resolution;

				const response = await executeOCISDK('monitoring', 'summarizeMetricsData', {
					compartmentId,
					summarizeMetricsDataDetails
				});
				return normalizeSDKResponse(response);
			} catch {
				const cliArgs = [
					'monitoring',
					'metric-data',
					'summarize-metrics-data',
					'--compartment-id',
					compartmentId,
					'--namespace',
					args.namespace as string,
					'--query-text',
					args.query as string,
					'--start-time',
					startTime,
					'--end-time',
					endTime
				];
				if (args.resolution) cliArgs.push('--resolution', args.resolution as string);
				return executeOCI(cliArgs);
			}
		}
	},
	{
		name: 'getComputeMetrics',
		description:
			'Get compute instance metrics without writing raw MQL. Simplifies common monitoring queries (CPU, memory, disk, network). Present results as a time-series summary with min/max/avg values. Flag CPU > 80% as potential scaling need, memory > 90% as critical.',
		category: 'observability',
		approvalLevel: 'auto',
		parameters: z.object({
			metricName: z
				.enum([
					'CpuUtilization',
					'MemoryUtilization',
					'DiskBytesRead',
					'DiskBytesWritten',
					'NetworksBytesIn',
					'NetworksBytesOut',
					'LoadAverage'
				])
				.describe('The metric to query'),
			period: z
				.enum(['1h', '6h', '24h', '7d', '30d'])
				.default('24h')
				.describe('Time period to query'),
			instanceId: z.string().optional().describe('Filter to a specific instance OCID'),
			aggregation: z
				.enum(['mean', 'max', 'min', 'sum'])
				.default('mean')
				.describe('Aggregation function'),
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const metricName = args.metricName as string;
			const period = args.period as string;
			const instanceId = args.instanceId as string | undefined;
			const aggregation = (args.aggregation as string) || 'mean';

			const periodMap: Record<string, { interval: string; hoursBack: number }> = {
				'1h': { interval: '1m', hoursBack: 1 },
				'6h': { interval: '5m', hoursBack: 6 },
				'24h': { interval: '1h', hoursBack: 24 },
				'7d': { interval: '1h', hoursBack: 168 },
				'30d': { interval: '1d', hoursBack: 720 }
			};

			const config = periodMap[period] || periodMap['24h'];
			const now = new Date();
			const startTime = new Date(now.getTime() - config.hoursBack * 60 * 60 * 1000);

			const resourceFilter = instanceId ? `{resourceId = "${instanceId}"}` : '';
			const mqlQuery = `${metricName}[${config.interval}]${resourceFilter}.${aggregation}()`;

			try {
				const response = await executeOCISDK('monitoring', 'summarizeMetricsData', {
					compartmentId,
					summarizeMetricsDataDetails: {
						namespace: 'oci_computeagent',
						query: mqlQuery,
						startTime,
						endTime: now
					}
				});

				const result = normalizeSDKResponse(response);

				return {
					metricName,
					period,
					aggregation,
					query: mqlQuery,
					namespace: 'oci_computeagent',
					timeRange: {
						start: startTime.toISOString(),
						end: now.toISOString(),
						interval: config.interval
					},
					data: result
				};
			} catch {
				const result = await executeOCIAsync([
					'monitoring',
					'metric-data',
					'summarize-metrics-data',
					'--compartment-id',
					compartmentId,
					'--namespace',
					'oci_computeagent',
					'--query-text',
					mqlQuery,
					'--start-time',
					startTime.toISOString(),
					'--end-time',
					now.toISOString()
				]);

				return {
					metricName,
					period,
					aggregation,
					query: mqlQuery,
					namespace: 'oci_computeagent',
					timeRange: {
						start: startTime.toISOString(),
						end: now.toISOString(),
						interval: config.interval
					},
					data: result
				};
			}
		}
	},
	{
		name: 'listMetricNamespaces',
		description:
			'Discover available metric namespaces in a compartment. Returns namespaces like oci_computeagent, oci_vcn, oci_blockstore, etc. Useful for exploring what monitoring data is available before querying with summarizeMetrics or getComputeMetrics.',
		category: 'observability',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const response = await executeOCISDK('monitoring', 'listMetrics', {
					compartmentId,
					listMetricsDetails: {
						groupBy: ['namespace']
					}
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'monitoring',
					'metric',
					'list',
					'--compartment-id',
					compartmentId,
					'--group-by',
					JSON.stringify(['namespace'])
				]);
			}
		}
	}
];
