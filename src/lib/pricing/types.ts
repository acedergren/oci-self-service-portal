/**
 * Multi-cloud pricing types for OCI and Azure
 * Supports compute, storage, networking, database, and GenAI services
 */

export type CloudProvider = 'oci' | 'azure' | 'aws';

export type ServiceCategory = 
  | 'compute'
  | 'storage'
  | 'networking'
  | 'database'
  | 'genai';

export type PricingUnit =
  | 'hour'
  | 'month'
  | 'GB'
  | 'GB-month'
  | 'request'
  | '1K-tokens'
  | '1M-tokens'
  | 'vCPU-hour'
  | 'OCPU-hour';

export type Region =
  // OCI Regions
  | 'eu-frankfurt-1'
  | 'eu-amsterdam-1'
  | 'us-ashburn-1'
  | 'us-phoenix-1'
  // Azure Regions
  | 'westeurope'
  | 'northeurope'
  | 'eastus'
  | 'westus2'
  // AWS Regions
  | 'us-east-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-central-1';

/**
 * Base pricing entry
 */
export interface PricingEntry {
  id: string;
  provider: CloudProvider;
  category: ServiceCategory;
  name: string;
  displayName: string;
  description: string;
  unit: PricingUnit;
  pricePerUnit: number;
  currency: 'USD' | 'EUR';
  region: Region;
  lastUpdated: string; // ISO date
}

/**
 * Compute instance pricing
 */
export interface ComputePricing extends PricingEntry {
  category: 'compute';
  specs: {
    vcpus: number;        // vCPUs for Azure, OCPUs*2 for OCI
    ocpus?: number;       // OCI-specific
    memoryGB: number;
    gpuCount?: number;
    gpuType?: string;
    architecture: 'x86' | 'arm' | 'gpu';
    burstable?: boolean;
  };
  // Price variants
  onDemandPrice: number;
  reservedPrice1Year?: number;
  reservedPrice3Year?: number;
  spotPrice?: number;           // Azure spot
  preemptiblePrice?: number;    // OCI preemptible
}

/**
 * Storage pricing
 */
export interface StoragePricing extends PricingEntry {
  category: 'storage';
  storageType: 
    | 'block-ssd'
    | 'block-hdd'
    | 'object-standard'
    | 'object-archive'
    | 'file-standard'
    | 'file-premium';
  specs: {
    iops?: number;
    throughputMBps?: number;
    durability?: string;      // e.g., "99.999999999%"
    redundancy?: string;      // e.g., "LRS", "ZRS", "GRS"
  };
  // Additional costs
  readRequestPer10K?: number;
  writeRequestPer10K?: number;
  dataRetrievalPerGB?: number;
}

/**
 * Networking pricing
 */
export interface NetworkingPricing extends PricingEntry {
  category: 'networking';
  networkType:
    | 'egress-internet'
    | 'egress-cross-region'
    | 'egress-same-region'
    | 'load-balancer'
    | 'vpn-gateway'
    | 'nat-gateway'
    | 'fastconnect'     // OCI
    | 'expressroute';   // Azure
  specs: {
    bandwidthGbps?: number;
    includedDataGB?: number;
  };
  // Tiered pricing for egress
  tiers?: Array<{
    upToGB: number;
    pricePerGB: number;
  }>;
}

/**
 * Database pricing
 */
export interface DatabasePricing extends PricingEntry {
  category: 'database';
  databaseType:
    | 'autonomous-atp'      // OCI Autonomous Transaction Processing
    | 'autonomous-adw'      // OCI Autonomous Data Warehouse
    | 'autonomous-json'     // OCI Autonomous JSON
    | 'mysql'
    | 'postgresql'
    | 'sql-server'
    | 'cosmos-db'           // Azure
    | 'nosql';              // OCI NoSQL
  specs: {
    ocpus?: number;         // OCI
    vcpus?: number;         // Azure
    storageGB: number;
    iops?: number;
    backup?: boolean;
    ha?: boolean;           // High availability
  };
  // Storage pricing
  storagePerGBMonth?: number;
  backupPerGBMonth?: number;
}

