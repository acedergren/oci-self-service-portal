import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI, requireCompartmentId } from '../executor.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const identityTools: ToolEntry[] = [
	{
		name: 'listCompartments',
		description:
			"List compartments in the tenancy or a parent compartment. Present as a table: Name | Description | State | Created. Compartments are OCI's primary resource isolation mechanism. If user is new, explain that resources live inside compartments for organization and access control.",
		category: 'identity',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			accessLevel: z.enum(['ANY', 'ACCESSIBLE']).default('ACCESSIBLE')
		}),
		execute: (args) => {
			const compartmentId = requireCompartmentId(args);
			return executeOCI([
				'iam',
				'compartment',
				'list',
				'--compartment-id',
				compartmentId,
				'--access-level',
				(args.accessLevel as string) || 'ACCESSIBLE',
				'--all'
			]);
		}
	},
	{
		name: 'listPolicies',
		description:
			'List IAM policies in a compartment. Present as a table: Name | Statement Count | Created. For security audits, flag overly broad policies (e.g., "manage all-resources in tenancy"). Recommend least-privilege: scope to specific compartments and resource types.',
		category: 'identity',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema
		}),
		execute: (args) => {
			const compartmentId = requireCompartmentId(args);
			return executeOCI(['iam', 'policy', 'list', '--compartment-id', compartmentId, '--all']);
		}
	},
	{
		name: 'createPolicy',
		description:
			'Create a new IAM policy. REQUIRES confirmation. Present the policy statements for review before creating. Follow least-privilege principle: scope to specific compartments and resource types. Example format: "Allow group <group> to manage <resource-type> in compartment <name>".',
		category: 'identity',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			name: z.string(),
			description: z.string(),
			statements: z.array(z.string())
		}),
		execute: (args) => {
			const compartmentId = requireCompartmentId(args);
			const statements = args.statements as string[];
			return executeOCI([
				'iam',
				'policy',
				'create',
				'--compartment-id',
				compartmentId,
				'--name',
				args.name as string,
				'--description',
				args.description as string,
				'--statements',
				JSON.stringify(statements)
			]);
		}
	}
];
