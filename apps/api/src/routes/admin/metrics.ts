/**
 * Admin metrics summary endpoint — structured JSON metrics.
 *
 * Registers:
 * - GET /api/admin/metrics/summary — JSON metrics overview for the admin dashboard
 *
 * Parses the Prometheus text format from the metrics registry
 * into a structured JSON summary grouped by metric category.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../plugins/rbac.js';
import { registry } from '@portal/server/metrics';

interface MetricEntry {
	name: string;
	help: string;
	type: 'counter' | 'gauge' | 'histogram';
	values: Array<{ labels: Record<string, string>; value: number }>;
}

/**
 * Parse Prometheus text exposition format into structured JSON.
 * This avoids needing to modify the metric classes or expose their internals.
 */
function parsePrometheusText(text: string): MetricEntry[] {
	const metrics: MetricEntry[] = [];
	let current: MetricEntry | null = null;

	for (const line of text.split('\n')) {
		if (!line || line.trim() === '') continue;

		if (line.startsWith('# HELP ')) {
			const rest = line.slice(7);
			const spaceIdx = rest.indexOf(' ');
			const name = rest.slice(0, spaceIdx);
			const help = rest.slice(spaceIdx + 1);
			current = { name, help, type: 'counter', values: [] };
			metrics.push(current);
		} else if (line.startsWith('# TYPE ')) {
			const rest = line.slice(7);
			const parts = rest.split(' ');
			if (current && parts[1]) {
				current.type = parts[1] as 'counter' | 'gauge' | 'histogram';
			}
		} else if (current) {
			// Parse metric line: name{label1="val1",label2="val2"} value
			const match = line.match(/^([^{\s]+)(?:\{([^}]*)\})?\s+(.+)$/);
			if (match) {
				const labels: Record<string, string> = {};
				if (match[2]) {
					for (const pair of match[2].split(',')) {
						const eqIdx = pair.indexOf('=');
						if (eqIdx > 0) {
							const key = pair.slice(0, eqIdx);
							const val = pair.slice(eqIdx + 1).replace(/^"|"$/g, '');
							labels[key] = val;
						}
					}
				}
				current.values.push({ labels, value: Number(match[3]) });
			}
		}
	}

	return metrics;
}

export async function adminMetricsRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/admin/metrics/summary',
		{ preHandler: requireAuth('admin:all') },
		async (_request, reply) => {
			const raw = registry.collect();
			const parsed = parsePrometheusText(raw);

			// Build a structured summary grouped by category
			const metricsMap = new Map(parsed.map((m) => [m.name, m]));

			// Helper to sum all values for a counter
			const counterTotal = (name: string): number => {
				const metric = metricsMap.get(name);
				if (!metric) return 0;
				return metric.values.reduce((sum, v) => sum + v.value, 0);
			};

			// Helper to get the current value of a gauge (sum of all label sets)
			const gaugeValue = (name: string): number => {
				const metric = metricsMap.get(name);
				if (!metric) return 0;
				return metric.values.reduce((sum, v) => sum + v.value, 0);
			};

			// Helper to get breakdown by label
			const breakdownByLabel = (name: string, labelKey: string): Record<string, number> => {
				const metric = metricsMap.get(name);
				if (!metric) return {};
				const result: Record<string, number> = {};
				for (const v of metric.values) {
					const key = v.labels[labelKey] ?? 'unknown';
					result[key] = (result[key] ?? 0) + v.value;
				}
				return result;
			};

			const summary = {
				timestamp: new Date().toISOString(),
				chat: {
					totalRequests: counterTotal('portal_chat_requests_total'),
					byModel: breakdownByLabel('portal_chat_requests_total', 'model')
				},
				tools: {
					totalExecutions: counterTotal('portal_tool_executions_total'),
					byTool: breakdownByLabel('portal_tool_executions_total', 'tool'),
					byStatus: breakdownByLabel('portal_tool_executions_total', 'status')
				},
				sessions: {
					active: gaugeValue('portal_active_sessions')
				},
				approvals: {
					pending: gaugeValue('portal_pending_approvals')
				},
				database: {
					poolActive: gaugeValue('portal_db_pool_active'),
					poolIdle: gaugeValue('portal_db_pool_idle')
				},
				auth: {
					totalLogins: counterTotal('portal_auth_logins_total'),
					byStatus: breakdownByLabel('portal_auth_logins_total', 'status')
				},
				// Raw parsed metrics for advanced consumers
				raw: parsed.map((m) => ({
					name: m.name,
					help: m.help,
					type: m.type,
					valueCount: m.values.length
				}))
			};

			return reply.send(summary);
		}
	);
}
