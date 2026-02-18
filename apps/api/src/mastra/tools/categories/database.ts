import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI, slimOCIResponse, requireCompartmentId } from '../executor.js';
import {
	executeOCISDK,
	normalizeSDKResponse,
	executeAndSlim
} from '@portal/shared/tools/executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const databaseTools: ToolEntry[] = [
	{
		name: 'listAutonomousDatabases',
		description:
			'List Autonomous Databases in a compartment. Present as a table: Name | Workload Type | State | ECPUs | Storage (TB) | Created. Highlight Always Free eligible databases. Mention Oracle 26AI vector search capability for AI workloads. Suggest createAutonomousDatabase if none exist.',
		category: 'database',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			dbWorkload: z.enum(['OLTP', 'DW', 'AJD', 'APEX']).optional()
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const request: Record<string, unknown> = { compartmentId, limit: 1000 };
			if (args.dbWorkload) request.dbWorkload = args.dbWorkload as string;
			const pickFields = [
				'display-name',
				'id',
				'db-name',
				'db-workload',
				'lifecycle-state',
				'cpu-core-count',
				'data-storage-size-in-tbs',
				'time-created',
				'is-free-tier',
				'db-version',
				'infrastructure-type'
			];
			try {
				return await executeAndSlim('database', 'listAutonomousDatabases', request, pickFields);
			} catch {
				const cliArgs = [
					'db',
					'autonomous-database',
					'list',
					'--compartment-id',
					compartmentId,
					'--all'
				];
				if (args.dbWorkload) cliArgs.push('--db-workload', args.dbWorkload as string);
				return slimOCIResponse(executeOCI(cliArgs), pickFields);
			}
		}
	},
	{
		name: 'createAutonomousDatabase',
		description:
			'Create a new Autonomous Database. REQUIRES confirmation. Explain workload types: OLTP (transactions), DW (analytics), AJD (JSON documents), APEX (low-code apps). For AI use cases, recommend OLTP with vector search enabled (Oracle 26AI). Always Free eligible: 2 databases with 1 ECPU, 20GB each. After creation, suggest downloading the wallet for connection.',
		category: 'database',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			displayName: z.string(),
			dbName: z.string().describe('Database name (alphanumeric, 14 chars max)'),
			dbWorkload: z.enum(['OLTP', 'DW', 'AJD', 'APEX']),
			adminPassword: z
				.string()
				.describe('Admin user password (min 12 chars, must include uppercase, lowercase, number)'),
			cpuCoreCount: z.number(),
			dataStorageSizeInTBs: z.number()
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const response = await executeOCISDK('database', 'createAutonomousDatabase', {
					createAutonomousDatabaseDetails: {
						compartmentId,
						displayName: args.displayName as string,
						dbName: args.dbName as string,
						dbWorkload: args.dbWorkload as string,
						cpuCoreCount: args.cpuCoreCount as number,
						dataStorageSizeInTBs: args.dataStorageSizeInTBs as number,
						adminPassword: args.adminPassword as string
					}
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'db',
					'autonomous-database',
					'create',
					'--compartment-id',
					compartmentId,
					'--display-name',
					args.displayName as string,
					'--db-name',
					args.dbName as string,
					'--db-workload',
					args.dbWorkload as string,
					'--cpu-core-count',
					String(args.cpuCoreCount),
					'--data-storage-size-in-tbs',
					String(args.dataStorageSizeInTBs),
					'--admin-password',
					args.adminPassword as string
				]);
			}
		}
	},
	{
		name: 'terminateAutonomousDatabase',
		description:
			'Permanently terminate an Autonomous Database. DANGER: This destroys all data irreversibly. Confirm with user by stating the database name and OCID. Suggest creating a manual backup first if data preservation matters.',
		category: 'database',
		approvalLevel: 'danger',
		parameters: z.object({
			autonomousDatabaseId: z.string()
		}),
		executeAsync: async (args) => {
			try {
				const response = await executeOCISDK('database', 'deleteAutonomousDatabase', {
					autonomousDatabaseId: args.autonomousDatabaseId as string
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'db',
					'autonomous-database',
					'delete',
					'--autonomous-database-id',
					args.autonomousDatabaseId as string,
					'--force'
				]);
			}
		}
	}
];
