/**
 * Phase 6 TDD: Prometheus Metrics Endpoint
 *
 * Exposes application metrics at /api/metrics in Prometheus text format.
 *
 * Expected module: $lib/server/metrics.ts
 * Expected exports:
 *   - metricsCollector: MetricsCollector
 *   - MetricsCollector class with:
 *     - incrementCounter(name, labels?): void
 *     - observeHistogram(name, value, labels?): void
 *     - setGauge(name, value, labels?): void
 *     - serialize(): string  (Prometheus exposition format)
 *     - reset(): void
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let metricsModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		metricsModule = await import('$lib/server/metrics.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Prometheus Metrics (Phase 6.5-6.6)', () => {
	describe('module availability', () => {
		it('metrics module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`metrics module not yet available: ${moduleError}. ` +
					'Implement $lib/server/metrics.ts per Phase 6.5.'
				);
			}
			expect(metricsModule).not.toBeNull();
		});
	});

	describe('MetricsCollector', () => {
		it('exports a metricsCollector singleton', () => {
			if (!metricsModule) return;
			expect(metricsModule.metricsCollector).toBeDefined();
		});

		it('incrementCounter increments a counter metric', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				incrementCounter: (name: string, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.incrementCounter('http_requests_total', { method: 'GET', path: '/api/health' });
			collector.incrementCounter('http_requests_total', { method: 'GET', path: '/api/health' });

			const output = collector.serialize();
			expect(output).toContain('http_requests_total');
			expect(output).toContain('method="GET"');
			// Value should be 2
			expect(output).toMatch(/http_requests_total\{.*\}\s+2/);
		});

		it('observeHistogram records a histogram observation', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				observeHistogram: (name: string, value: number, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.observeHistogram('http_request_duration_seconds', 0.25, { path: '/api/chat' });
			collector.observeHistogram('http_request_duration_seconds', 1.5, { path: '/api/chat' });

			const output = collector.serialize();
			expect(output).toContain('http_request_duration_seconds');
			// Should include _count and _sum
			expect(output).toContain('_count');
			expect(output).toContain('_sum');
		});

		it('setGauge sets a gauge to a specific value', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				setGauge: (name: string, value: number, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.setGauge('db_pool_connections_open', 5);
			collector.setGauge('db_pool_connections_open', 3);

			const output = collector.serialize();
			expect(output).toContain('db_pool_connections_open');
			// Gauge should show latest value (3), not accumulated
			expect(output).toMatch(/db_pool_connections_open\s+3/);
		});

		it('serialize returns valid Prometheus text format', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				incrementCounter: (name: string, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.incrementCounter('test_counter');

			const output = collector.serialize();
			// Prometheus format: lines starting with # are comments, others are metrics
			const lines = output.split('\n').filter(Boolean);
			for (const line of lines) {
				expect(line.startsWith('#') || line.match(/^\w+/)).toBeTruthy();
			}
		});

		it('reset clears all metrics', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				incrementCounter: (name: string) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.incrementCounter('test_counter');
			collector.reset();
			const output = collector.serialize();
			expect(output).not.toContain('test_counter');
		});
	});

	describe('built-in metrics', () => {
		it('should track tool executions', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				incrementCounter: (name: string, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.incrementCounter('tool_executions_total', {
				tool: 'listInstances',
				category: 'compute',
				success: 'true',
			});

			const output = collector.serialize();
			expect(output).toContain('tool_executions_total');
			expect(output).toContain('tool="listInstances"');
		});

		it('should track chat request duration', () => {
			if (!metricsModule) return;
			const collector = metricsModule.metricsCollector as {
				observeHistogram: (name: string, value: number, labels?: Record<string, string>) => void;
				serialize: () => string;
				reset: () => void;
			};

			collector.reset();
			collector.observeHistogram('chat_request_duration_seconds', 2.5, {
				model: 'meta.llama-3.3-70b-instruct',
			});

			const output = collector.serialize();
			expect(output).toContain('chat_request_duration_seconds');
		});
	});
});
