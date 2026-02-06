import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import {
	CloudPricingService,
	OCIPricingClient,
	AzurePricingClient,
	AWSPricingClient
} from '$lib/pricing/cloud-pricing-service.js';
import type { WorkloadRequirements, CloudProvider } from '$lib/pricing/types.js';

export const pricingTools: ToolEntry[] = [
	{
		name: 'compareCloudCosts',
		description:
			"Compare cloud costs across OCI, Azure, and AWS for a given workload. Returns a detailed 3-way markdown report — present the formatted output directly to the user (it includes tables, breakdowns, and reasoning). Highlight the savings percentage in bold. If OCI is cheaper, suggest generateTerraform as next step. Always mention OCI's 10TB free egress advantage for egress-heavy workloads.",
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({
			vcpus: z.number().optional().describe('Number of vCPUs required'),
			memoryGB: z.number().optional().describe('Memory in GB required'),
			architecture: z
				.enum(['x86', 'arm', 'any'])
				.optional()
				.describe('CPU architecture preference'),
			gpuRequired: z.boolean().optional().describe('Whether GPU is required'),
			storageGB: z.number().optional().describe('Storage size in GB'),
			storageType: z.enum(['ssd', 'hdd', 'object', 'archive']).optional().describe('Storage type'),
			egressGBPerMonth: z.number().optional().describe('Expected data egress in GB per month'),
			hoursPerMonth: z
				.number()
				.optional()
				.default(730)
				.describe('Hours per month (730 for always-on)'),
			maxBudgetPerMonth: z.number().optional().describe('Maximum monthly budget in USD')
		}),
		executeAsync: async (args) => {
			const service = new CloudPricingService();
			const requirements: WorkloadRequirements = {
				compute: {
					vcpusMin: args.vcpus as number | undefined,
					memoryGBMin: args.memoryGB as number | undefined,
					architecture: args.architecture as 'x86' | 'arm' | 'any' | undefined,
					gpuRequired: args.gpuRequired as boolean | undefined,
					hoursPerMonth: (args.hoursPerMonth as number) || 730
				},
				storage: args.storageGB
					? {
							sizeGB: args.storageGB as number,
							type: args.storageType as 'ssd' | 'hdd' | 'object' | 'archive' | undefined
						}
					: undefined,
				networking: args.egressGBPerMonth
					? { egressGBPerMonth: args.egressGBPerMonth as number }
					: undefined,
				constraints: args.maxBudgetPerMonth
					? { maxBudgetPerMonth: args.maxBudgetPerMonth as number }
					: undefined
			};
			const comparison = await service.compareCloudCosts(requirements);
			const markdown = service.formatAsMarkdown(comparison);
			return { comparison, formatted: markdown };
		}
	},
	{
		name: 'getOCIPricing',
		description:
			'Get OCI compute pricing for a specific shape or list all shapes. Present as a table: Shape | Architecture | OCPU Range | Memory Range | Price/hr | Price/month. Highlight ARM shapes as cheapest option. Bold the Always Free eligible shapes (A1.Flex). Remind that 1 OCPU = 2 vCPUs when comparing with other clouds.',
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({
			shapeName: z
				.string()
				.optional()
				.describe('Specific shape name (e.g., VM.Standard.E5.Flex, VM.Standard.A1.Flex)'),
			architecture: z
				.enum(['x86', 'arm', 'gpu'])
				.optional()
				.describe('Filter by architecture type'),
			listAll: z.boolean().optional().describe('List all available shapes with pricing')
		}),
		executeAsync: async (args) => {
			const client = new OCIPricingClient();
			if (args.listAll || (!args.shapeName && !args.architecture)) {
				const shapes = await client.listComputeShapes(
					args.architecture
						? { architecture: args.architecture as 'x86' | 'arm' | 'gpu' }
						: undefined
				);
				return { shapes, count: shapes.length };
			}
			if (args.shapeName) {
				const pricing = await client.getComputePricing(args.shapeName as string);
				if (!pricing) return { error: `Shape not found: ${args.shapeName}` };
				return pricing;
			}
			if (args.architecture) {
				const shapes = await client.listComputeShapes({
					architecture: args.architecture as 'x86' | 'arm' | 'gpu'
				});
				return { shapes, count: shapes.length, architecture: args.architecture };
			}
			return { error: 'Please specify a shapeName, architecture, or set listAll to true' };
		}
	},
	{
		name: 'getAzurePricing',
		description:
			"Get Azure VM pricing for comparison purposes. Present as a table: SKU | vCPUs | Memory | Price/hr | Price/month. Use this alongside getOCIPricing or compareCloudCosts for full comparison. Note Azure egress is only 5GB free vs OCI's 10TB.",
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({
			skuName: z
				.string()
				.optional()
				.describe('Specific Azure SKU (e.g., Standard_D2s_v3, Standard_B2s)'),
			region: z
				.string()
				.optional()
				.default('westeurope')
				.describe('Azure region (e.g., westeurope, eastus)'),
			serviceName: z.string().optional().default('Virtual Machines').describe('Azure service name')
		}),
		executeAsync: async (args) => {
			const client = new AzurePricingClient();
			const region = (args.region as string) || 'westeurope';
			if (args.skuName) {
				const pricing = await client.getVMPricing(args.skuName as string, region);
				if (!pricing) return { error: `SKU not found: ${args.skuName} in region ${region}` };
				const monthlyCost = await client.calculateMonthlyCost({
					skuName: args.skuName as string,
					region,
					hoursPerMonth: 730
				});
				return { pricing, monthlyCost };
			}
			const results = await client.searchPricing({
				serviceName: (args.serviceName as string) || 'Virtual Machines',
				armRegionName: region
			});
			return { results: results.slice(0, 20), count: results.length, region };
		}
	},
	{
		name: 'getOCIFreeTier',
		description:
			'Get OCI Always Free tier details. Present as a structured summary with categories: Compute (4 ARM OCPUs, 24GB RAM), Storage (200GB block, 20GB object), Database (2 ADBs), Networking (10TB egress). Compare with Azure Free Tier if the user is evaluating options. Suggest specific deployment configurations that fit within free limits.',
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({}),
		executeAsync: async () => {
			const client = new OCIPricingClient();
			const freeTier = await client.getFreeTier();
			return {
				freeTier,
				summary: {
					compute: `${freeTier.compute.armOcpus} ARM OCPUs, ${freeTier.compute.memoryGB} GB RAM`,
					storage: `${freeTier.storage.blockStorageGB} GB block storage, ${freeTier.storage.objectStorageGB} GB object storage`,
					database: `${freeTier.database.autonomousDBs} Autonomous DBs with ${freeTier.database.storageGB} GB storage each`,
					networking: `${freeTier.networking.egressTBFree} TB outbound data transfer per month`
				}
			};
		}
	},
	{
		name: 'estimateCloudCost',
		description:
			'Estimate monthly cost for a single cloud provider (OCI, Azure, or AWS). Present the breakdown: Compute | Storage | Networking | Total. Bold the monthly total. For deeper analysis, suggest compareCloudCosts to see all three providers side-by-side.',
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({
			provider: z.enum(['oci', 'azure', 'aws']).describe('Cloud provider to estimate costs for'),
			vcpus: z.number().optional().describe('Number of vCPUs'),
			memoryGB: z.number().optional().describe('Memory in GB'),
			architecture: z.enum(['x86', 'arm', 'any']).optional().describe('CPU architecture'),
			storageGB: z.number().optional().describe('Storage size in GB'),
			storageType: z.enum(['ssd', 'hdd', 'object', 'archive']).optional().describe('Storage type'),
			egressGBPerMonth: z.number().optional().describe('Data egress in GB per month'),
			hoursPerMonth: z.number().optional().default(730).describe('Hours per month')
		}),
		executeAsync: async (args) => {
			const service = new CloudPricingService();
			const provider = args.provider as CloudProvider;
			const requirements: WorkloadRequirements & { provider: CloudProvider } = {
				provider,
				compute: {
					vcpusMin: args.vcpus as number | undefined,
					memoryGBMin: args.memoryGB as number | undefined,
					architecture: args.architecture as 'x86' | 'arm' | 'any' | undefined,
					hoursPerMonth: (args.hoursPerMonth as number) || 730
				},
				storage: args.storageGB
					? {
							sizeGB: args.storageGB as number,
							type: args.storageType as 'ssd' | 'hdd' | 'object' | 'archive' | undefined
						}
					: undefined,
				networking: args.egressGBPerMonth
					? { egressGBPerMonth: args.egressGBPerMonth as number }
					: undefined
			};
			const estimate = await service.estimateCost(requirements);
			return {
				provider,
				estimate,
				summary: `${provider.toUpperCase()} estimated monthly cost: $${estimate.monthlyTotal.toFixed(2)}`
			};
		}
	},
	{
		name: 'getAWSPricing',
		description:
			'Get AWS EC2 pricing for comparison purposes. Present as a table: Instance Type | vCPUs | Memory | Price/hr | Price/month. Use alongside getOCIPricing and getAzurePricing for full 3-way comparison. Note AWS free tier is 750 hours/month of t2.micro for 12 months only (not always free).',
		category: 'pricing',
		approvalLevel: 'auto',
		parameters: z.object({
			instanceType: z
				.string()
				.optional()
				.describe('Specific EC2 instance type (e.g., t3.micro, m5.large, c6g.large)'),
			region: z
				.string()
				.optional()
				.default('eu-west-1')
				.describe('AWS region (e.g., us-east-1, eu-west-1, eu-central-1)'),
			architecture: z.enum(['x86', 'arm', 'gpu']).optional().describe('Filter by CPU architecture'),
			listAll: z.boolean().optional().describe('List all available instances with pricing')
		}),
		executeAsync: async (args) => {
			const client = new AWSPricingClient();
			const region = (args.region as string) || 'eu-west-1';
			if (args.listAll || (!args.instanceType && !args.architecture)) {
				const instances = await client.listEC2Instances(
					args.architecture
						? { architecture: args.architecture as 'x86' | 'arm' | 'gpu' }
						: undefined
				);
				return { instances, count: instances.length, region };
			}
			if (args.instanceType) {
				const pricing = await client.getEC2Pricing(args.instanceType as string, region);
				if (!pricing) return { error: `Instance type not found: ${args.instanceType}` };
				const monthlyCost = await client.calculateMonthlyCost({
					instanceType: args.instanceType as string,
					region,
					hoursPerMonth: 730
				});
				return { pricing, monthlyCost, region };
			}
			if (args.architecture) {
				const instances = await client.listEC2Instances({
					architecture: args.architecture as 'x86' | 'arm' | 'gpu'
				});
				return { instances, count: instances.length, architecture: args.architecture, region };
			}
			return { error: 'Please specify an instanceType, architecture, or set listAll to true' };
		}
	}
];
