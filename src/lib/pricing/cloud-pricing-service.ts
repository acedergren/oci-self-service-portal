/**
 * Multi-Cloud Pricing Service
 *
 * Provides pricing comparison between OCI and Azure using:
 * - OCI: oci-pricing-mcp (static data + optional MCP client)
 * - Azure: Azure Retail Prices API (public REST API)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('cloud-pricing');
import type {
  CloudProvider,
  WorkloadRequirements,
  CostEstimate,
  CloudComparison,
  Region,
  ServiceCategory,
  PricingUnit,
} from './types.js';

// ============================================================================
// Types for this module
// ============================================================================

export interface OCIComputePrice {
  shapeName: string;
  ocpuPricePerHour: number;
  memoryGBPricePerHour: number;
  currency: string;
  architecture: 'x86' | 'arm' | 'gpu';
  gpuCount?: number;
  gpuType?: string;
}

export interface OCIStoragePrice {
  storageType: 'block-ssd' | 'block-hdd' | 'object-standard' | 'object-archive';
  pricePerGBMonth: number;
  currency: string;
}

export interface OCIFreeTier {
  compute: {
    armOcpus: number;
    memoryGB: number;
  };
  storage: {
    blockStorageGB: number;
    objectStorageGB: number;
  };
  database: {
    autonomousDBs: number;
    storageGB: number;
  };
  networking: {
    egressTBFree: number;
  };
}

export interface OCIComputeCostConfig {
  shapeName: string;
  ocpus: number;
  memoryGB: number;
  hoursPerMonth: number;
  preemptible?: boolean;
}

export interface OCIComputeCostResult {
  monthlyCost: number;
  breakdown: {
    ocpuCost: number;
    memoryCost: number;
  };
  currency: string;
}

export interface AzureRetailPrice {
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

export interface AzureSearchOptions {
  serviceName?: string;
  armRegionName?: string;
  armSkuName?: string;
  priceType?: string;
}

export interface AzureCostConfig {
  skuName: string;
  region: string;
  hoursPerMonth: number;
}

export interface AzureCostResult {
  monthlyCost: number;
  hourlyRate: number;
  currency: string;
}

export interface AzureRegionComparison {
  region: string;
  skuName: string;
  retailPrice: number;
  currency: string;
}

export interface PricingResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Static Pricing Data
// ============================================================================

// OCI compute pricing (as of 2026, USD per hour)
const OCI_COMPUTE_PRICES: Record<string, OCIComputePrice> = {
  'VM.Standard.E5.Flex': {
    shapeName: 'VM.Standard.E5.Flex',
    ocpuPricePerHour: 0.03,
    memoryGBPricePerHour: 0.0015,
    currency: 'USD',
    architecture: 'x86',
  },
  'VM.Standard.E4.Flex': {
    shapeName: 'VM.Standard.E4.Flex',
    ocpuPricePerHour: 0.025,
    memoryGBPricePerHour: 0.0015,
    currency: 'USD',
    architecture: 'x86',
  },
  'VM.Standard.A1.Flex': {
    shapeName: 'VM.Standard.A1.Flex',
    ocpuPricePerHour: 0.01,
    memoryGBPricePerHour: 0.001,
    currency: 'USD',
    architecture: 'arm',
  },
  'VM.Standard3.Flex': {
    shapeName: 'VM.Standard3.Flex',
    ocpuPricePerHour: 0.04,
    memoryGBPricePerHour: 0.002,
    currency: 'USD',
    architecture: 'x86',
  },
  'VM.GPU.A10.1': {
    shapeName: 'VM.GPU.A10.1',
    ocpuPricePerHour: 2.95,
    memoryGBPricePerHour: 0,
    currency: 'USD',
    architecture: 'gpu',
    gpuCount: 1,
    gpuType: 'NVIDIA A10',
  },
  'VM.GPU.A10.2': {
    shapeName: 'VM.GPU.A10.2',
    ocpuPricePerHour: 5.9,
    memoryGBPricePerHour: 0,
    currency: 'USD',
    architecture: 'gpu',
    gpuCount: 2,
    gpuType: 'NVIDIA A10',
  },
  'BM.GPU.A100-v2.8': {
    shapeName: 'BM.GPU.A100-v2.8',
    ocpuPricePerHour: 34.0,
    memoryGBPricePerHour: 0,
    currency: 'USD',
    architecture: 'gpu',
    gpuCount: 8,
    gpuType: 'NVIDIA A100 80GB',
  },
};

// OCI storage pricing (USD per GB per month)
const OCI_STORAGE_PRICES: Record<string, OCIStoragePrice> = {
  'block-ssd': {
    storageType: 'block-ssd',
    pricePerGBMonth: 0.0255,
    currency: 'USD',
  },
  'block-hdd': {
    storageType: 'block-hdd',
    pricePerGBMonth: 0.0085,
    currency: 'USD',
  },
  'object-standard': {
    storageType: 'object-standard',
    pricePerGBMonth: 0.0255,
    currency: 'USD',
  },
  'object-archive': {
    storageType: 'object-archive',
    pricePerGBMonth: 0.0026,
    currency: 'USD',
  },
};

// OCI Always Free Tier
const OCI_FREE_TIER: OCIFreeTier = {
  compute: {
    armOcpus: 4,
    memoryGB: 24,
  },
  storage: {
    blockStorageGB: 200,
    objectStorageGB: 20,
  },
  database: {
    autonomousDBs: 2,
    storageGB: 20,
  },
  networking: {
    egressTBFree: 10,
  },
};

// Preemptible discount (50% off)
const OCI_PREEMPTIBLE_DISCOUNT = 0.5;

// Azure static pricing data for common SKUs (backup when API fails)
const AZURE_VM_PRICES: Record<string, Record<string, number>> = {
  'Standard_D2s_v3': {
    westeurope: 0.096,
    eastus: 0.096,
    westus2: 0.096,
    northeurope: 0.096,
  },
  'Standard_D4s_v3': {
    westeurope: 0.192,
    eastus: 0.192,
    westus2: 0.192,
    northeurope: 0.192,
  },
  'Standard_D8s_v3': {
    westeurope: 0.384,
    eastus: 0.384,
    westus2: 0.384,
    northeurope: 0.384,
  },
  'Standard_B2s': {
    westeurope: 0.0416,
    eastus: 0.0416,
    westus2: 0.0416,
    northeurope: 0.0416,
  },
  'Standard_D2ps_v5': {
    // ARM
    westeurope: 0.077,
    eastus: 0.077,
    westus2: 0.077,
    northeurope: 0.077,
  },
};

// Azure storage pricing (USD per GB per month)
const AZURE_STORAGE_PRICES = {
  'managed-ssd-premium': 0.132, // P10 per GB
  'managed-ssd-standard': 0.075,
  'blob-hot': 0.0184,
  'blob-cool': 0.01,
  'blob-archive': 0.00099,
};

// Azure egress pricing (USD per GB)
const AZURE_EGRESS_PRICE_PER_GB = 0.087;

// ============================================================================
// OCI Pricing Client
// ============================================================================

export class OCIPricingClient {
  /**
   * Get compute pricing for a specific shape
   */
  async getComputePricing(shapeName: string): Promise<OCIComputePrice | null> {
    const price = OCI_COMPUTE_PRICES[shapeName];
    return price ?? null;
  }

  /**
   * List all available compute shapes
   */
  async listComputeShapes(filter?: {
    architecture?: 'x86' | 'arm' | 'gpu';
  }): Promise<OCIComputePrice[]> {
    let shapes = Object.values(OCI_COMPUTE_PRICES);

    if (filter?.architecture) {
      shapes = shapes.filter((s) => s.architecture === filter.architecture);
    }

    return shapes;
  }

  /**
   * Calculate monthly cost for a compute configuration
   */
  async calculateMonthlyCost(config: OCIComputeCostConfig): Promise<OCIComputeCostResult> {
    const pricing = await this.getComputePricing(config.shapeName);

    if (!pricing) {
      throw new Error(`Unknown shape: ${config.shapeName}`);
    }

    let ocpuCost = pricing.ocpuPricePerHour * config.ocpus * config.hoursPerMonth;
    let memoryCost = pricing.memoryGBPricePerHour * config.memoryGB * config.hoursPerMonth;

    // Apply preemptible discount if requested
    if (config.preemptible) {
      ocpuCost *= OCI_PREEMPTIBLE_DISCOUNT;
      memoryCost *= OCI_PREEMPTIBLE_DISCOUNT;
    }

    return {
      monthlyCost: ocpuCost + memoryCost,
      breakdown: {
        ocpuCost,
        memoryCost,
      },
      currency: 'USD',
    };
  }

  /**
   * Get storage pricing by type
   */
  async getStoragePricing(
    type: 'block-ssd' | 'block-hdd' | 'object-standard' | 'object-archive'
  ): Promise<OCIStoragePrice | null> {
    return OCI_STORAGE_PRICES[type] ?? null;
  }

  /**
   * Get OCI Always Free tier details
   */
  async getFreeTier(): Promise<OCIFreeTier> {
    return OCI_FREE_TIER;
  }
}

