import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI, requireCompartmentId } from '../executor.js';
import { executeOCISDK, normalizeSDKResponse } from '@portal/shared/tools/executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const networkingTools: ToolEntry[] = [
	{
		name: 'listVcns',
		description:
			'List Virtual Cloud Networks. Present as a table: Name | CIDR Block | State | DNS Label. For each VCN, suggest listSubnets for subnet details. If no VCNs exist and user needs networking, suggest the Setup Private Network workflow or generateTerraform with type=vcn.',
		category: 'networking',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			displayName: z.string().optional()
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = { compartmentId, limit: 1000 };
				if (args.displayName) request.displayName = args.displayName as string;
				const response = await executeOCISDK('virtualNetwork', 'listVcns', request);
				return normalizeSDKResponse(response);
			} catch {
				const cliArgs = ['network', 'vcn', 'list', '--compartment-id', compartmentId, '--all'];
				if (args.displayName) cliArgs.push('--display-name', args.displayName as string);
				return executeOCI(cliArgs);
			}
		}
	},
	{
		name: 'createVcn',
		description:
			'Create a new Virtual Cloud Network. REQUIRES confirmation. Recommend a /16 CIDR block for flexibility. After creation, suggest creating public and private subnets, internet gateway, and NAT gateway. Offer to generate Terraform for the full network stack instead.',
		category: 'networking',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			displayName: z.string().describe('Display name for the VCN'),
			cidrBlock: z.string().describe('CIDR block (e.g., 10.0.0.0/16)')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request = {
					createVcnDetails: {
						compartmentId,
						displayName: args.displayName as string,
						cidrBlock: args.cidrBlock as string
					}
				};
				const response = await executeOCISDK('virtualNetwork', 'createVcn', request);
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'network',
					'vcn',
					'create',
					'--compartment-id',
					compartmentId,
					'--display-name',
					args.displayName as string,
					'--cidr-block',
					args.cidrBlock as string
				]);
			}
		}
	},
	{
		name: 'deleteVcn',
		description:
			'Delete a Virtual Cloud Network. DANGER: Irreversible. VCN must be empty (no subnets, gateways, or instances). Confirm with user by stating the VCN name. Warn if any subnets still exist.',
		category: 'networking',
		approvalLevel: 'danger',
		parameters: z.object({
			vcnId: z.string().describe('The OCID of the VCN')
		}),
		executeAsync: async (args) => {
			const vcnId = args.vcnId as string;
			try {
				const response = await executeOCISDK('virtualNetwork', 'deleteVcn', { vcnId });
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI(['network', 'vcn', 'delete', '--vcn-id', vcnId, '--force']);
			}
		}
	},
	{
		name: 'listSubnets',
		description:
			'List subnets in a compartment or VCN. Present as a table: Name | CIDR Block | Type (Public/Private) | VCN | AD. Highlight any subnets missing security lists. If filtering by VCN, also mention the VCN name for context.',
		category: 'networking',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			vcnId: z.string().optional().describe('Filter by VCN')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = { compartmentId, limit: 1000 };
				if (args.vcnId) request.vcnId = args.vcnId as string;
				const response = await executeOCISDK('virtualNetwork', 'listSubnets', request);
				return normalizeSDKResponse(response);
			} catch {
				const cliArgs = ['network', 'subnet', 'list', '--compartment-id', compartmentId, '--all'];
				if (args.vcnId) cliArgs.push('--vcn-id', args.vcnId as string);
				return executeOCI(cliArgs);
			}
		}
	}
];
