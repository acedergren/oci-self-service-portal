/**
 * Cloud Pricing Service Tests (TDD)
 * 
 * Tests for multi-cloud pricing comparison using:
 * - OCI: oci-pricing-mcp (TypeScript, npm)
 * - Azure: Azure Retail Prices API (public, no auth)
 * - AWS: awslabs.aws-pricing-mcp-server (requires AWS auth)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Types we expect to implement
import type {
  CloudProvider,
  WorkloadRequirements,
  CostEstimate,
  CloudComparison,
} from '$lib/pricing/types.js';

// Service we're going to implement (doesn't exist yet - TDD!)
// These imports will fail until we implement the module
import {
  OCIPricingClient,
  AzurePricingClient,
  CloudPricingService,
  type OCIComputePrice,
  type OCIStoragePrice,
  type AzureRetailPrice,
  type PricingResult,
} from '$lib/pricing/cloud-pricing-service.js';

describe('OCIPricingClient', () => {
  let client: OCIPricingClient;

  beforeEach(() => {
    client = new OCIPricingClient();
  });

  describe('getComputePricing', () => {
    it('returns compute shape pricing for a given shape name', async () => {
      const result = await client.getComputePricing('VM.Standard.E5.Flex');
      
      expect(result).not.toBeNull();
      expect(result!.shapeName).toBe('VM.Standard.E5.Flex');
      expect(result!.ocpuPricePerHour).toBeGreaterThan(0);
      expect(result!.memoryGBPricePerHour).toBeGreaterThan(0);
      expect(result!.currency).toBe('USD');
    });

    it('returns ARM pricing for A1.Flex shape', async () => {
      const result = await client.getComputePricing('VM.Standard.A1.Flex');
      
      expect(result).not.toBeNull();
      expect(result!.shapeName).toBe('VM.Standard.A1.Flex');
      expect(result!.architecture).toBe('arm');
      // ARM is typically cheaper
      expect(result!.ocpuPricePerHour).toBeLessThan(0.03);
    });

    it('returns GPU pricing for GPU shapes', async () => {
      const result = await client.getComputePricing('VM.GPU.A10.1');
      
      expect(result).not.toBeNull();
      expect(result!.architecture).toBe('gpu');
      expect(result!.gpuCount).toBeGreaterThan(0);
      expect(result!.gpuType).toBeDefined();
    });

    it('returns null for unknown shape', async () => {
      const result = await client.getComputePricing('VM.NonExistent.Shape');
      
      expect(result).toBeNull();
    });
  });

  describe('listComputeShapes', () => {
    it('lists all available compute shapes', async () => {
      const shapes = await client.listComputeShapes();
      
      expect(shapes).toBeInstanceOf(Array);
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.some(s => s.shapeName.includes('E5.Flex'))).toBe(true);
      expect(shapes.some(s => s.shapeName.includes('A1.Flex'))).toBe(true);
    });

    it('filters by architecture', async () => {
      const armShapes = await client.listComputeShapes({ architecture: 'arm' });
      
      expect(armShapes).toBeInstanceOf(Array);
      expect(armShapes.every(s => s.architecture === 'arm')).toBe(true);
    });
  });

  describe('calculateMonthlyCost', () => {
    it('calculates monthly cost for flex shape', async () => {
      const cost = await client.calculateMonthlyCost({
        shapeName: 'VM.Standard.E5.Flex',
        ocpus: 4,
        memoryGB: 32,
        hoursPerMonth: 730,
      });
      
      expect(cost).toBeDefined();
      expect(cost.monthlyCost).toBeGreaterThan(0);
      expect(cost.breakdown.ocpuCost).toBeGreaterThan(0);
      expect(cost.breakdown.memoryCost).toBeGreaterThan(0);
      expect(cost.currency).toBe('USD');
    });

    it('applies preemptible discount when requested', async () => {
      const standardCost = await client.calculateMonthlyCost({
        shapeName: 'VM.Standard.E5.Flex',
        ocpus: 4,
        memoryGB: 32,
        hoursPerMonth: 730,
        preemptible: false,
      });

      const preemptibleCost = await client.calculateMonthlyCost({
        shapeName: 'VM.Standard.E5.Flex',
        ocpus: 4,
        memoryGB: 32,
        hoursPerMonth: 730,
        preemptible: true,
      });

      expect(preemptibleCost.monthlyCost).toBeLessThan(standardCost.monthlyCost);
    });
  });

  describe('getStoragePricing', () => {
    it('returns block storage pricing', async () => {
      const result = await client.getStoragePricing('block-ssd');
      
      expect(result).not.toBeNull();
      expect(result!.storageType).toBe('block-ssd');
      expect(result!.pricePerGBMonth).toBeGreaterThan(0);
    });

    it('returns object storage pricing', async () => {
      const result = await client.getStoragePricing('object-standard');
      
      expect(result).not.toBeNull();
      expect(result!.storageType).toBe('object-standard');
      expect(result!.pricePerGBMonth).toBeGreaterThan(0);
    });
  });

  describe('getFreeTier', () => {
    it('returns OCI Always Free tier details', async () => {
      const freeTier = await client.getFreeTier();
      
      expect(freeTier).toBeDefined();
      expect(freeTier.compute.armOcpus).toBe(4);
      expect(freeTier.compute.memoryGB).toBe(24);
      expect(freeTier.storage.blockStorageGB).toBe(200);
      expect(freeTier.database.autonomousDBs).toBe(2);
      expect(freeTier.networking.egressTBFree).toBe(10);
    });
  });
});

describe('AzurePricingClient', () => {
  let client: AzurePricingClient;

  beforeEach(() => {
    client = new AzurePricingClient();
  });

  describe('searchPricing', () => {
    it('searches VM pricing by service name', async () => {
      const results = await client.searchPricing({
        serviceName: 'Virtual Machines',
        armRegionName: 'westeurope',
      });
      
      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].serviceName).toBe('Virtual Machines');
    });

    it('filters by SKU name', async () => {
      const results = await client.searchPricing({
        serviceName: 'Virtual Machines',
        armSkuName: 'Standard_D2s_v3',
        armRegionName: 'westeurope',
      });
      
      expect(results).toBeInstanceOf(Array);
      expect(results.every(r => r.armSkuName === 'Standard_D2s_v3')).toBe(true);
    });

    it('returns empty array for no matches', async () => {
      const results = await client.searchPricing({
        serviceName: 'NonExistentService',
      });
      
      expect(results).toEqual([]);
    });
  });

  describe('getVMPricing', () => {
    it('returns pricing for a specific VM SKU', async () => {
      const pricing = await client.getVMPricing('Standard_D2s_v3', 'westeurope');
      
      expect(pricing).toBeDefined();
      expect(pricing!.armSkuName).toBe('Standard_D2s_v3');
      expect(pricing!.retailPrice).toBeGreaterThan(0);
      expect(pricing!.unitOfMeasure).toBe('1 Hour');
    });

    it('returns null for unknown SKU', async () => {
      const pricing = await client.getVMPricing('NonExistent_SKU', 'westeurope');
      
      expect(pricing).toBeNull();
    });
  });

  describe('calculateMonthlyCost', () => {
    it('calculates monthly cost for a VM', async () => {
      const cost = await client.calculateMonthlyCost({
        skuName: 'Standard_D2s_v3',
        region: 'westeurope',
        hoursPerMonth: 730,
      });
      
      expect(cost).toBeDefined();
      expect(cost.monthlyCost).toBeGreaterThan(0);
      expect(cost.hourlyRate).toBeGreaterThan(0);
      expect(cost.currency).toBe('USD');
    });
  });

  describe('compareRegions', () => {
    it('compares pricing across multiple regions', async () => {
      const comparison = await client.compareRegions({
        serviceName: 'Virtual Machines',
        skuName: 'Standard_D2s_v3',
        regions: ['westeurope', 'eastus', 'westus2'],
      });
      
      expect(comparison).toBeInstanceOf(Array);
      expect(comparison.length).toBe(3);
      expect(comparison.every(c => c.skuName === 'Standard_D2s_v3')).toBe(true);
      // Each region should have pricing
      expect(comparison.every(c => c.retailPrice !== undefined)).toBe(true);
    });
  });
});

describe('CloudPricingService', () => {
  let service: CloudPricingService;

  beforeEach(() => {
    service = new CloudPricingService();
  });

  describe('compareCloudCosts', () => {
    it('compares OCI vs Azure for compute workload', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 4,
          memoryGBMin: 16,
          architecture: 'x86',
          hoursPerMonth: 730,
        },
      };

      const comparison = await service.compareCloudCosts(requirements);

      expect(comparison).toBeDefined();
      expect(comparison.requirements).toEqual(requirements);
      expect(comparison.estimates.oci).not.toBeNull();
      expect(comparison.estimates.azure).not.toBeNull();
      expect(comparison.recommendation.provider).toMatch(/^(oci|azure)$/);
      expect(comparison.recommendation.reasoning.length).toBeGreaterThan(0);
    });

    it('recommends OCI for ARM workloads due to better pricing', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 4,
          memoryGBMin: 16,
          architecture: 'arm',
          hoursPerMonth: 730,
        },
      };

      const comparison = await service.compareCloudCosts(requirements);

      // OCI A1.Flex is typically cheaper than Azure ARM VMs
      expect(comparison.recommendation.provider).toBe('oci');
      expect(comparison.recommendation.costSavingsPercent).toBeGreaterThan(0);
    });

    it('includes storage costs when storage requirements provided', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 2,
          memoryGBMin: 8,
          hoursPerMonth: 730,
        },
        storage: {
          sizeGB: 500,
          type: 'ssd',
        },
      };

      const comparison = await service.compareCloudCosts(requirements);

      expect(comparison.estimates.oci?.breakdown.some(b => b.category === 'storage')).toBe(true);
      expect(comparison.estimates.azure?.breakdown.some(b => b.category === 'storage')).toBe(true);
    });

    it('factors in free tier for OCI', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 2, // Within always-free ARM allocation
          memoryGBMin: 8,
          architecture: 'arm',
          hoursPerMonth: 730,
        },
      };

      const comparison = await service.compareCloudCosts(requirements);

      // Should note OCI free tier eligibility
      expect(comparison.estimates.oci?.notes.some(n => 
        n.toLowerCase().includes('free tier') || n.toLowerCase().includes('always free')
      )).toBe(true);
    });

    it('handles data egress comparison', async () => {
      const requirements: WorkloadRequirements = {
        networking: {
          egressGBPerMonth: 5000, // 5TB
        },
      };

      const comparison = await service.compareCloudCosts(requirements);

      // OCI has 10TB free egress, Azure charges per GB
      expect(comparison.estimates.oci!.monthlyTotal).toBeLessThan(
        comparison.estimates.azure!.monthlyTotal
      );
      expect(comparison.recommendation.provider).toBe('oci');
    });
  });

  describe('estimateCost', () => {
    it('estimates cost for OCI only', async () => {
      const estimate = await service.estimateCost({
        provider: 'oci',
        compute: {
          vcpusMin: 4,
          memoryGBMin: 32,
          hoursPerMonth: 730,
        },
      });

      expect(estimate).toBeDefined();
      expect(estimate.provider).toBe('oci');
      expect(estimate.monthlyTotal).toBeGreaterThan(0);
    });

    it('estimates cost for Azure only', async () => {
      const estimate = await service.estimateCost({
        provider: 'azure',
        compute: {
          vcpusMin: 4,
          memoryGBMin: 32,
          hoursPerMonth: 730,
        },
      });

      expect(estimate).toBeDefined();
      expect(estimate.provider).toBe('azure');
      expect(estimate.monthlyTotal).toBeGreaterThan(0);
    });
  });

  describe('getRecommendation', () => {
    it('provides recommendation with reasoning', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 8,
          memoryGBMin: 64,
          gpuRequired: true,
        },
        constraints: {
          maxBudgetPerMonth: 500,
        },
      };

      const recommendation = await service.getRecommendation(requirements);

      expect(recommendation).toBeDefined();
      expect(recommendation.provider).toMatch(/^(oci|azure)$/);
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
      expect(recommendation.tradeoffs.length).toBeGreaterThan(0);
    });

    it('respects provider preference constraint', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 4,
          memoryGBMin: 16,
        },
        constraints: {
          preferredProvider: 'oci',
        },
      };

      const recommendation = await service.getRecommendation(requirements);

      // Should still recommend OCI even if Azure is cheaper
      expect(recommendation.provider).toBe('oci');
      expect(recommendation.reasoning.some(r => 
        r.toLowerCase().includes('preferred') || r.toLowerCase().includes('preference')
      )).toBe(true);
    });

    it('respects budget constraint', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 16,
          memoryGBMin: 128,
        },
        constraints: {
          maxBudgetPerMonth: 100, // Very low budget
        },
      };

      const recommendation = await service.getRecommendation(requirements);

      // Should note budget constraint issues
      expect(recommendation.reasoning.some(r => 
        r.toLowerCase().includes('budget') || r.toLowerCase().includes('exceed')
      )).toBe(true);
    });
  });

  describe('formatAsMarkdown', () => {
    it('formats comparison as readable markdown', async () => {
      const requirements: WorkloadRequirements = {
        compute: {
          vcpusMin: 4,
          memoryGBMin: 16,
          hoursPerMonth: 730,
        },
      };

      const comparison = await service.compareCloudCosts(requirements);
      const markdown = service.formatAsMarkdown(comparison);

      expect(markdown).toContain('## Cloud Cost Comparison');
      expect(markdown).toContain('OCI');
      expect(markdown).toContain('Azure');
      expect(markdown).toContain('$'); // Should contain prices
      expect(markdown).toContain('Recommendation');
    });
  });
});

describe('Integration: Real API Calls', () => {
  // These tests make real API calls - mark as integration tests
  // They verify the actual MCP/API integration works
  
  it.skip('fetches real OCI pricing via MCP client', async () => {
    const client = new OCIPricingClient();
    const shapes = await client.listComputeShapes();
    
    // Real data validation
    expect(shapes.length).toBeGreaterThan(10);
    const e5Flex = shapes.find(s => s.shapeName === 'VM.Standard.E5.Flex');
    expect(e5Flex).toBeDefined();
    expect(e5Flex!.ocpuPricePerHour).toBeCloseTo(0.03, 2);
  });

  it.skip('fetches real Azure pricing via REST API', async () => {
    const client = new AzurePricingClient();
    const results = await client.searchPricing({
      serviceName: 'Virtual Machines',
      armRegionName: 'westeurope',
    });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].currencyCode).toBe('USD');
  });
});
