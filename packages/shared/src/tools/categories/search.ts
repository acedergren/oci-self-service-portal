import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCISDK, normalizeSDKResponse } from '../executor-sdk.js';

export const searchTools: ToolEntry[] = [
	{
		name: 'searchResources',
		description:
			'Search for any OCI resource using structured query language. Powerful for finding resources by type, state, or custom filters. Example queries: "query instance resources where lifeCycleState = \'RUNNING\'", "query all resources where displayName = \'my-app\'".',
		category: 'search',
		approvalLevel: 'auto',
		parameters: z.object({
			queryText: z
				.string()
				.describe(
					'OCI structured query (e.g., "query instance resources where lifeCycleState = \'RUNNING\'")'
				),
			limit: z.number().default(50).describe('Maximum number of results')
		}),
		executeAsync: async (args) => {
			const response = await executeOCISDK('resourceSearch', 'searchResources', {
				searchDetails: {
					type: 'Structured',
					query: args.queryText as string,
					matchingContextType: 'NONE'
				},
				limit: args.limit || 50
			});
			return normalizeSDKResponse(response);
		}
	},
	{
		name: 'searchResourcesByName',
		description:
			'Find OCI resources by display name. Simpler alternative to searchResources — no need to write query syntax. Returns matching resources with their type, state, compartment, and OCID.',
		category: 'search',
		approvalLevel: 'auto',
		parameters: z.object({
			displayName: z
				.string()
				.describe('The display name to search for (case-insensitive contains match)'),
			resourceType: z
				.enum([
					'instance',
					'vcn',
					'subnet',
					'bucket',
					'autonomousdatabase',
					'volume',
					'loadbalancer',
					'dbsystem',
					'functionsfunction'
				])
				.optional()
				.describe('Narrow search to a specific resource type')
		}),
		executeAsync: async (args) => {
			const displayName = args.displayName as string;
			const resourceType = args.resourceType as string | undefined;
			const typeClause = resourceType ? `${resourceType} resources` : 'all resources';
			// Escape single quotes to prevent OCI query injection
			const escapedName = displayName.replace(/'/g, "''");
			const queryText = `query ${typeClause} where displayName = '${escapedName}'`;
			const response = await executeOCISDK('resourceSearch', 'searchResources', {
				searchDetails: {
					type: 'Structured',
					query: queryText,
					matchingContextType: 'NONE'
				},
				limit: 50
			});
			return normalizeSDKResponse(response);
		}
	}
];
