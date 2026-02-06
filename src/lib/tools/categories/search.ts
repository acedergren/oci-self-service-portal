import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI } from '../executor.js';

export const searchTools: ToolEntry[] = [
  {
    name: 'searchResources',
    description: 'Search for any OCI resource using structured query language. Powerful for finding resources by type, state, or custom filters. Example queries: "query instance resources where lifeCycleState = \'RUNNING\'", "query all resources where displayName = \'my-app\'".',
    category: 'search',
    approvalLevel: 'auto',
    parameters: z.object({
      queryText: z.string().describe('OCI structured query (e.g., "query instance resources where lifeCycleState = \'RUNNING\'")'),
      limit: z.number().default(50).describe('Maximum number of results'),
    }),
    execute: (args) => {
      return executeOCI([
        'search', 'resource', 'structured-search',
        '--query-text', args.queryText as string,
        '--limit', String(args.limit || 50),
      ]);
    },
  },
  {
    name: 'searchResourcesByName',
    description: 'Find OCI resources by display name. Simpler alternative to searchResources — no need to write query syntax. Returns matching resources with their type, state, compartment, and OCID.',
    category: 'search',
    approvalLevel: 'auto',
    parameters: z.object({
      displayName: z.string().describe('The display name to search for (case-insensitive contains match)'),
      resourceType: z.enum([
        'instance', 'vcn', 'subnet', 'bucket', 'autonomousdatabase',
        'volume', 'loadbalancer', 'dbsystem', 'functionsfunction',
      ]).optional().describe('Narrow search to a specific resource type'),
    }),
    execute: (args) => {
      const displayName = args.displayName as string;
      const resourceType = args.resourceType as string | undefined;
      const typeClause = resourceType ? `${resourceType} resources` : 'all resources';
      const queryText = `query ${typeClause} where displayName = '${displayName}'`;
      return executeOCI([
        'search', 'resource', 'structured-search',
        '--query-text', queryText,
        '--limit', '50',
      ]);
    },
  },
];
