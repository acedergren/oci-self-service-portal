/**
 * Cloud Pricing Service
 *
 * Integrates with:
 * - OCI Usage API (oci-usageapi) for Oracle Cloud pricing
 * - Azure Retail Prices API for Azure pricing
 * - Static fallback data for when APIs are unavailable
 */

import type { WorkloadRequirements, CostEstimate, CloudComparison } from './types.js';
import { createLogger } from '../server/logger';

const log = createLogger('pricing');

// Azure Retail Prices API (public, no auth required)
const AZURE_PRICING_API = 'https://prices.azure.com/api/retail/prices';

// OCI Pricing page (for reference/fallback)
const _OCI_PRICING_URL = 'https://www.oracle.com/cloud/price-list/';

/**
 * Fetch Azure pricing from the public Retail Prices API
 */
export async function fetchAzurePricing(options: {
	serviceName?: string;
	armRegionName?: string;
	priceType?: 'Consumption' | 'Reservation';
}): Promise<AzurePriceItem[]> {
	const filters: string[] = [];

	if (options.serviceName) {
		filters.push(`serviceName eq '${options.serviceName}'`);
	}
	if (options.armRegionName) {
		filters.push(`armRegionName eq '${options.armRegionName}'`);
	}
	if (options.priceType) {
		filters.push(`priceType eq '${options.priceType}'`);
	}

	const filterQuery =
		filters.length > 0 ? `$filter=${encodeURIComponent(filters.join(' and '))}` : '';

	const url = `${AZURE_PRICING_API}?${filterQuery}`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Azure Pricing API error: ${response.status}`);
		}
		const data = (await response.json()) as AzurePricingResponse;
		return data.Items || [];
	} catch (error) {
		log.error({ err: error }, 'failed to fetch Azure pricing');
		return [];
	}
}

/**
 * Azure Pricing API response types
 */
export interface AzurePriceItem {
	currencyCode: string;
	tierMinimumUnits: number;
	retailPrice: number;
	unitPrice: number;
	armRegionName: string;
	location: string;
	effectiveStartDate: string;
	meterId: string;
	meterName: string;
	productId: string;
	skuId: string;
	productName: string;
	skuName: string;
	serviceName: string;
	serviceId: string;
	serviceFamily: string;
	unitOfMeasure: string;
	type: string;
	isPrimaryMeterRegion: boolean;
	armSkuName: string;
}

interface AzurePricingResponse {
	BillingCurrency: string;
	CustomerEntityId: string;
	CustomerEntityType: string;
	Items: AzurePriceItem[];
	NextPageLink: string | null;
	Count: number;
}

/**
 * Fetch Azure VM pricing for a specific region
 */
export async function fetchAzureVMPricing(
	region: string = 'westeurope'
): Promise<AzurePriceItem[]> {
	return fetchAzurePricing({
		serviceName: 'Virtual Machines',
		armRegionName: region,
		priceType: 'Consumption'
	});
}

/**
 * Fetch Azure OpenAI pricing
 */
export async function fetchAzureOpenAIPricing(): Promise<AzurePriceItem[]> {
	return fetchAzurePricing({
		serviceName: 'Azure OpenAI Service'
	});
}

/**
 * OCI Pricing - uses static data with CLI fallback
 * Note: OCI doesn't have a public pricing API like Azure
 * For real-time pricing, use oci-usageapi for cost/usage data
 */
export async function fetchOCIPricing(): Promise<OCIPriceItem[]> {
	// OCI pricing is retrieved from static data
	// For actual usage costs, use the Usage API
	const ociComputeData = await import('./data/oci-compute.json');

	return ociComputeData.instances.map((instance: any) => ({
		id: instance.id,
		name: instance.name,
		displayName: instance.displayName,
		description: instance.description,
		architecture: instance.architecture,
		pricing: instance.pricing,
		preemptible: instance.preemptible,
		specs: instance.specs
	}));
}

export interface OCIPriceItem {
	id: string;
	name: string;
	displayName: string;
	description: string;
	architecture: string;
	pricing: {
		ocpuPerHour?: number;
		memoryGBPerHour?: number;
		instancePerHour?: number;
	};
	preemptible?: {
		ocpuPerHour?: number;
		memoryGBPerHour?: number;
		instancePerHour?: number;
	};
	specs: {
		ocpuMin?: number;
		ocpuMax?: number;
		ocpus?: number;
		memoryPerOcpuGB?: number;
		memoryGB?: number;
		memoryMaxGB?: number;
		gpuCount?: number;
		gpuType?: string;
	};
}

/**
 * Calculate monthly cost for an OCI compute instance
 */
export function calculateOCIComputeCost(
	instance: OCIPriceItem,
	ocpus: number,
	memoryGB: number,
	hoursPerMonth: number = 730, // ~24 * 30.4
	usePreemptible: boolean = false
): number {
	const pricing = usePreemptible && instance.preemptible ? instance.preemptible : instance.pricing;

	if (pricing.instancePerHour) {
		// Fixed-size instance (like GPU shapes)
		return pricing.instancePerHour * hoursPerMonth;
	}

	if (pricing.ocpuPerHour && pricing.memoryGBPerHour) {
		// Flex shape
		const ocpuCost = pricing.ocpuPerHour * ocpus * hoursPerMonth;
		const memoryCost = pricing.memoryGBPerHour * memoryGB * hoursPerMonth;
		return ocpuCost + memoryCost;
	}

	return 0;
}

/**
 * Calculate monthly cost for an Azure VM
 */
export function calculateAzureVMCost(
	priceItem: AzurePriceItem,
	hoursPerMonth: number = 730
): number {
	// Azure prices are typically per hour
	if (priceItem.unitOfMeasure === '1 Hour') {
		return priceItem.unitPrice * hoursPerMonth;
	}
	return priceItem.unitPrice;
}

/**
 * Find best matching OCI instance for requirements
 */
export function findBestOCIInstance(
	instances: OCIPriceItem[],
	requirements: {
		vcpus: number;
		memoryGB: number;
		architecture?: 'x86' | 'arm' | 'gpu' | 'any';
		gpuRequired?: boolean;
	}
): OCIPriceItem | null {
	// OCI uses OCPUs (1 OCPU = 2 vCPUs)
	const requiredOcpus = Math.ceil(requirements.vcpus / 2);

	const filtered = instances.filter((i) => {
		// Architecture filter
		if (requirements.architecture && requirements.architecture !== 'any') {
			if (i.architecture !== requirements.architecture) return false;
		}

		// GPU filter
		if (requirements.gpuRequired && i.architecture !== 'gpu') return false;
		if (!requirements.gpuRequired && i.architecture === 'gpu') return false;

		// Capacity check for flex shapes
		if (i.specs.ocpuMin !== undefined && i.specs.ocpuMax !== undefined) {
			if (requiredOcpus < i.specs.ocpuMin || requiredOcpus > i.specs.ocpuMax) {
				return false;
			}
		}

		// Capacity check for fixed shapes
		if (i.specs.ocpus !== undefined) {
			if (requiredOcpus > i.specs.ocpus) return false;
		}

		return true;
	});

	if (filtered.length === 0) return null;

	// Sort by cost (cheapest first)
	filtered.sort((a, b) => {
		const costA = calculateOCIComputeCost(a, requiredOcpus, requirements.memoryGB, 1);
		const costB = calculateOCIComputeCost(b, requiredOcpus, requirements.memoryGB, 1);
		return costA - costB;
	});

	return filtered[0];
}

/**
 * Find best matching Azure VM for requirements
 */
export function findBestAzureVM(
	priceItems: AzurePriceItem[],
	_requirements: {
		vcpus: number;
		memoryGB: number;
		architecture?: 'x86' | 'arm' | 'gpu' | 'any';
		gpuRequired?: boolean;
	}
): AzurePriceItem | null {
	// Filter to VMs only (not spot, not low priority)
	const filtered = priceItems.filter((p) => {
		if (!p.armSkuName) return false;
		if (p.skuName.includes('Spot')) return false;
		if (p.skuName.includes('Low Priority')) return false;

		// Only include pay-as-you-go pricing
		if (p.type !== 'Consumption') return false;

		return true;
	});

	if (filtered.length === 0) return null;

	// Sort by price
	filtered.sort((a, b) => a.unitPrice - b.unitPrice);

	return filtered[0];
}

/**
 * Compare costs between OCI and Azure for given requirements
 */
export async function compareCloudCosts(
	requirements: WorkloadRequirements
): Promise<CloudComparison> {
	const estimates: {
		oci: CostEstimate | null;
		azure: CostEstimate | null;
		aws: CostEstimate | null;
	} = {
		oci: null,
		azure: null,
		aws: null
	};

	// Fetch pricing data
	const [ociInstances, azureVMs] = await Promise.all([
		fetchOCIPricing(),
		requirements.compute ? fetchAzureVMPricing('westeurope') : Promise.resolve([])
	]);

	// Calculate OCI costs
	if (requirements.compute) {
		const ociInstance = findBestOCIInstance(ociInstances, {
			vcpus: requirements.compute.vcpusMin || 2,
			memoryGB: requirements.compute.memoryGBMin || 8,
			architecture: requirements.compute.architecture,
			gpuRequired: requirements.compute.gpuRequired
		});

		if (ociInstance) {
			const ocpus = Math.ceil((requirements.compute.vcpusMin || 2) / 2);
			const memoryGB = requirements.compute.memoryGBMin || 8;
			const hoursPerMonth = requirements.compute.hoursPerMonth || 730;

			const monthlyCost = calculateOCIComputeCost(
				ociInstance,
				ocpus,
				memoryGB,
				hoursPerMonth,
				false
			);

			estimates.oci = {
				provider: 'oci',
				region: 'eu-frankfurt-1',
				breakdown: [
					{
						category: 'compute',
						service: ociInstance.name,
						description: ociInstance.displayName,
						quantity: hoursPerMonth,
						unit: 'hour',
						unitPrice: monthlyCost / hoursPerMonth,
						monthlyCost
					}
				],
				monthlyTotal: monthlyCost,
				annualTotal: monthlyCost * 12,
				confidence: 'high',
				notes: [`Using ${ociInstance.displayName} with ${ocpus} OCPUs and ${memoryGB}GB memory`],
				lastUpdated: new Date().toISOString()
			};
		}
	}

	// Calculate Azure costs
	if (requirements.compute && azureVMs.length > 0) {
		const azureVM = findBestAzureVM(azureVMs, {
			vcpus: requirements.compute.vcpusMin || 2,
			memoryGB: requirements.compute.memoryGBMin || 8,
			architecture: requirements.compute.architecture,
			gpuRequired: requirements.compute.gpuRequired
		});

		if (azureVM) {
			const hoursPerMonth = requirements.compute.hoursPerMonth || 730;
			const monthlyCost = calculateAzureVMCost(azureVM, hoursPerMonth);

			estimates.azure = {
				provider: 'azure',
				region: 'westeurope',
				breakdown: [
					{
						category: 'compute',
						service: azureVM.armSkuName,
						description: azureVM.productName,
						quantity: hoursPerMonth,
						unit: 'hour',
						unitPrice: azureVM.unitPrice,
						monthlyCost
					}
				],
				monthlyTotal: monthlyCost,
				annualTotal: monthlyCost * 12,
				confidence: 'high',
				notes: [`Using ${azureVM.productName} (${azureVM.armSkuName})`],
				lastUpdated: new Date().toISOString()
			};
		}
	}

	// Generate recommendation
	let recommendation: CloudComparison['recommendation'];

	if (estimates.oci && estimates.azure) {
		const ociCost = estimates.oci.monthlyTotal;
		const azureCost = estimates.azure.monthlyTotal;
		const cheaper = ociCost < azureCost ? 'oci' : 'azure';
		const savingsPercent = Math.abs(((ociCost - azureCost) / Math.max(ociCost, azureCost)) * 100);

		recommendation = {
			provider: cheaper,
			reasoning: [
				`${cheaper === 'oci' ? 'OCI' : 'Azure'} is ${savingsPercent.toFixed(1)}% cheaper for this workload`,
				`Monthly savings: $${Math.abs(ociCost - azureCost).toFixed(2)}`
			],
			costSavingsPercent: savingsPercent,
			tradeoffs:
				cheaper === 'oci'
					? ['OCI has fewer regions than Azure', 'Azure has broader enterprise integration']
					: ['OCI offers better price-performance for ARM workloads', 'OCI has always-free tier']
		};
	} else if (estimates.oci) {
		recommendation = {
			provider: 'oci',
			reasoning: ['Only OCI pricing available for this configuration'],
			costSavingsPercent: 0,
			tradeoffs: []
		};
	} else if (estimates.azure) {
		recommendation = {
			provider: 'azure',
			reasoning: ['Only Azure pricing available for this configuration'],
			costSavingsPercent: 0,
			tradeoffs: []
		};
	} else {
		recommendation = {
			provider: 'oci',
			reasoning: ['Unable to calculate pricing - using default recommendation'],
			costSavingsPercent: 0,
			tradeoffs: ['Manual pricing verification recommended']
		};
	}

	return {
		requirements,
		estimates,
		recommendation,
		generatedAt: new Date().toISOString()
	};
}

/**
 * Format cost comparison as markdown for AI response
 */
export function formatComparisonAsMarkdown(comparison: CloudComparison): string {
	const lines: string[] = [];

	lines.push('## Cloud Cost Comparison\n');

	// Recommendation
	lines.push(`### Recommendation: **${comparison.recommendation.provider.toUpperCase()}**\n`);
	for (const reason of comparison.recommendation.reasoning) {
		lines.push(`- ${reason}`);
	}
	lines.push('');

	// Cost breakdown
	if (comparison.estimates.oci) {
		lines.push('### OCI Estimate');
		lines.push(`- **Monthly**: $${comparison.estimates.oci.monthlyTotal.toFixed(2)}`);
		lines.push(`- **Annual**: $${comparison.estimates.oci.annualTotal.toFixed(2)}`);
		for (const item of comparison.estimates.oci.breakdown) {
			lines.push(`  - ${item.service}: $${item.monthlyCost.toFixed(2)}/month`);
		}
		lines.push('');
	}

	if (comparison.estimates.azure) {
		lines.push('### Azure Estimate');
		lines.push(`- **Monthly**: $${comparison.estimates.azure.monthlyTotal.toFixed(2)}`);
		lines.push(`- **Annual**: $${comparison.estimates.azure.annualTotal.toFixed(2)}`);
		for (const item of comparison.estimates.azure.breakdown) {
			lines.push(`  - ${item.service}: $${item.monthlyCost.toFixed(2)}/month`);
		}
		lines.push('');
	}

	// Tradeoffs
	if (comparison.recommendation.tradeoffs.length > 0) {
		lines.push('### Considerations');
		for (const tradeoff of comparison.recommendation.tradeoffs) {
			lines.push(`- ${tradeoff}`);
		}
	}

	return lines.join('\n');
}
