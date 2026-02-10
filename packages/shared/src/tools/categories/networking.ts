import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCISDK, requireCompartmentId } from '../executor-sdk.js';

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
			const request: Record<string, unknown> = { compartmentId };
			if (args.displayName) request.displayName = args.displayName;
			return executeOCISDK('virtualNetwork', 'listVcns', request);
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
			return executeOCISDK('virtualNetwork', 'createVcn', {
				createVcnDetails: {
					compartmentId,
					displayName: args.displayName,
					cidrBlock: args.cidrBlock
				}
			});
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
			return executeOCISDK('virtualNetwork', 'deleteVcn', { vcnId: args.vcnId });
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
			const request: Record<string, unknown> = { compartmentId };
			if (args.vcnId) request.vcnId = args.vcnId;
			return executeOCISDK('virtualNetwork', 'listSubnets', request);
		}
	}
];
