/**
 * Prometheus-compatible metrics collector for CloudNow.
 *
 * Provides Counter, Histogram, and Gauge metric types with a central Registry
 * that exposes metrics in Prometheus text exposition format.
 *
 * Usage:
 *   import { registry, chatRequests, toolDuration } from '../metrics';
 *
 *   chatRequests.inc({ model: 'gemini' });
 *   const end = toolDuration.startTimer({ tool: 'listInstances' });
 *   // ... work ...
 *   end();  // records elapsed seconds
 *
 *   // GET /api/metrics handler:
 *   return new Response(registry.collect(), { headers: { 'Content-Type': registry.contentType } });
 */

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

type Labels = Record<string, string>;

/** Stable serialisation of label pairs for map keys. */
function labelKey(labels: Labels): string {
	const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return '';
	return entries.map(([k, v]) => `${k}="${v}"`).join(',');
}

/** Format a single metric line in Prometheus text format. */
function formatLine(name: string, labels: Labels, value: number, suffix = ''): string {
	const fullName = suffix ? `${name}_${suffix}` : name;
	const lk = labelKey(labels);
	return lk ? `${fullName}{${lk}} ${value}` : `${fullName} ${value}`;
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

/**
 * A monotonically increasing counter.
 *
 * @example
 * const reqs = new Counter({ name: 'portal_requests_total', help: 'Total requests' });
 * reqs.inc({ method: 'GET' });
 */
export class Counter {
	readonly name: string;
	readonly help: string;
	private values = new Map<string, number>();

	constructor(opts: { name: string; help: string }) {
		this.name = opts.name;
		this.help = opts.help;
	}

	/** Increment by `value` (default 1). */
	inc(labels: Labels = {}, value = 1): void {
		const key = labelKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) + value);
	}

	/** Expose all label-sets for Prometheus collection. */
	collect(): string[] {
		const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
		for (const [key, value] of this.values) {
			const labels = key
				? Object.fromEntries(
						key
							.split(',')
							.map((p) => p.split('='))
							.map(([k, v]) => [k, v.slice(1, -1)])
					)
				: {};
			lines.push(formatLine(this.name, labels, value));
		}
		return lines;
	}

	/** Reset all values (useful in tests). */
	reset(): void {
		this.values.clear();
	}
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/**
 * A value that can go up and down (e.g. active sessions, pool connections).
 *
 * @example
 * const pool = new Gauge({ name: 'portal_db_pool_active', help: 'Active DB connections' });
 * pool.set({}, 5);
 */
export class Gauge {
	readonly name: string;
	readonly help: string;
	private values = new Map<string, number>();

	constructor(opts: { name: string; help: string }) {
		this.name = opts.name;
		this.help = opts.help;
	}

	set(labels: Labels = {}, value: number): void {
		this.values.set(labelKey(labels), value);
	}

	inc(labels: Labels = {}, value = 1): void {
		const key = labelKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) + value);
	}

	dec(labels: Labels = {}, value = 1): void {
		const key = labelKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) - value);
	}

	collect(): string[] {
		const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
		for (const [key, value] of this.values) {
			const labels = key
				? Object.fromEntries(
						key
							.split(',')
							.map((p) => p.split('='))
							.map(([k, v]) => [k, v.slice(1, -1)])
					)
				: {};
			lines.push(formatLine(this.name, labels, value));
		}
		return lines;
	}

	reset(): void {
		this.values.clear();
	}
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

/** Default histogram buckets (seconds), tuned for typical HTTP/tool latencies. */
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Histogram for observing distributions (e.g. request duration in seconds).
 *
 * @example
 * const dur = new Histogram({ name: 'portal_tool_duration_seconds', help: 'Tool latency' });
 * const end = dur.startTimer({ tool: 'listInstances' });
 * await doWork();
 * end(); // records elapsed time
 */
export class Histogram {
	readonly name: string;
	readonly help: string;
	readonly buckets: number[];

	/** Per-label-set: array of bucket counts, plus running sum and count. */
	private observations = new Map<string, { bucketCounts: number[]; sum: number; count: number }>();

	constructor(opts: { name: string; help: string; buckets?: number[] }) {
		this.name = opts.name;
		this.help = opts.help;
		this.buckets = opts.buckets ?? DEFAULT_BUCKETS;
	}

