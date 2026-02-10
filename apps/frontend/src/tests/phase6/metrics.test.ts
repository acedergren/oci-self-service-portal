/**
 * Phase 6 TDD: Prometheus Metrics
 *
 * Tests Counter, Gauge, Histogram types and the MetricsRegistry that
 * serializes to Prometheus text exposition format.
 *
 * Module: $lib/server/metrics.ts
 * Exports:
 *   - Counter, Gauge, Histogram, MetricsRegistry (classes)
 *   - registry (singleton)
 *   - Predefined metrics: chatRequests, toolExecutions, toolDuration,
 *     activeSessions, pendingApprovals, dbPoolActive, dbPoolIdle,
 *     authLogins, httpRequestDuration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	Counter,
	Gauge,
	Histogram,
	MetricsRegistry,
	registry,
	chatRequests,
	toolExecutions,
	toolDuration,
	activeSessions,
	pendingApprovals,
	dbPoolActive,
	dbPoolIdle,
	authLogins,
	httpRequestDuration
} from '@portal/server/metrics';

describe('Prometheus Metrics (Phase 6)', () => {
	beforeEach(() => {
		registry.reset();
	});

	describe('Counter', () => {
		it('increments by 1 by default', () => {
			const counter = new Counter({ name: 'test_requests_total', help: 'Test counter' });
			counter.inc({ method: 'GET' });
			counter.inc({ method: 'GET' });

			const output = counter.collect().join('\n');
			expect(output).toContain('test_requests_total');
			expect(output).toContain('method="GET"');
			expect(output).toMatch(/test_requests_total\{.*\}\s+2/);
		});

		it('increments by custom value', () => {
			const counter = new Counter({ name: 'test_bytes_total', help: 'Bytes' });
			counter.inc({}, 100);
			counter.inc({}, 50);

			const output = counter.collect().join('\n');
			expect(output).toMatch(/test_bytes_total\s+150/);
		});

		it('tracks multiple label sets independently', () => {
			const counter = new Counter({ name: 'http_requests', help: 'Requests' });
			counter.inc({ method: 'GET', path: '/api/health' });
			counter.inc({ method: 'POST', path: '/api/chat' });
			counter.inc({ method: 'GET', path: '/api/health' });

			const output = counter.collect().join('\n');
			expect(output).toContain('method="GET"');
			expect(output).toContain('method="POST"');
		});

		it('works with no labels', () => {
			const counter = new Counter({ name: 'simple_counter', help: 'Simple' });
			counter.inc();

			const output = counter.collect().join('\n');
			expect(output).toMatch(/simple_counter\s+1/);
		});

		it('includes HELP and TYPE comments', () => {
			const counter = new Counter({ name: 'test_counter', help: 'A test counter' });
			counter.inc();

			const lines = counter.collect();
			expect(lines[0]).toBe('# HELP test_counter A test counter');
			expect(lines[1]).toBe('# TYPE test_counter counter');
		});

		it('reset clears all values', () => {
			const counter = new Counter({ name: 'test_counter', help: 'Test' });
			counter.inc({ a: '1' });
			counter.reset();

			const output = counter.collect().join('\n');
			// After reset, only HELP and TYPE lines, no data lines
			expect(output).not.toMatch(/test_counter\{/);
		});
	});

	describe('Gauge', () => {
		it('set stores the latest value', () => {
			const gauge = new Gauge({ name: 'pool_active', help: 'Active connections' });
			gauge.set({}, 5);
			gauge.set({}, 3);

			const output = gauge.collect().join('\n');
			expect(output).toMatch(/pool_active\s+3/);
		});

		it('inc and dec adjust gauge value', () => {
			const gauge = new Gauge({ name: 'active_sessions', help: 'Sessions' });
			gauge.inc();
			gauge.inc();
			gauge.dec();

			const output = gauge.collect().join('\n');
			expect(output).toMatch(/active_sessions\s+1/);
		});

		it('includes HELP and TYPE comments', () => {
			const gauge = new Gauge({ name: 'test_gauge', help: 'A test gauge' });
			gauge.set({}, 42);

			const lines = gauge.collect();
			expect(lines[0]).toBe('# HELP test_gauge A test gauge');
			expect(lines[1]).toBe('# TYPE test_gauge gauge');
		});

		it('tracks multiple label sets', () => {
			const gauge = new Gauge({ name: 'db_pool', help: 'Pool' });
			gauge.set({ state: 'active' }, 3);
			gauge.set({ state: 'idle' }, 7);

			const output = gauge.collect().join('\n');
			expect(output).toContain('state="active"');
			expect(output).toContain('state="idle"');
		});
	});

	describe('Histogram', () => {
		it('records observations with bucket boundaries', () => {
			const hist = new Histogram({
				name: 'request_duration',
				help: 'Duration in seconds',
				buckets: [0.1, 0.5, 1, 5]
			});

			hist.observe({}, 0.25);
			hist.observe({}, 0.75);
			hist.observe({}, 3.0);

			const output = hist.collect().join('\n');
			expect(output).toContain('request_duration_bucket');
			expect(output).toContain('le=');
			expect(output).toContain('+Inf');
			expect(output).toContain('request_duration_sum');
			expect(output).toContain('request_duration_count');
		});

		it('_count reflects number of observations', () => {
			const hist = new Histogram({
				name: 'test_hist',
				help: 'Test',
				buckets: [1, 5, 10]
			});
			hist.observe({}, 2);
			hist.observe({}, 7);

			const output = hist.collect().join('\n');
			expect(output).toMatch(/test_hist_count\s+2/);
		});

		it('_sum reflects total of observed values', () => {
			const hist = new Histogram({
				name: 'test_hist',
				help: 'Test',
				buckets: [1, 5, 10]
			});
			hist.observe({}, 2);
			hist.observe({}, 7);

			const output = hist.collect().join('\n');
			expect(output).toMatch(/test_hist_sum\s+9/);
		});

		it('+Inf bucket contains all observations', () => {
			const hist = new Histogram({
				name: 'test_hist',
				help: 'Test',
				buckets: [1]
			});
			hist.observe({}, 0.5);
			hist.observe({}, 100);

			const output = hist.collect().join('\n');
			expect(output).toMatch(/test_hist_bucket\{le="\+Inf"\}\s+2/);
		});

		it('startTimer records elapsed time', () => {
			const hist = new Histogram({
				name: 'op_duration',
				help: 'Op time',
				buckets: [0.001, 0.01, 0.1, 1]
			});

			const end = hist.startTimer({ op: 'test' });
			// Immediately end (sub-millisecond)
			const elapsed = end();

			expect(elapsed).toBeGreaterThanOrEqual(0);
			const output = hist.collect().join('\n');
			expect(output).toContain('op_duration_count');
		});

		it('includes HELP and TYPE comments', () => {
			const hist = new Histogram({ name: 'test_hist', help: 'A histogram' });
			hist.observe({}, 1);

			const lines = hist.collect();
			expect(lines[0]).toBe('# HELP test_hist A histogram');
			expect(lines[1]).toBe('# TYPE test_hist histogram');
		});
	});

	describe('MetricsRegistry', () => {
		it('collects all registered metrics into Prometheus format', () => {
			const reg = new MetricsRegistry();
			const counter = reg.register(new Counter({ name: 'reg_counter', help: 'Counter' }));
			const gauge = reg.register(new Gauge({ name: 'reg_gauge', help: 'Gauge' }));

			counter.inc({ a: '1' });
			gauge.set({}, 42);

			const output = reg.collect();
			expect(output).toContain('reg_counter');
			expect(output).toContain('reg_gauge');
		});

		it('collect returns Prometheus text format string', () => {
			const reg = new MetricsRegistry();
			reg.register(new Counter({ name: 'test', help: 'Test' }));

			const output = reg.collect();
			expect(typeof output).toBe('string');
			// Each line is either a comment or a metric line
			const lines = output.split('\n').filter(Boolean);
			for (const line of lines) {
				expect(line.startsWith('#') || line.match(/^\w+/)).toBeTruthy();
			}
		});

		it('has correct content type', () => {
			const reg = new MetricsRegistry();
			expect(reg.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
		});

		it('reset clears all registered metrics', () => {
			const reg = new MetricsRegistry();
			const counter = reg.register(new Counter({ name: 'test', help: 'T' }));
			counter.inc({ x: '1' });
			reg.reset();

			const output = reg.collect();
			expect(output).not.toMatch(/test\{/);
		});
	});

	describe('predefined portal metrics', () => {
		it('chatRequests is a Counter named portal_chat_requests_total', () => {
			expect(chatRequests).toBeInstanceOf(Counter);
			expect(chatRequests.name).toBe('portal_chat_requests_total');
		});

		it('toolExecutions is a Counter named portal_tool_executions_total', () => {
			expect(toolExecutions).toBeInstanceOf(Counter);
			expect(toolExecutions.name).toBe('portal_tool_executions_total');
		});

		it('toolDuration is a Histogram named portal_tool_duration_seconds', () => {
			expect(toolDuration).toBeInstanceOf(Histogram);
			expect(toolDuration.name).toBe('portal_tool_duration_seconds');
		});

		it('activeSessions is a Gauge named portal_active_sessions', () => {
			expect(activeSessions).toBeInstanceOf(Gauge);
			expect(activeSessions.name).toBe('portal_active_sessions');
		});

		it('pendingApprovals is a Gauge named portal_pending_approvals', () => {
			expect(pendingApprovals).toBeInstanceOf(Gauge);
			expect(pendingApprovals.name).toBe('portal_pending_approvals');
		});

		it('dbPoolActive is a Gauge named portal_db_pool_active', () => {
			expect(dbPoolActive).toBeInstanceOf(Gauge);
			expect(dbPoolActive.name).toBe('portal_db_pool_active');
		});

		it('dbPoolIdle is a Gauge named portal_db_pool_idle', () => {
			expect(dbPoolIdle).toBeInstanceOf(Gauge);
			expect(dbPoolIdle.name).toBe('portal_db_pool_idle');
		});

		it('authLogins is a Counter named portal_auth_logins_total', () => {
			expect(authLogins).toBeInstanceOf(Counter);
			expect(authLogins.name).toBe('portal_auth_logins_total');
		});

		it('httpRequestDuration is a Histogram named portal_http_request_duration_seconds', () => {
			expect(httpRequestDuration).toBeInstanceOf(Histogram);
			expect(httpRequestDuration.name).toBe('portal_http_request_duration_seconds');
		});
	});

	describe('predefined metrics integration with registry', () => {
		it('registry.collect() includes all predefined metrics after usage', () => {
			chatRequests.inc({ status: '200' });
			toolExecutions.inc({ tool: 'listInstances', success: 'true' });
			activeSessions.set({}, 5);

			const output = registry.collect();
			expect(output).toContain('portal_chat_requests_total');
			expect(output).toContain('portal_tool_executions_total');
			expect(output).toContain('portal_active_sessions');
		});

		it('toolDuration.startTimer records actual elapsed time', () => {
			const end = toolDuration.startTimer({ tool: 'listBuckets' });
			const elapsed = end();
			expect(elapsed).toBeGreaterThanOrEqual(0);

			const output = registry.collect();
			expect(output).toContain('portal_tool_duration_seconds');
		});
	});
});
