import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { requireCompartmentId } from '../executor.js';
import { normalizeSDKResponse } from '@portal/shared/tools/executor-sdk.js';
import { executeSDKOperation } from '../executor-sdk.js';

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
			const request: Record<string, unknown> = { compartmentId, limit: 1000 };
			if (args.displayName) request.displayName = args.displayName as string;
			const result = await executeSDKOperation<unknown>('virtualNetwork', 'listVcns', request, {
				compartmentId
			});
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
		}
	},
	{
		name: 'getVcn',
		description:
			'Get details for a specific Virtual Cloud Network by its OCID. Returns CIDR block, DNS label, state, and creation time. Use after createVcn or to inspect an existing VCN before creating subnets.',
		category: 'networking',
		approvalLevel: 'auto',
		parameters: z.object({
			vcnId: z.string().describe('The OCID of the VCN')
		}),
		executeAsync: async (args) => {
			const vcnId = args.vcnId as string;
			const result = await executeSDKOperation<unknown>(
				'virtualNetwork',
				'getVcn',
				{ vcnId },
				{ vcnId }
			);
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
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
			const request = {
				createVcnDetails: {
					compartmentId,
					displayName: args.displayName as string,
					cidrBlock: args.cidrBlock as string
				}
			};
			const result = await executeSDKOperation<unknown>('virtualNetwork', 'createVcn', request, {
				compartmentId
			});
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
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
			const result = await executeSDKOperation<unknown>(
				'virtualNetwork',
				'deleteVcn',
				{ vcnId },
				{ vcnId }
			);
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
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
			const request: Record<string, unknown> = { compartmentId, limit: 1000 };
			if (args.vcnId) request.vcnId = args.vcnId as string;
			const result = await executeSDKOperation<unknown>('virtualNetwork', 'listSubnets', request, {
				compartmentId
			});
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
		}
	}
];