/**
 * GenAI/LLM pricing
 */
export interface GenAIPricing extends PricingEntry {
  category: 'genai';
  modelFamily: string;        // e.g., "llama", "cohere", "gpt"
  modelName: string;          // e.g., "meta.llama-3.3-70b-instruct"
  modelType: 'chat' | 'embedding' | 'generation' | 'vision';
  specs: {
    contextWindow: number;    // Max tokens
    maxOutputTokens?: number;
    supportsStreaming: boolean;
    supportsTools?: boolean;
    supportedLanguages?: string[];
  };
  // Token pricing
  inputPricePer1KTokens: number;
  outputPricePer1KTokens: number;
  // Embedding specific
  embeddingPricePer1KTokens?: number;
  embeddingDimensions?: number;
}

/**
 * Workload requirements for AI recommendations
 */
export interface WorkloadRequirements {
  // Compute requirements
  compute?: {
    vcpusMin?: number;
    vcpusMax?: number;
    memoryGBMin?: number;
    memoryGBMax?: number;
    gpuRequired?: boolean;
    gpuType?: string;
    architecture?: 'x86' | 'arm' | 'any';
    burstable?: boolean;
    hoursPerMonth?: number;   // For cost estimation
  };
  
  // Storage requirements
  storage?: {
    sizeGB: number;
    type?: 'ssd' | 'hdd' | 'object' | 'archive';
    iopsRequired?: number;
    throughputMBps?: number;
  };
  
  // Database requirements
  database?: {
    type?: 'relational' | 'nosql' | 'graph' | 'vector';
    sizeGB: number;
    queriesPerSecond?: number;
    ha?: boolean;
    backup?: boolean;
  };
  
  // GenAI requirements
  genai?: {
    modelType: 'chat' | 'embedding' | 'generation';
    estimatedTokensPerMonth?: number;
    contextWindowNeeded?: number;
    streaming?: boolean;
    toolCalling?: boolean;
  };
  
  // Network requirements
  networking?: {
    egressGBPerMonth?: number;
    crossRegion?: boolean;
    dedicatedConnection?: boolean;
  };
  
  // Constraints
  constraints?: {
    preferredProvider?: CloudProvider;
    regions?: Region[];
    maxBudgetPerMonth?: number;
    compliance?: ('hipaa' | 'gdpr' | 'soc2' | 'pci-dss')[];
    dataResidency?: string[];  // Country codes
  };
}

/**
 * Cost estimate result
 */
export interface CostEstimate {
  provider: CloudProvider;
  region: Region;
  
  // Itemized costs
  breakdown: {
    category: ServiceCategory;
    service: string;
    description: string;
    quantity: number;
    unit: PricingUnit;
    unitPrice: number;
    monthlyCost: number;
  }[];
  
  // Totals
  monthlyTotal: number;
  annualTotal: number;
  
  // Savings options
  reservedSavings1Year?: number;
  reservedSavings3Year?: number;
  spotSavings?: number;
  
  // Confidence and notes
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
  lastUpdated: string;
}

/**
 * Multi-cloud comparison result
 */
export interface CloudComparison {
  requirements: WorkloadRequirements;
  estimates: {
    oci: CostEstimate | null;
    azure: CostEstimate | null;
    aws: CostEstimate | null;
  };
  recommendation: {
    provider: CloudProvider;
    reasoning: string[];
    costSavingsPercent: number;
    tradeoffs: string[];
  };
  generatedAt: string;
}

/**
 * Pricing data source metadata
 */
export interface PricingMetadata {
  provider: CloudProvider;
  lastUpdated: string;
  source: 'static' | 'api';
  version: string;
  regions: Region[];
  categories: ServiceCategory[];
}
