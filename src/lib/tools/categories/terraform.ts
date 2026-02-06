import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import {
	generateTerraformCode,
	generateQuickComputeTerraform,
	generateWebServerTerraform
} from '$lib/terraform/generator.js';

export const terraformTools: ToolEntry[] = [
	{
		name: 'generateTerraform',
		description:
			'Generate Terraform HCL code for OCI infrastructure (compute, VCN, or full web-server stack). Present each generated file in a fenced ```hcl code block with the filename as a header. After generating, offer to create a Mermaid architecture diagram showing the resource topology. Provide numbered deployment steps (terraform init → plan → apply).',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			type: z.enum(['compute', 'vcn', 'web-server']).describe('Type of infrastructure to generate'),
			name: z.string().describe('Display name for the resources'),
			shape: z
				.string()
				.optional()
				.default('VM.Standard.E4.Flex')
				.describe('Compute shape (e.g., VM.Standard.E4.Flex, VM.Standard.A1.Flex)'),
			ocpus: z.number().optional().default(1).describe('Number of OCPUs for flex shapes'),
			memoryGBs: z.number().optional().default(6).describe('Memory in GB for flex shapes'),
			region: z.string().optional().default('eu-frankfurt-1').describe('OCI region'),
			vcnCidr: z.string().optional().default('10.0.0.0/16').describe('VCN CIDR block'),
			useVariables: z
				.boolean()
				.optional()
				.default(true)
				.describe('Generate with variables.tf (recommended)')
		}),
		executeAsync: async (args) => {
			const type = args.type as 'compute' | 'vcn' | 'web-server';
			const name = args.name as string;
			const shape = (args.shape as string) || 'VM.Standard.E4.Flex';
			const ocpus = (args.ocpus as number) || 1;
			const memoryGBs = (args.memoryGBs as number) || 6;
			const region = (args.region as string) || 'eu-frankfurt-1';
			const vcnCidr = (args.vcnCidr as string) || '10.0.0.0/16';

			if (type === 'web-server') {
				const output = generateWebServerTerraform({
					name,
					shape,
					ocpus,
					memoryGBs,
					region,
					vcnCidr
				});
				return {
					type: 'web-server',
					files: {
						'main.tf': output.main,
						'variables.tf': output.variables,
						'outputs.tf': output.outputs,
						'terraform.tfvars.example': output.tfvars
					},
					summary: `Generated Terraform for web server "${name}" with ${shape} (${ocpus} OCPUs, ${memoryGBs}GB RAM), VCN (${vcnCidr}), public and private subnets`,
					nextSteps: [
						'1. Copy the generated files to a new directory',
						'2. Run `terraform init` to initialize',
						'3. Copy terraform.tfvars.example to terraform.tfvars and fill in your values',
						'4. Run `terraform plan` to preview changes',
						'5. Run `terraform apply` to create resources'
					]
				};
			}

			if (type === 'compute') {
				const code = generateQuickComputeTerraform({ name, shape, ocpus, memoryGBs, region });
				return {
					type: 'compute',
					files: { 'main.tf': code },
					summary: `Generated Terraform for compute instance "${name}" with ${shape} (${ocpus} OCPUs, ${memoryGBs}GB RAM)`,
					nextSteps: [
						'1. Add this to your existing Terraform configuration or create a new directory',
						'2. Ensure you have variables defined for compartment_id, subnet_id, ssh_public_key',
						'3. Run `terraform plan` to preview',
						'4. Run `terraform apply` to create'
					]
				};
			}

			// VCN only
			const output = generateTerraformCode({
				useVariables: true,
				provider: { region },
				vcn: {
					displayName: name,
					cidrBlock: vcnCidr,
					dnsLabel: name
						.toLowerCase()
						.replace(/[^a-z0-9]/g, '')
						.substring(0, 15),
					createInternetGateway: true,
					createNatGateway: true,
					createServiceGateway: true
				},
				subnets: [
					{
						displayName: `${name}-public`,
						cidrBlock: vcnCidr.replace('/16', '/24'),
						isPublic: true,
						dnsLabel: 'public'
					},
					{
						displayName: `${name}-private`,
						cidrBlock: vcnCidr.replace('.0.0/16', '.1.0/24'),
						isPublic: false,
						dnsLabel: 'private'
					}
				]
			});

			return {
				type: 'vcn',
				files: {
					'main.tf': output.main,
					'variables.tf': output.variables,
					'outputs.tf': output.outputs
				},
				summary: `Generated Terraform for VCN "${name}" with CIDR ${vcnCidr}, including public/private subnets and gateways`,
				nextSteps: [
					'1. Copy the generated files to a directory',
					'2. Run `terraform init`',
					'3. Set your compartment_id variable',
					'4. Run `terraform apply`'
				]
			};
		}
	}
];