// ============================================================================
// Azure Pricing Client
// ============================================================================

export class AzurePricingClient {
  private baseUrl = 'https://prices.azure.com/api/retail/prices';

  /**
   * Search Azure pricing with filters
   */
  async searchPricing(options: AzureSearchOptions): Promise<AzureRetailPrice[]> {
    try {
      const filters: string[] = [];

      if (options.serviceName) {
        filters.push(`serviceName eq '${options.serviceName}'`);
      }
      if (options.armRegionName) {
        filters.push(`armRegionName eq '${options.armRegionName}'`);
      }
      if (options.armSkuName) {
        filters.push(`armSkuName eq '${options.armSkuName}'`);
      }
      if (options.priceType) {
        filters.push(`priceType eq '${options.priceType}'`);
      }

      // Always filter to Consumption pricing (not reservations)
      filters.push("priceType eq 'Consumption'");

      const filterQuery = filters.join(' and ');
      const url = `${this.baseUrl}?$filter=${encodeURIComponent(filterQuery)}`;

      const response = await fetch(url);
      if (!response.ok) {
        log.error({ status: response.status }, 'Azure API error');
        return [];
      }

      const data = (await response.json()) as { Items: AzureRetailPrice[] };
      return data.Items ?? [];
    } catch (error) {
      log.error({ err: error }, 'Azure pricing fetch error');
      return [];
    }
  }