	/** Record an observed value. */
	observe(labels: Labels = {}, value: number): void {
		const key = labelKey(labels);
		let obs = this.observations.get(key);
		if (!obs) {
			obs = {
				bucketCounts: Array.from({ length: this.buckets.length }, () => 0),
				sum: 0,
				count: 0
			};
			this.observations.set(key, obs);
		}
		obs.sum += value;
		obs.count += 1;
		for (let i = 0; i < this.buckets.length; i++) {
			if (value <= this.buckets[i]) {
				obs.bucketCounts[i] += 1;
			}
		}
	}

	/**
	 * Start a timer. Returns a function that, when called, observes the
	 * elapsed time in seconds.
	 */
	startTimer(labels: Labels = {}): () => number {
		const start = performance.now();
		return () => {
			const elapsed = (performance.now() - start) / 1000;
			this.observe(labels, elapsed);
			return elapsed;
		};
	}

	collect(): string[] {
		const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];

		for (const [key, obs] of this.observations) {
			const labels: Labels = key
				? Object.fromEntries(
						key
							.split(',')
							.map((p) => p.split('='))
							.map(([k, v]) => [k, v.slice(1, -1)])
					)
				: {};

			let cumulative = 0;
			for (let i = 0; i < this.buckets.length; i++) {
				cumulative += obs.bucketCounts[i];
				lines.push(
					formatLine(this.name, { ...labels, le: String(this.buckets[i]) }, cumulative, 'bucket')
				);
			}
			lines.push(formatLine(this.name, { ...labels, le: '+Inf' }, obs.count, 'bucket'));
			lines.push(formatLine(this.name, labels, obs.sum, 'sum'));
			lines.push(formatLine(this.name, labels, obs.count, 'count'));
		}

		return lines;
	}

	reset(): void {
		this.observations.clear();
	}
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Metric = Counter | Gauge | Histogram;

/**
 * Central metrics registry. Collects all registered metrics into
 * Prometheus text exposition format.
 */
export class MetricsRegistry {
	private metrics: Metric[] = [];

	/** MIME type for the Prometheus scrape endpoint. */
	readonly contentType = 'text/plain; version=0.0.4; charset=utf-8';

	/** Register a metric. Returns the metric for chaining. */
	register<T extends Metric>(metric: T): T {
		this.metrics.push(metric);
		return metric;
	}

	/** Collect all metrics as Prometheus text exposition format. */
	collect(): string {
		return this.metrics.flatMap((m) => m.collect()).join('\n') + '\n';
	}

	/** Reset all registered metrics (useful in tests). */
	reset(): void {
		for (const m of this.metrics) m.reset();
	}
}

// ---------------------------------------------------------------------------
// Singleton registry + predefined metrics
// ---------------------------------------------------------------------------

/** Global metrics registry. Import this to register custom metrics. */
export const registry = new MetricsRegistry();

// -- Chat --
export const chatRequests = registry.register(
	new Counter({ name: 'portal_chat_requests_total', help: 'Total chat API requests' })
);

// -- Tools --
export const toolExecutions = registry.register(
	new Counter({
		name: 'portal_tool_executions_total',
		help: 'Total tool executions by tool name and status'
	})
);

export const toolDuration = registry.register(
	new Histogram({
		name: 'portal_tool_duration_seconds',
		help: 'Tool execution duration in seconds',
		buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
	})
);

// -- Sessions --
export const activeSessions = registry.register(
	new Gauge({ name: 'portal_active_sessions', help: 'Number of active sessions' })
);

// -- Approvals --
export const pendingApprovals = registry.register(
	new Gauge({ name: 'portal_pending_approvals', help: 'Number of pending tool approvals' })
);

// -- Database pool --
export const dbPoolActive = registry.register(
	new Gauge({ name: 'portal_db_pool_active', help: 'Active database pool connections' })
);

export const dbPoolIdle = registry.register(
	new Gauge({ name: 'portal_db_pool_idle', help: 'Idle database pool connections' })
);

// -- Auth --
export const authLogins = registry.register(
	new Counter({ name: 'portal_auth_logins_total', help: 'Total login attempts by status' })
);

// -- HTTP (populated by hooks) --
export const httpRequestDuration = registry.register(
	new Histogram({
		name: 'portal_http_request_duration_seconds',
		help: 'HTTP request duration in seconds',
		buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
	})
);
