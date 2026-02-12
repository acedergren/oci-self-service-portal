import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCISDK, normalizeSDKResponse, requireCompartmentId } from '../executor-sdk.js';
import { toMidnightUTC } from '../executor.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const billingTools: ToolEntry[] = [
	{
		name: 'getUsageCost',
		description:
			'Show actual OCI cloud spending broken down by service, compartment, or region. Useful for cost reviews and budget tracking. Returns spending data with daily or monthly granularity. Suggest compareCloudCosts if the user wants to optimize spend across providers.',
		category: 'billing',
		approvalLevel: 'auto',
		parameters: z.object({
			period: z
				.enum(['last7days', 'last30days', 'lastMonth', 'last3months'])
				.default('last30days')
				.describe('Time period for cost data'),
			groupBy: z
				.enum(['service', 'compartmentName', 'region'])
				.default('service')
				.describe('How to group the cost breakdown'),
			granularity: z
				.enum(['DAILY', 'MONTHLY', 'TOTAL'])
				.default('MONTHLY')
				.describe('Aggregation granularity'),
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const period = args.period as string;
			const groupBy = (args.groupBy as string) || 'service';
			const granularity = (args.granularity as string) || 'MONTHLY';

			const now = new Date();
			const endDate = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
			);
			let startDate: Date;
			switch (period) {
				case 'last7days':
					startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
					break;
				case 'last30days':
					startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
					break;
				case 'lastMonth':
					startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
					break;
				case 'last3months':
					startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
					break;
				default:
					startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
			}

			let tenancyId: string;
			try {
				const tenancyResp = await executeOCISDK('identity', 'getCompartment', {
					compartmentId
				});
				const compartment = (tenancyResp as { compartment: { compartmentId: string } }).compartment;
				tenancyId = compartment.compartmentId || compartmentId;
			} catch {
				tenancyId = compartmentId;
			}

			const result = await executeOCISDK('usageApi', 'requestSummarizedUsages', {
				requestSummarizedUsagesDetails: {
					tenantId: tenancyId,
					timeUsageStarted: new Date(toMidnightUTC(startDate)),
					timeUsageEnded: new Date(toMidnightUTC(endDate)),
					granularity,
					groupBy: [groupBy]
				}
			});

			return {
				period,
				groupBy,
				granularity,
				timeRange: { start: toMidnightUTC(startDate), end: toMidnightUTC(endDate) },
				data: normalizeSDKResponse(result)
			};
		}
	}
];