  /**
   * Get pricing for a specific VM SKU and region
   */
  async getVMPricing(skuName: string, region: string): Promise<AzureRetailPrice | null> {
    // Try API first
    const results = await this.searchPricing({
      serviceName: 'Virtual Machines',
      armSkuName: skuName,
      armRegionName: region,
    });

    // Filter to Linux VMs (not Windows) and primary meter
    const linuxPrices = results.filter(
      (r) =>
        !r.productName.toLowerCase().includes('windows') &&
        r.unitOfMeasure === '1 Hour' &&
        r.type === 'Consumption'
    );

    if (linuxPrices.length > 0) {
      return linuxPrices[0];
    }

    // Fallback to static data
    const staticPrice = AZURE_VM_PRICES[skuName]?.[region];
    if (staticPrice) {
      return {
        currencyCode: 'USD',
        tierMinimumUnits: 0,
        retailPrice: staticPrice,
        unitPrice: staticPrice,
        armRegionName: region,
        location: region,
        effectiveStartDate: new Date().toISOString(),
        meterId: 'static',
        meterName: skuName,
        productId: 'static',
        skuId: 'static',
        productName: `Virtual Machines ${skuName}`,
        skuName: skuName,
        serviceName: 'Virtual Machines',
        serviceId: 'static',
        serviceFamily: 'Compute',
        unitOfMeasure: '1 Hour',
        type: 'Consumption',
        isPrimaryMeterRegion: true,
        armSkuName: skuName,
      };
    }

    return null;
  }

  /**
   * Calculate monthly cost for an Azure VM
   */
  async calculateMonthlyCost(config: AzureCostConfig): Promise<AzureCostResult> {
    const pricing = await this.getVMPricing(config.skuName, config.region);

    if (!pricing) {
      throw new Error(`Unknown SKU: ${config.skuName} in region ${config.region}`);
    }

    return {
      monthlyCost: pricing.retailPrice * config.hoursPerMonth,
      hourlyRate: pricing.retailPrice,
      currency: 'USD',
    };
  }

  /**
   * Compare pricing across multiple regions
   */
  async compareRegions(options: {
    serviceName: string;
    skuName: string;
    regions: string[];
  }): Promise<AzureRegionComparison[]> {
    const comparisons: AzureRegionComparison[] = [];

    for (const region of options.regions) {
      const pricing = await this.getVMPricing(options.skuName, region);
      if (pricing) {
        comparisons.push({
          region,
          skuName: options.skuName,
          retailPrice: pricing.retailPrice,
          currency: pricing.currencyCode,
        });
      }
    }

    return comparisons;
  }
}

// ============================================================================
// AWS Pricing Client
// ============================================================================

export interface AWSEC2Instance {
  id: string;
  name: string;
  displayName: string;
  description: string;
  architecture: 'x86' | 'arm' | 'gpu';
  family: string;
  burstable?: boolean;
  specs: {
    vcpus: number;
    memoryGB: number;
    networkBandwidth?: string;
  };
  pricing: {
    onDemand: number;
    reserved1Year?: number;
    reserved3Year?: number;
    spot?: number;
  };
}

export interface AWSComputeData {
  metadata: {
    provider: string;
    lastUpdated: string;
    currency: string;
  };
  instances: AWSEC2Instance[];
}

export interface AWSCostConfig {
  instanceType: string;
  region: string;
  hoursPerMonth: number;
}

