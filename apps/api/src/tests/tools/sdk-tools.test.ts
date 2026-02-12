import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock boundaries ─────────────────────────────────────────────────────
// Mock the executor-sdk functions that the migrated tools use.
// This tests the tool implementations in isolation without actual SDK calls.

const mockExecuteOCISDK = vi.fn();
const mockNormalizeSDKResponse = vi.fn();
const mockExecuteAndSlim = vi.fn();
const mockRequireCompartmentId = vi.fn();
const mockGetDefaultCompartmentId = vi.fn();
const mockSlimOCIResponse = vi.fn();
const mockToMidnightUTC = vi.fn();

vi.mock('@portal/shared/tools/executor-sdk', () => ({
	executeOCISDK: (...args: unknown[]) => mockExecuteOCISDK(...args),
	normalizeSDKResponse: (...args: unknown[]) => mockNormalizeSDKResponse(...args),
	executeAndSlim: (...args: unknown[]) => mockExecuteAndSlim(...args),
	requireCompartmentId: (...args: unknown[]) => mockRequireCompartmentId(...args),
	getDefaultCompartmentId: () => mockGetDefaultCompartmentId(),
	slimOCIResponse: (...args: unknown[]) => mockSlimOCIResponse(...args)
}));

vi.mock('@portal/shared/tools/executor', () => ({
	toMidnightUTC: (...args: unknown[]) => mockToMidnightUTC(...args)
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// Import the tool arrays AFTER mocks are set up
import { observabilityTools } from '@portal/shared/tools/categories/observability';
import { loggingTools } from '@portal/shared/tools/categories/logging';
import { billingTools } from '@portal/shared/tools/categories/billing';
import { searchTools } from '@portal/shared/tools/categories/search';
import { storageTools } from '@portal/shared/tools/categories/storage';

describe('SDK-migrated tools', () => {
	beforeEach(() => {
		// Reset mocks and set default return values
		mockExecuteOCISDK.mockResolvedValue({ items: [] });
		mockNormalizeSDKResponse.mockReturnValue({ data: [] });
		mockExecuteAndSlim.mockResolvedValue({ data: [] });
		mockRequireCompartmentId.mockReturnValue('test-compartment-id');
		mockGetDefaultCompartmentId.mockReturnValue('test-compartment-id');
		mockSlimOCIResponse.mockImplementation((data: unknown) => data);
		mockToMidnightUTC.mockImplementation((date: Date) => date.toISOString());
	});

	// ── Observability Tools ─────────────────────────────────────────────

	describe('observability tools', () => {
		it('listAlarms calls executeAndSlim with monitoring.listAlarms and correct pick fields', async () => {
			const listAlarmsTool = observabilityTools.find((t) => t.name === 'listAlarms');
			expect(listAlarmsTool).toBeDefined();

			mockExecuteAndSlim.mockResolvedValue({
				data: [{ 'display-name': 'high-cpu-alarm', id: 'ocid1.alarm.1' }]
			});

			await listAlarmsTool!.executeAsync({ compartmentId: 'test-compartment' });

			expect(mockRequireCompartmentId).toHaveBeenCalledWith({ compartmentId: 'test-compartment' });
			expect(mockExecuteAndSlim).toHaveBeenCalledWith(
				'monitoring',
				'listAlarms',
				{ compartmentId: 'test-compartment-id' },
				[
					'display-name',
					'id',
					'severity',
					'lifecycle-state',
					'metric-compartment-id',
					'namespace',
					'query',
					'is-enabled',
					'time-created'
				]
			);
		});

		it('listAlarms passes displayName filter when provided', async () => {
			const listAlarmsTool = observabilityTools.find((t) => t.name === 'listAlarms');

			await listAlarmsTool!.executeAsync({
				compartmentId: 'test-compartment',
				displayName: 'cpu-alarm'
			});

			expect(mockExecuteAndSlim).toHaveBeenCalledWith(
				'monitoring',
				'listAlarms',
				{ compartmentId: 'test-compartment-id', displayName: 'cpu-alarm' },
				expect.any(Array)
			);
		});

		it('summarizeMetrics calls executeOCISDK with monitoring.summarizeMetricsData', async () => {
			const summarizeMetricsTool = observabilityTools.find((t) => t.name === 'summarizeMetrics');
			expect(summarizeMetricsTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await summarizeMetricsTool!.executeAsync({
				compartmentId: 'test-compartment',
				namespace: 'oci_computeagent',
				query: 'CpuUtilization[1h].mean()',
				startTime: '2026-01-01T00:00:00Z',
				endTime: '2026-01-01T01:00:00Z'
			});

			expect(mockRequireCompartmentId).toHaveBeenCalled();
			expect(mockExecuteOCISDK).toHaveBeenCalledWith(
				'monitoring',
				'summarizeMetricsData',
				expect.objectContaining({
					compartmentId: 'test-compartment-id',
					summarizeMetricsDataDetails: expect.objectContaining({
						namespace: 'oci_computeagent',
						query: 'CpuUtilization[1h].mean()',
						startTime: expect.any(Date),
						endTime: expect.any(Date)
					})
				})
			);
			expect(mockNormalizeSDKResponse).toHaveBeenCalled();
		});

		it('summarizeMetrics uses default time range when not provided', async () => {
			const summarizeMetricsTool = observabilityTools.find((t) => t.name === 'summarizeMetrics');

			await summarizeMetricsTool!.executeAsync({
				compartmentId: 'test-compartment',
				namespace: 'oci_computeagent',
				query: 'CpuUtilization[1h].mean()'
			});

			// Should call with defaults (3 hours ago to now)
			expect(mockExecuteOCISDK).toHaveBeenCalledWith(
				'monitoring',
				'summarizeMetricsData',
				expect.objectContaining({
					summarizeMetricsDataDetails: expect.objectContaining({
						startTime: expect.any(Date),
						endTime: expect.any(Date)
					})
				})
			);
		});

		it('getComputeMetrics builds MQL query and calls monitoring.summarizeMetricsData', async () => {
			const getComputeMetricsTool = observabilityTools.find(
				(t) => t.name === 'getComputeMetrics'
			);
			expect(getComputeMetricsTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			const result = await getComputeMetricsTool!.executeAsync({
				compartmentId: 'test-compartment',
				metricName: 'CpuUtilization',
				period: '24h',
				aggregation: 'mean'
			});

			expect(mockExecuteOCISDK).toHaveBeenCalledWith(
				'monitoring',
				'summarizeMetricsData',
				expect.objectContaining({
					compartmentId: 'test-compartment-id',
					summarizeMetricsDataDetails: expect.objectContaining({
						namespace: 'oci_computeagent',
						query: expect.stringContaining('CpuUtilization'),
						startTime: expect.any(Date),
						endTime: expect.any(Date)
					})
				})
			);

			// Verify the result structure includes metadata
			expect(result).toMatchObject({
				metricName: 'CpuUtilization',
				period: '24h',
				aggregation: 'mean',
				namespace: 'oci_computeagent',
				query: expect.any(String),
				timeRange: expect.any(Object),
				data: expect.any(Object)
			});
		});

		it('getComputeMetrics adds resourceId filter when instanceId provided', async () => {
			const getComputeMetricsTool = observabilityTools.find(
				(t) => t.name === 'getComputeMetrics'
			);

			await getComputeMetricsTool!.executeAsync({
				compartmentId: 'test-compartment',
				metricName: 'CpuUtilization',
				period: '1h',
				instanceId: 'ocid1.instance.test'
			});

			const call = mockExecuteOCISDK.mock.calls[0];
			const query = call[2].summarizeMetricsDataDetails.query;
			expect(query).toContain('resourceId = "ocid1.instance.test"');
		});

		it('listMetricNamespaces calls monitoring.listMetrics with groupBy namespace', async () => {
			const listMetricNamespacesTool = observabilityTools.find(
				(t) => t.name === 'listMetricNamespaces'
			);
			expect(listMetricNamespacesTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await listMetricNamespacesTool!.executeAsync({ compartmentId: 'test-compartment' });

			expect(mockExecuteOCISDK).toHaveBeenCalledWith('monitoring', 'listMetrics', {
				compartmentId: 'test-compartment-id',
				listMetricsDetails: {
					groupBy: ['namespace']
				}
			});
			expect(mockNormalizeSDKResponse).toHaveBeenCalled();
		});
	});

	// ── Logging Tools ───────────────────────────────────────────────────

	describe('logging tools', () => {
		it('searchLogs calls executeOCISDK with logSearch.searchLogs', async () => {
			const searchLogsTool = loggingTools.find((t) => t.name === 'searchLogs');
			expect(searchLogsTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await searchLogsTool!.executeAsync({
				compartmentId: 'test-compartment',
				query: 'error',
				period: '24h',
				limit: 100
			});

			expect(mockRequireCompartmentId).toHaveBeenCalled();
			expect(mockExecuteOCISDK).toHaveBeenCalledWith('logSearch', 'searchLogs', {
				searchLogsDetails: {
					searchQuery: expect.stringContaining('test-compartment-id'),
					timeStart: expect.any(Date),
					timeEnd: expect.any(Date),
					isReturnFieldInfo: false
				},
				limit: 100
			});
		});

		it('searchLogs uses correct time range based on period', async () => {
			const searchLogsTool = loggingTools.find((t) => t.name === 'searchLogs');

			await searchLogsTool!.executeAsync({
				compartmentId: 'test-compartment',
				query: 'error',
				period: '1h'
			});

			const call = mockExecuteOCISDK.mock.calls[0];
			const timeStart = call[2].searchLogsDetails.timeStart as Date;
			const timeEnd = call[2].searchLogsDetails.timeEnd as Date;
			const hoursDiff = (timeEnd.getTime() - timeStart.getTime()) / (1000 * 60 * 60);

			expect(hoursDiff).toBeCloseTo(1, 0);
		});
	});

	// ── Billing Tools ───────────────────────────────────────────────────

	describe('billing tools', () => {
		it('getUsageCost calls identity.getCompartment then usageApi.requestSummarizedUsages', async () => {
			const getUsageCostTool = billingTools.find((t) => t.name === 'getUsageCost');
			expect(getUsageCostTool).toBeDefined();

			// First call: getCompartment
			// Second call: requestSummarizedUsages
			let callCount = 0;
			mockExecuteOCISDK.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return { compartment: { compartmentId: 'ocid1.tenancy.test' } };
				}
				return { items: [] };
			});

			mockNormalizeSDKResponse.mockReturnValue({ data: [] });
			mockToMidnightUTC.mockImplementation((date: Date) => date.toISOString());

			await getUsageCostTool!.executeAsync({
				compartmentId: 'test-compartment',
				period: 'last30days',
				groupBy: 'service',
				granularity: 'MONTHLY'
			});

			expect(mockExecuteOCISDK).toHaveBeenNthCalledWith(1, 'identity', 'getCompartment', {
				compartmentId: 'test-compartment-id'
			});

			expect(mockExecuteOCISDK).toHaveBeenNthCalledWith(
				2,
				'usageApi',
				'requestSummarizedUsages',
				expect.objectContaining({
					requestSummarizedUsagesDetails: expect.objectContaining({
						tenantId: 'ocid1.tenancy.test',
						granularity: 'MONTHLY',
						groupBy: ['service']
					})
				})
			);
		});

		it('getUsageCost uses fallback tenancyId if getCompartment fails', async () => {
			const getUsageCostTool = billingTools.find((t) => t.name === 'getUsageCost');

			let callCount = 0;
			mockExecuteOCISDK.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					throw new Error('Compartment not found');
				}
				return { items: [] };
			});

			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await getUsageCostTool!.executeAsync({
				compartmentId: 'test-compartment',
				period: 'last7days'
			});

			// Should use compartmentId as tenancyId fallback
			expect(mockExecuteOCISDK).toHaveBeenNthCalledWith(
				2,
				'usageApi',
				'requestSummarizedUsages',
				expect.objectContaining({
					requestSummarizedUsagesDetails: expect.objectContaining({
						tenantId: 'test-compartment-id'
					})
				})
			);
		});
	});

	// ── Search Tools ────────────────────────────────────────────────────

	describe('search tools', () => {
		it('searchResources calls resourceSearch.searchResources with structured query', async () => {
			const searchResourcesTool = searchTools.find((t) => t.name === 'searchResources');
			expect(searchResourcesTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await searchResourcesTool!.executeAsync({
				queryText: "query instance resources where lifeCycleState = 'RUNNING'",
				limit: 50
			});

			expect(mockExecuteOCISDK).toHaveBeenCalledWith('resourceSearch', 'searchResources', {
				searchDetails: {
					type: 'Structured',
					query: "query instance resources where lifeCycleState = 'RUNNING'",
					matchingContextType: 'NONE'
				},
				limit: 50
			});
			expect(mockNormalizeSDKResponse).toHaveBeenCalled();
		});

		it('searchResourcesByName builds query and calls resourceSearch.searchResources', async () => {
			const searchResourcesByNameTool = searchTools.find(
				(t) => t.name === 'searchResourcesByName'
			);
			expect(searchResourcesByNameTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await searchResourcesByNameTool!.executeAsync({
				displayName: 'web-server',
				resourceType: 'instance'
			});

			expect(mockExecuteOCISDK).toHaveBeenCalledWith('resourceSearch', 'searchResources', {
				searchDetails: {
					type: 'Structured',
					query: "query instance resources where displayName = 'web-server'",
					matchingContextType: 'NONE'
				},
				limit: 50
			});
		});

		it('searchResourcesByName queries all resources when resourceType not provided', async () => {
			const searchResourcesByNameTool = searchTools.find(
				(t) => t.name === 'searchResourcesByName'
			);

			await searchResourcesByNameTool!.executeAsync({
				displayName: 'test-resource'
			});

			const call = mockExecuteOCISDK.mock.calls[0];
			expect(call[2].searchDetails.query).toContain('all resources');
		});
	});

	// ── Container Registry Tools (storage) ─────────────────────────────

	describe('container registry tools', () => {
		it('listContainerRepos calls artifacts.listContainerRepositories', async () => {
			const listContainerReposTool = storageTools.find((t) => t.name === 'listContainerRepos');
			expect(listContainerReposTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await listContainerReposTool!.executeAsync({ compartmentId: 'test-compartment' });

			expect(mockRequireCompartmentId).toHaveBeenCalled();
			expect(mockExecuteOCISDK).toHaveBeenCalledWith('artifacts', 'listContainerRepositories', {
				compartmentId: 'test-compartment-id'
			});
			expect(mockNormalizeSDKResponse).toHaveBeenCalled();
		});

		it('listContainerImages calls artifacts.listContainerImages', async () => {
			const listContainerImagesTool = storageTools.find((t) => t.name === 'listContainerImages');
			expect(listContainerImagesTool).toBeDefined();

			mockExecuteOCISDK.mockResolvedValue({ items: [] });
			mockNormalizeSDKResponse.mockReturnValue({ data: [] });

			await listContainerImagesTool!.executeAsync({ compartmentId: 'test-compartment' });

			expect(mockRequireCompartmentId).toHaveBeenCalled();
			expect(mockExecuteOCISDK).toHaveBeenCalledWith('artifacts', 'listContainerImages', {
				compartmentId: 'test-compartment-id'
			});
			expect(mockNormalizeSDKResponse).toHaveBeenCalled();
		});

		it('listContainerImages passes optional filters when provided', async () => {
			const listContainerImagesTool = storageTools.find((t) => t.name === 'listContainerImages');

			await listContainerImagesTool!.executeAsync({
				compartmentId: 'test-compartment',
				repositoryName: 'my-app',
				imageVersion: 'v1.0.0'
			});

			expect(mockExecuteOCISDK).toHaveBeenCalledWith('artifacts', 'listContainerImages', {
				compartmentId: 'test-compartment-id',
				repositoryName: 'my-app',
				displayName: 'v1.0.0'
			});
		});
	});
});