export interface AWSCostResult {
  monthlyCost: number;
  hourlyRate: number;
  currency: string;
}

// AWS egress pricing (USD per GB, after 100GB free)
const AWS_EGRESS_PRICE_PER_GB = 0.09;
const AWS_FREE_EGRESS_GB = 100;

export class AWSPricingClient {
  private instances: AWSEC2Instance[] | null = null;

  private loadPricingData(): AWSEC2Instance[] {
    if (this.instances) return this.instances;
    try {
      // Use import.meta.url for ESM path resolution
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const dataPath = join(currentDir, 'data', 'aws-compute.json');
      const raw = readFileSync(dataPath, 'utf-8');
      const data = JSON.parse(raw) as AWSComputeData;
      this.instances = data.instances;
      return this.instances;
    } catch {
      // Fallback: return inline minimal data if file not found
      this.instances = [];
      return this.instances;
    }
  }

  /**
   * Get pricing for a specific EC2 instance type
   */
  async getEC2Pricing(instanceType: string, _region?: string): Promise<AWSEC2Instance | null> {
    const instances = this.loadPricingData();
    return instances.find((i) => i.name === instanceType) ?? null;
  }

  /**
   * List all available EC2 instances
   */
  async listEC2Instances(filter?: {
    architecture?: 'x86' | 'arm' | 'gpu';
  }): Promise<AWSEC2Instance[]> {
    let instances = this.loadPricingData();
    if (filter?.architecture) {
      instances = instances.filter((i) => i.architecture === filter.architecture);
    }
    return instances;
  }

  /**
   * Calculate monthly cost for an EC2 instance
   */
  async calculateMonthlyCost(config: AWSCostConfig): Promise<AWSCostResult> {
    const instance = await this.getEC2Pricing(config.instanceType, config.region);
    if (!instance) {
      throw new Error(`Unknown instance type: ${config.instanceType}`);
    }
    return {
      monthlyCost: instance.pricing.onDemand * config.hoursPerMonth,
      hourlyRate: instance.pricing.onDemand,
      currency: 'USD',
    };
  }
}

// ============================================================================
// Cloud Pricing Service (Orchestrator)
// ============================================================================

export class CloudPricingService {
  private ociClient: OCIPricingClient;
  private azureClient: AzurePricingClient;
  private awsClient: AWSPricingClient;

  constructor() {
    this.ociClient = new OCIPricingClient();
    this.azureClient = new AzurePricingClient();
    this.awsClient = new AWSPricingClient();
  }

  /**
   * Compare costs between OCI, Azure, and AWS for given requirements
   */
  async compareCloudCosts(requirements: WorkloadRequirements): Promise<CloudComparison> {
    const [ociEstimate, azureEstimate, awsEstimate] = await Promise.all([
      this.estimateOCICost(requirements),
      this.estimateAzureCost(requirements),
      this.estimateAWSCost(requirements),
    ]);

    const recommendation = this.generateRecommendation(requirements, ociEstimate, azureEstimate, awsEstimate);

    return {
      requirements,
      estimates: {
        oci: ociEstimate,
        azure: azureEstimate,
        aws: awsEstimate,
      },
      recommendation,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Estimate cost for a single provider
   */
  async estimateCost(
    config: WorkloadRequirements & { provider: CloudProvider }
  ): Promise<CostEstimate> {
    if (config.provider === 'oci') {
      return this.estimateOCICost(config);
    } else if (config.provider === 'aws') {
      return this.estimateAWSCost(config);
    } else {
      return this.estimateAzureCost(config);
    }
  }

  /**
   * Get recommendation based on requirements
   */
  async getRecommendation(requirements: WorkloadRequirements): Promise<{
    provider: CloudProvider;
    reasoning: string[];
    costSavingsPercent: number;
    tradeoffs: string[];
  }> {
    const comparison = await this.compareCloudCosts(requirements);
    return comparison.recommendation;
  }

  /**
   * Format comparison as markdown
   */
  formatAsMarkdown(comparison: CloudComparison): string {
    const { estimates, recommendation, requirements } = comparison;
    const lines: string[] = [];

    lines.push('## Cloud Cost Comparison');
    lines.push('');

    // Requirements summary
    lines.push('### Requirements');
    if (requirements.compute) {
      lines.push(
        `- **Compute**: ${requirements.compute.vcpusMin ?? '?'} vCPUs, ${requirements.compute.memoryGBMin ?? '?'} GB RAM`
      );
      if (requirements.compute.architecture) {
        lines.push(`- **Architecture**: ${requirements.compute.architecture}`);
      }
    }
    if (requirements.storage) {
      lines.push(`- **Storage**: ${requirements.storage.sizeGB} GB ${requirements.storage.type ?? 'SSD'}`);
    }
    if (requirements.networking?.egressGBPerMonth) {
      lines.push(`- **Egress**: ${requirements.networking.egressGBPerMonth} GB/month`);
    }
    lines.push('');

    // OCI Estimate
    lines.push('### OCI Estimate');
    if (estimates.oci) {
      lines.push(`**Monthly Total: $${estimates.oci.monthlyTotal.toFixed(2)}**`);
      lines.push('');
      lines.push('| Service | Monthly Cost |');
      lines.push('|---------|-------------|');
      for (const item of estimates.oci.breakdown) {
        lines.push(`| ${item.service} | $${item.monthlyCost.toFixed(2)} |`);
      }
      if (estimates.oci.notes.length > 0) {
        lines.push('');
        lines.push('**Notes:**');
        for (const note of estimates.oci.notes) {
          lines.push(`- ${note}`);
        }
      }
    } else {
      lines.push('*Unable to estimate*');
    }
    lines.push('');

    // Azure Estimate
    lines.push('### Azure Estimate');
    if (estimates.azure) {
      lines.push(`**Monthly Total: $${estimates.azure.monthlyTotal.toFixed(2)}**`);
      lines.push('');
      lines.push('| Service | Monthly Cost |');
      lines.push('|---------|-------------|');
      for (const item of estimates.azure.breakdown) {
        lines.push(`| ${item.service} | $${item.monthlyCost.toFixed(2)} |`);
      }
      if (estimates.azure.notes.length > 0) {
        lines.push('');
        lines.push('**Notes:**');
        for (const note of estimates.azure.notes) {
          lines.push(`- ${note}`);
        }
      }
    } else {
      lines.push('*Unable to estimate*');
    }
    lines.push('');

    // AWS Estimate
    lines.push('### AWS Estimate');
    if (estimates.aws) {
      lines.push(`**Monthly Total: $${estimates.aws.monthlyTotal.toFixed(2)}**`);
      lines.push('');
      lines.push('| Service | Monthly Cost |');
      lines.push('|---------|-------------|');
      for (const item of estimates.aws.breakdown) {
        lines.push(`| ${item.service} | $${item.monthlyCost.toFixed(2)} |`);
      }
      if (estimates.aws.notes.length > 0) {
        lines.push('');
        lines.push('**Notes:**');
        for (const note of estimates.aws.notes) {
          lines.push(`- ${note}`);
        }
      }
    } else {
      lines.push('*Unable to estimate*');
    }
    lines.push('');

    // Recommendation
    lines.push('### Recommendation');
    lines.push(`**${recommendation.provider.toUpperCase()}** is recommended`);
    if (recommendation.costSavingsPercent > 0) {
      lines.push(`- **Savings**: ${recommendation.costSavingsPercent.toFixed(1)}% lower cost`);
    }
    lines.push('');
    lines.push('**Reasoning:**');
    for (const reason of recommendation.reasoning) {
      lines.push(`- ${reason}`);
    }
    if (recommendation.tradeoffs.length > 0) {
      lines.push('');
      lines.push('**Tradeoffs:**');
      for (const tradeoff of recommendation.tradeoffs) {
        lines.push(`- ${tradeoff}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async estimateOCICost(requirements: WorkloadRequirements): Promise<CostEstimate> {
    const breakdown: CostEstimate['breakdown'] = [];
    const notes: string[] = [];
    let monthlyTotal = 0;

    const hoursPerMonth = requirements.compute?.hoursPerMonth ?? 730;

    // Compute costs
    if (requirements.compute) {
      const shape = this.selectOCIShape(requirements);
      const vcpus = requirements.compute.vcpusMin ?? 2;
      const ocpus = Math.ceil(vcpus / 2); // OCI OCPU = 2 vCPUs
      const memoryGB = requirements.compute.memoryGBMin ?? 8;

      const pricing = await this.ociClient.getComputePricing(shape);
      if (pricing) {
        const computeCost = await this.ociClient.calculateMonthlyCost({
          shapeName: shape,
          ocpus,
          memoryGB,
          hoursPerMonth,
        });

        // Check free tier eligibility
        const freeTier = await this.ociClient.getFreeTier();
        const isARM = pricing.architecture === 'arm';
        const withinFreeTier =
          isARM && ocpus <= freeTier.compute.armOcpus && memoryGB <= freeTier.compute.memoryGB;

        if (withinFreeTier) {
          notes.push('This configuration is eligible for OCI Always Free tier');
          // Don't add compute cost for free tier eligible
        } else {
          breakdown.push({
            category: 'compute',
            service: shape,
            description: `${ocpus} OCPUs, ${memoryGB} GB RAM`,
            quantity: hoursPerMonth,
            unit: 'OCPU-hour',
            unitPrice: pricing.ocpuPricePerHour,
            monthlyCost: computeCost.monthlyCost,
          });
          monthlyTotal += computeCost.monthlyCost;
        }
      }
    }

    // Storage costs
    if (requirements.storage) {
      const storageType = requirements.storage.type === 'ssd' ? 'block-ssd' : 'block-hdd';
      const storagePricing = await this.ociClient.getStoragePricing(storageType);

      if (storagePricing) {
        const storageCost = storagePricing.pricePerGBMonth * requirements.storage.sizeGB;
        breakdown.push({
          category: 'storage',
          service: `OCI Block Volume (${storageType})`,
          description: `${requirements.storage.sizeGB} GB`,
          quantity: requirements.storage.sizeGB,
          unit: 'GB-month',
          unitPrice: storagePricing.pricePerGBMonth,
          monthlyCost: storageCost,
        });
        monthlyTotal += storageCost;
      }
    }

    // Networking/egress costs
    if (requirements.networking?.egressGBPerMonth) {
      const freeTier = await this.ociClient.getFreeTier();
      const freeEgressGB = freeTier.networking.egressTBFree * 1000;
      const billableEgress = Math.max(0, requirements.networking.egressGBPerMonth - freeEgressGB);

      if (billableEgress > 0) {
        // OCI egress pricing: ~$0.0085/GB after free tier
        const egressCost = billableEgress * 0.0085;
        breakdown.push({
          category: 'networking',
          service: 'OCI Outbound Data Transfer',
          description: `${billableEgress} GB (after ${freeTier.networking.egressTBFree}TB free)`,
          quantity: billableEgress,
          unit: 'GB',
          unitPrice: 0.0085,
          monthlyCost: egressCost,
        });
        monthlyTotal += egressCost;
      } else {
        notes.push(`Egress is within free tier (${freeTier.networking.egressTBFree}TB/month free)`);
      }
    }

    return {
      provider: 'oci',
      region: 'eu-frankfurt-1',
      breakdown,
      monthlyTotal,
      annualTotal: monthlyTotal * 12,
      confidence: 'high',
      notes,
      lastUpdated: new Date().toISOString(),
    };
  }

  private async estimateAzureCost(requirements: WorkloadRequirements): Promise<CostEstimate> {
    const breakdown: CostEstimate['breakdown'] = [];
    const notes: string[] = [];
    let monthlyTotal = 0;

    const hoursPerMonth = requirements.compute?.hoursPerMonth ?? 730;
    const region = 'westeurope';

    // Compute costs
    if (requirements.compute) {
      const sku = this.selectAzureSKU(requirements);
      const pricing = await this.azureClient.getVMPricing(sku, region);

      if (pricing) {
        const computeCost = pricing.retailPrice * hoursPerMonth;
        breakdown.push({
          category: 'compute',
          service: `Azure VM (${sku})`,
          description: `${region}`,
          quantity: hoursPerMonth,
          unit: 'hour',
          unitPrice: pricing.retailPrice,
          monthlyCost: computeCost,
        });
        monthlyTotal += computeCost;
      }
    }

    // Storage costs
    if (requirements.storage) {
      const pricePerGB =
        requirements.storage.type === 'ssd'
          ? AZURE_STORAGE_PRICES['managed-ssd-standard']
          : AZURE_STORAGE_PRICES['managed-ssd-standard'];
      const storageCost = pricePerGB * requirements.storage.sizeGB;

      breakdown.push({
        category: 'storage',
        service: 'Azure Managed Disk (Standard SSD)',
        description: `${requirements.storage.sizeGB} GB`,
        quantity: requirements.storage.sizeGB,
        unit: 'GB-month',
        unitPrice: pricePerGB,
        monthlyCost: storageCost,
      });
      monthlyTotal += storageCost;
    }

    // Networking/egress costs
    if (requirements.networking?.egressGBPerMonth) {
      // Azure: First 5GB free, then tiered pricing (~$0.087/GB for most regions)
      const freeEgressGB = 5;
      const billableEgress = Math.max(0, requirements.networking.egressGBPerMonth - freeEgressGB);

      if (billableEgress > 0) {
        const egressCost = billableEgress * AZURE_EGRESS_PRICE_PER_GB;
        breakdown.push({
          category: 'networking',
          service: 'Azure Outbound Data Transfer',
          description: `${billableEgress} GB`,
          quantity: billableEgress,
          unit: 'GB',
          unitPrice: AZURE_EGRESS_PRICE_PER_GB,
          monthlyCost: egressCost,
        });
        monthlyTotal += egressCost;
      }
    }

    return {
      provider: 'azure',
      region: region as Region,
      breakdown,
      monthlyTotal,
      annualTotal: monthlyTotal * 12,
      confidence: 'high',
      notes,
      lastUpdated: new Date().toISOString(),
    };
  }

  private async estimateAWSCost(requirements: WorkloadRequirements): Promise<CostEstimate> {
    const breakdown: CostEstimate['breakdown'] = [];
    const notes: string[] = [];
    let monthlyTotal = 0;

    const hoursPerMonth = requirements.compute?.hoursPerMonth ?? 730;
    const region = 'eu-west-1';

    // Compute costs
    if (requirements.compute) {
      const instanceType = this.selectAWSInstanceType(requirements);
      const pricing = await this.awsClient.getEC2Pricing(instanceType);

      if (pricing) {
        const computeCost = pricing.pricing.onDemand * hoursPerMonth;
        breakdown.push({
          category: 'compute',
          service: `AWS EC2 (${instanceType})`,
          description: `${pricing.specs.vcpus} vCPUs, ${pricing.specs.memoryGB} GB RAM`,
          quantity: hoursPerMonth,
          unit: 'hour',
          unitPrice: pricing.pricing.onDemand,
          monthlyCost: computeCost,
        });
        monthlyTotal += computeCost;
      }
    }

    // Storage costs (EBS gp3)
    if (requirements.storage) {
      const pricePerGB = requirements.storage.type === 'ssd' ? 0.08 : 0.045; // gp3 vs st1
      const storageCost = pricePerGB * requirements.storage.sizeGB;

      breakdown.push({
        category: 'storage',
        service: `AWS EBS (${requirements.storage.type === 'ssd' ? 'gp3' : 'st1'})`,
        description: `${requirements.storage.sizeGB} GB`,
        quantity: requirements.storage.sizeGB,
        unit: 'GB-month',
        unitPrice: pricePerGB,
        monthlyCost: storageCost,
      });
      monthlyTotal += storageCost;
    }

    // Networking/egress costs
    if (requirements.networking?.egressGBPerMonth) {
      const billableEgress = Math.max(0, requirements.networking.egressGBPerMonth - AWS_FREE_EGRESS_GB);

      if (billableEgress > 0) {
        const egressCost = billableEgress * AWS_EGRESS_PRICE_PER_GB;
        breakdown.push({
          category: 'networking',
          service: 'AWS Data Transfer Out',
          description: `${billableEgress} GB (after ${AWS_FREE_EGRESS_GB}GB free)`,
          quantity: billableEgress,
          unit: 'GB',
          unitPrice: AWS_EGRESS_PRICE_PER_GB,
          monthlyCost: egressCost,
        });
        monthlyTotal += egressCost;
      } else {
        notes.push(`Egress is within AWS free tier (${AWS_FREE_EGRESS_GB}GB/month free)`);
      }
    }

    notes.push('AWS Free Tier: t2.micro/t3.micro 750 hrs/month for 12 months only (not always free)');

    return {
      provider: 'aws',
      region: region as Region,
      breakdown,
      monthlyTotal,
      annualTotal: monthlyTotal * 12,
      confidence: 'high',
      notes,
      lastUpdated: new Date().toISOString(),
    };
  }

  private selectOCIShape(requirements: WorkloadRequirements): string {
    const arch = requirements.compute?.architecture ?? 'x86';
    const gpuRequired = requirements.compute?.gpuRequired ?? false;

    if (gpuRequired) {
      return 'VM.GPU.A10.1';
    }

    if (arch === 'arm') {
      return 'VM.Standard.A1.Flex';
    }

    return 'VM.Standard.E5.Flex';
  }

  private selectAzureSKU(requirements: WorkloadRequirements): string {
    const vcpus = requirements.compute?.vcpusMin ?? 2;
    const arch = requirements.compute?.architecture ?? 'x86';

    if (arch === 'arm') {
      return 'Standard_D2ps_v5';
    }

    if (vcpus <= 2) {
      return 'Standard_D2s_v3';
    } else if (vcpus <= 4) {
      return 'Standard_D4s_v3';
    } else {
      return 'Standard_D8s_v3';
    }
  }

  private selectAWSInstanceType(requirements: WorkloadRequirements): string {
    const vcpus = requirements.compute?.vcpusMin ?? 2;
    const arch = requirements.compute?.architecture ?? 'x86';

    if (arch === 'arm') {
      if (vcpus <= 2) return 'm6g.large';
      return 'm6g.large'; // Scale up manually as needed
    }

    if (vcpus <= 2) {
      return 'm5.large';
    } else if (vcpus <= 4) {
      return 'm5.xlarge';
    } else {
      return 'm5.2xlarge';
    }
  }

  private generateRecommendation(
    requirements: WorkloadRequirements,
    ociEstimate: CostEstimate,
    azureEstimate: CostEstimate,
    awsEstimate?: CostEstimate
  ): CloudComparison['recommendation'] {
    const reasoning: string[] = [];
    const tradeoffs: string[] = [];

    // Check for preferred provider constraint
    if (requirements.constraints?.preferredProvider) {
      const preferred = requirements.constraints.preferredProvider;
      reasoning.push(`User preference for ${preferred.toUpperCase()}`);
      
      const preferredCost = preferred === 'oci' ? ociEstimate.monthlyTotal : azureEstimate.monthlyTotal;
      const otherCost = preferred === 'oci' ? azureEstimate.monthlyTotal : ociEstimate.monthlyTotal;
      
      if (preferredCost > otherCost) {
        const pctHigher = ((preferredCost - otherCost) / otherCost) * 100;
        tradeoffs.push(`${preferred.toUpperCase()} is ${pctHigher.toFixed(1)}% more expensive for this workload`);
      }

      return {
        provider: preferred,
        reasoning,
        costSavingsPercent: 0,
        tradeoffs,
      };
    }

    // Check budget constraint
    if (requirements.constraints?.maxBudgetPerMonth) {
      const budget = requirements.constraints.maxBudgetPerMonth;
      if (ociEstimate.monthlyTotal > budget && azureEstimate.monthlyTotal > budget) {
        reasoning.push(`Both providers exceed budget of $${budget}/month`);
        reasoning.push('Consider reducing requirements or using reserved instances');
      } else if (ociEstimate.monthlyTotal > budget) {
        reasoning.push(`OCI exceeds budget, Azure fits within $${budget}/month`);
      } else if (azureEstimate.monthlyTotal > budget) {
        reasoning.push(`Azure exceeds budget, OCI fits within $${budget}/month`);
      }
    }

    // Cost comparison (3-way)
    const allEstimates: { provider: CloudProvider; cost: number }[] = [
      { provider: 'oci', cost: ociEstimate.monthlyTotal },
      { provider: 'azure', cost: azureEstimate.monthlyTotal },
    ];
    if (awsEstimate) {
      allEstimates.push({ provider: 'aws', cost: awsEstimate.monthlyTotal });
    }

    allEstimates.sort((a, b) => a.cost - b.cost);
    const cheapest = allEstimates[0];
    const mostExpensive = allEstimates[allEstimates.length - 1];
    const savingsPercent =
      mostExpensive.cost > 0
        ? ((mostExpensive.cost - cheapest.cost) / mostExpensive.cost) * 100
        : 0;

    const recommendedProvider: CloudProvider = cheapest.provider;

    // Add cost reasoning
    if (savingsPercent > 5) {
      const costSummary = allEstimates
        .map((e) => `${e.provider.toUpperCase()}: $${e.cost.toFixed(2)}`)
        .join(', ');
      reasoning.push(
        `${recommendedProvider.toUpperCase()} is ${savingsPercent.toFixed(1)}% cheaper (${costSummary}/month)`
      );
    } else {
      reasoning.push('Costs are similar across providers');
    }

    // Architecture-specific reasoning
    if (requirements.compute?.architecture === 'arm') {
      reasoning.push('OCI Ampere A1 (ARM) offers excellent price-performance');
      if (recommendedProvider === 'oci') {
        reasoning.push('OCI A1.Flex includes 4 OCPUs and 24GB RAM in Always Free tier');
      }
    }

    // Egress reasoning
    if (requirements.networking?.egressGBPerMonth) {
      const egress = requirements.networking.egressGBPerMonth;
      if (egress > 100) {
        reasoning.push(`OCI includes 10TB/month free egress vs Azure's 5GB free`);
        if (egress <= 10000) {
          reasoning.push('Data egress is free on OCI for this workload');
        }
      }
    }

    // Add general tradeoffs
    if (recommendedProvider === 'oci') {
      tradeoffs.push('Azure/AWS have broader global region availability');
      tradeoffs.push('AWS has the largest marketplace and ecosystem');
    } else if (recommendedProvider === 'aws') {
      tradeoffs.push('OCI offers better Oracle database integration');
      tradeoffs.push('OCI has more generous always-free tier and 10TB/month free egress');
    } else {
      tradeoffs.push('OCI offers better Oracle database integration and 10TB free egress');
      tradeoffs.push('AWS has the largest marketplace and service breadth');
    }

    return {
      provider: recommendedProvider,
      reasoning,
      costSavingsPercent: savingsPercent,
      tradeoffs,
    };
  }
}
