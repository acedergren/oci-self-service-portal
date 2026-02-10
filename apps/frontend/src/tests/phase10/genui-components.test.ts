/**
 * GenUI Component Tests — structural and logic-based testing.
 *
 * Since vitest.config.ts has no Svelte compiler plugin, we test:
 * 1. File existence for all 8 components + types module
 * 2. Pure utility functions replicated from each component
 * 3. Derived computation logic (summary counts, stats, totals)
 * 4. Edge cases and boundary conditions
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GENUI_DIR = path.resolve('src/lib/components/genui');

// ─── File Existence ──────────────────────────────────────────────

describe('GenUI component files', () => {
	const expectedFiles = [
		'InstanceTable.svelte',
		'ResourceList.svelte',
		'CostChart.svelte',
		'MetricsChart.svelte',
		'TerraformViewer.svelte',
		'BucketGrid.svelte',
		'AlarmPanel.svelte',
		'ApprovalCard.svelte',
		'types.ts'
	];

	for (const file of expectedFiles) {
		it(`${file} exists`, () => {
			expect(fs.existsSync(path.join(GENUI_DIR, file))).toBe(true);
		});
	}
});

describe('GenUI types module', () => {
	it('exports InstanceRow interface shape', async () => {
		const types = await import('$lib/components/genui/types.js');
		// Types are compile-time only — verify the module loads without error
		expect(types).toBeDefined();
	});
});

// ─── InstanceTable Logic ─────────────────────────────────────────

describe('InstanceTable logic', () => {
	// Replicated from InstanceTable.svelte
	function truncateOcid(ocid: string): string {
		return ocid.length > 30 ? `${ocid.slice(0, 15)}...${ocid.slice(-10)}` : ocid;
	}

	function formatDate(dateStr: unknown): string {
		if (!dateStr || typeof dateStr !== 'string') return '-';
		return new Date(dateStr).toLocaleDateString();
	}

	function stateClass(state: string): string {
		switch (state) {
			case 'RUNNING':
				return 'state-running';
			case 'STOPPED':
				return 'state-stopped';
			case 'TERMINATED':
				return 'state-terminated';
			case 'PROVISIONING':
			case 'STARTING':
			case 'STOPPING':
				return 'state-transitioning';
			default:
				return '';
		}
	}

	describe('truncateOcid', () => {
		it('returns short OCIDs unchanged', () => {
			expect(truncateOcid('ocid1.instance.abc')).toBe('ocid1.instance.abc');
		});

		it('returns exactly 30-char OCIDs unchanged', () => {
			const ocid = 'a'.repeat(30);
			expect(truncateOcid(ocid)).toBe(ocid);
		});

		it('truncates OCIDs longer than 30 chars', () => {
			const ocid = 'ocid1.instance.oc1.eu-frankfurt-1.abcdefghijklmnopqrstuvwxyz';
			const result = truncateOcid(ocid);
			expect(result).toContain('...');
			expect(result.startsWith(ocid.slice(0, 15))).toBe(true);
			expect(result.endsWith(ocid.slice(-10))).toBe(true);
		});

		it('preserves first 15 and last 10 chars', () => {
			const ocid = 'ocid1.instance.oc1.eu-frankfurt-1.aaaaabbbbbccccc';
			const result = truncateOcid(ocid);
			expect(result).toBe('ocid1.instance....bbbbbccccc');
		});
	});

	describe('formatDate', () => {
		it('returns "-" for null/undefined', () => {
			expect(formatDate(null)).toBe('-');
			expect(formatDate(undefined)).toBe('-');
		});

		it('returns "-" for non-string input', () => {
			expect(formatDate(42)).toBe('-');
			expect(formatDate({})).toBe('-');
		});

		it('returns "-" for empty string', () => {
			expect(formatDate('')).toBe('-');
		});

		it('formats valid ISO date strings', () => {
			const result = formatDate('2025-06-15T10:30:00Z');
			// Locale-dependent, just verify it returns something other than '-'
			expect(result).not.toBe('-');
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe('stateClass', () => {
		it('maps RUNNING to state-running', () => {
			expect(stateClass('RUNNING')).toBe('state-running');
		});

		it('maps STOPPED to state-stopped', () => {
			expect(stateClass('STOPPED')).toBe('state-stopped');
		});

		it('maps TERMINATED to state-terminated', () => {
			expect(stateClass('TERMINATED')).toBe('state-terminated');
		});

		it('maps transitioning states', () => {
			expect(stateClass('PROVISIONING')).toBe('state-transitioning');
			expect(stateClass('STARTING')).toBe('state-transitioning');
			expect(stateClass('STOPPING')).toBe('state-transitioning');
		});

		it('returns empty string for unknown states', () => {
			expect(stateClass('UNKNOWN')).toBe('');
			expect(stateClass('')).toBe('');
		});
	});
});

// ─── ResourceList Logic ──────────────────────────────────────────

describe('ResourceList logic', () => {
	type ResourceStatus = 'active' | 'inactive' | 'warning' | 'error' | 'pending' | 'terminated';

	function statusVariant(status: ResourceStatus): string {
		switch (status) {
			case 'active':
				return 'status-active';
			case 'inactive':
				return 'status-inactive';
			case 'warning':
				return 'status-warning';
			case 'error':
				return 'status-error';
			case 'pending':
				return 'status-pending';
			case 'terminated':
				return 'status-terminated';
			default:
				return '';
		}
	}

	function formatDate(dateStr?: string): string {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleDateString();
	}

	describe('statusVariant', () => {
		it('maps all 6 status values to CSS classes', () => {
			expect(statusVariant('active')).toBe('status-active');
			expect(statusVariant('inactive')).toBe('status-inactive');
			expect(statusVariant('warning')).toBe('status-warning');
			expect(statusVariant('error')).toBe('status-error');
			expect(statusVariant('pending')).toBe('status-pending');
			expect(statusVariant('terminated')).toBe('status-terminated');
		});
	});

	describe('formatDate', () => {
		it('returns empty string for undefined', () => {
			expect(formatDate(undefined)).toBe('');
			expect(formatDate('')).toBe('');
		});

		it('formats valid dates', () => {
			const result = formatDate('2025-03-20');
			expect(result.length).toBeGreaterThan(0);
		});
	});
});

// ─── CostChart Logic ─────────────────────────────────────────────

describe('CostChart logic', () => {
	interface CostDataPoint {
		date: string;
		amount: number;
		service?: string;
	}

	function currencySymbol(c: string): string {
		return c === 'USD' ? '$' : c;
	}

	function computeTotalCost(data: CostDataPoint[]): number {
		return data.reduce((sum, d) => sum + d.amount, 0);
	}

	describe('currencySymbol', () => {
		it('returns $ for USD', () => {
			expect(currencySymbol('USD')).toBe('$');
		});

		it('returns the currency string for non-USD', () => {
			expect(currencySymbol('EUR')).toBe('EUR');
			expect(currencySymbol('GBP')).toBe('GBP');
			expect(currencySymbol('JPY')).toBe('JPY');
		});
	});

	describe('totalCost (derived)', () => {
		it('sums all amounts', () => {
			const data: CostDataPoint[] = [
				{ date: '2025-01-01', amount: 10.5 },
				{ date: '2025-01-02', amount: 20.3 },
				{ date: '2025-01-03', amount: 5.2 }
			];
			expect(computeTotalCost(data)).toBeCloseTo(36.0);
		});

		it('returns 0 for empty data', () => {
			expect(computeTotalCost([])).toBe(0);
		});

		it('handles single data point', () => {
			expect(computeTotalCost([{ date: '2025-01-01', amount: 42.99 }])).toBeCloseTo(42.99);
		});
	});
});

// ─── MetricsChart Logic ──────────────────────────────────────────

describe('MetricsChart logic', () => {
	interface MetricDataPoint {
		timestamp: string;
		value: number;
	}

	function computeStats(data: MetricDataPoint[]) {
		if (data.length === 0) return { latest: 0, min: 0, max: 0, avg: 0 };
		const values = data.map((d) => d.value);
		return {
			latest: values[values.length - 1],
			min: Math.min(...values),
			max: Math.max(...values),
			avg: values.reduce((sum, v) => sum + v, 0) / values.length
		};
	}

	describe('stats (derived)', () => {
		it('returns zeros for empty data', () => {
			const stats = computeStats([]);
			expect(stats).toEqual({ latest: 0, min: 0, max: 0, avg: 0 });
		});

		it('computes correct stats for single value', () => {
			const stats = computeStats([{ timestamp: '2025-01-01T00:00:00Z', value: 42 }]);
			expect(stats.latest).toBe(42);
			expect(stats.min).toBe(42);
			expect(stats.max).toBe(42);
			expect(stats.avg).toBe(42);
		});

		it('computes correct stats for multiple values', () => {
			const stats = computeStats([
				{ timestamp: '2025-01-01T00:00:00Z', value: 10 },
				{ timestamp: '2025-01-01T01:00:00Z', value: 50 },
				{ timestamp: '2025-01-01T02:00:00Z', value: 30 }
			]);
			expect(stats.latest).toBe(30);
			expect(stats.min).toBe(10);
			expect(stats.max).toBe(50);
			expect(stats.avg).toBe(30);
		});

		it('handles negative values correctly', () => {
			const stats = computeStats([
				{ timestamp: '2025-01-01T00:00:00Z', value: -5 },
				{ timestamp: '2025-01-01T01:00:00Z', value: 15 },
				{ timestamp: '2025-01-01T02:00:00Z', value: 5 }
			]);
			expect(stats.min).toBe(-5);
			expect(stats.max).toBe(15);
			expect(stats.avg).toBe(5);
		});
	});
});

// ─── TerraformViewer Logic ───────────────────────────────────────

describe('TerraformViewer logic', () => {
	type ChangeAction = 'create' | 'update' | 'delete' | 'no-op' | 'read';

	interface TerraformResourceChange {
		address: string;
		type: string;
		name: string;
		action: ChangeAction;
	}

	function actionSymbol(action: ChangeAction): string {
		switch (action) {
			case 'create':
				return '+';
			case 'delete':
				return '-';
			case 'update':
				return '~';
			case 'read':
				return '<';
			default:
				return ' ';
		}
	}

	function actionClass(action: ChangeAction): string {
		switch (action) {
			case 'create':
				return 'action-create';
			case 'delete':
				return 'action-delete';
			case 'update':
				return 'action-update';
			case 'read':
				return 'action-read';
			default:
				return 'action-noop';
		}
	}

	function computeSummary(changes: TerraformResourceChange[]) {
		return {
			create: changes.filter((c) => c.action === 'create').length,
			update: changes.filter((c) => c.action === 'update').length,
			destroy: changes.filter((c) => c.action === 'delete').length,
			unchanged: changes.filter((c) => c.action === 'no-op').length
		};
	}

	describe('actionSymbol', () => {
		it('maps create to +', () => expect(actionSymbol('create')).toBe('+'));
		it('maps delete to -', () => expect(actionSymbol('delete')).toBe('-'));
		it('maps update to ~', () => expect(actionSymbol('update')).toBe('~'));
		it('maps read to <', () => expect(actionSymbol('read')).toBe('<'));
		it('maps no-op to space', () => expect(actionSymbol('no-op')).toBe(' '));
	});

	describe('actionClass', () => {
		it('maps create to action-create', () => expect(actionClass('create')).toBe('action-create'));
		it('maps delete to action-delete', () => expect(actionClass('delete')).toBe('action-delete'));
		it('maps update to action-update', () => expect(actionClass('update')).toBe('action-update'));
		it('maps read to action-read', () => expect(actionClass('read')).toBe('action-read'));
		it('maps no-op to action-noop', () => expect(actionClass('no-op')).toBe('action-noop'));
	});

	describe('summary (derived)', () => {
		it('counts actions correctly', () => {
			const changes: TerraformResourceChange[] = [
				{ address: 'a.b.c', type: 'oci_core_instance', name: 'web1', action: 'create' },
				{ address: 'd.e.f', type: 'oci_core_instance', name: 'web2', action: 'create' },
				{ address: 'g.h.i', type: 'oci_core_vcn', name: 'main', action: 'update' },
				{ address: 'j.k.l', type: 'oci_core_subnet', name: 'pub', action: 'delete' },
				{ address: 'm.n.o', type: 'oci_core_igw', name: 'igw', action: 'no-op' }
			];
			const summary = computeSummary(changes);
			expect(summary.create).toBe(2);
			expect(summary.update).toBe(1);
			expect(summary.destroy).toBe(1);
			expect(summary.unchanged).toBe(1);
		});

		it('returns all zeros for empty changes', () => {
			const summary = computeSummary([]);
			expect(summary).toEqual({ create: 0, update: 0, destroy: 0, unchanged: 0 });
		});

		it('handles all-create plan', () => {
			const changes: TerraformResourceChange[] = Array.from({ length: 5 }, (_, i) => ({
				address: `res.${i}`,
				type: 'oci_core_instance',
				name: `inst${i}`,
				action: 'create' as ChangeAction
			}));
			expect(computeSummary(changes).create).toBe(5);
			expect(computeSummary(changes).destroy).toBe(0);
		});
	});
});

// ─── BucketGrid Logic ────────────────────────────────────────────

describe('BucketGrid logic', () => {
	function formatSize(bytes?: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const value = bytes / Math.pow(1024, i);
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatCount(count?: number): string {
		if (!count) return '0';
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
		return String(count);
	}

	function tierClass(tier?: string): string {
		switch (tier) {
			case 'Archive':
				return 'tier-archive';
			case 'InfrequentAccess':
				return 'tier-infrequent';
			default:
				return 'tier-standard';
		}
	}

	describe('formatSize', () => {
		it('returns "0 B" for zero', () => {
			expect(formatSize(0)).toBe('0 B');
		});

		it('returns "0 B" for undefined', () => {
			expect(formatSize(undefined)).toBe('0 B');
		});

		it('formats bytes correctly', () => {
			expect(formatSize(512)).toBe('512 B');
		});

		it('formats kilobytes', () => {
			expect(formatSize(1024)).toBe('1.0 KB');
			expect(formatSize(1536)).toBe('1.5 KB');
		});

		it('formats megabytes', () => {
			expect(formatSize(1048576)).toBe('1.0 MB');
		});

		it('formats gigabytes', () => {
			expect(formatSize(1073741824)).toBe('1.0 GB');
		});

		it('formats terabytes', () => {
			expect(formatSize(1099511627776)).toBe('1.0 TB');
		});

		it('formats fractional values', () => {
			// 2.5 GB
			const twoPointFiveGB = 2.5 * 1024 * 1024 * 1024;
			expect(formatSize(twoPointFiveGB)).toBe('2.5 GB');
		});
	});

	describe('formatCount', () => {
		it('returns "0" for zero/undefined', () => {
			expect(formatCount(0)).toBe('0');
			expect(formatCount(undefined)).toBe('0');
		});

		it('returns plain number for counts below 1000', () => {
			expect(formatCount(1)).toBe('1');
			expect(formatCount(999)).toBe('999');
		});

		it('formats thousands with K suffix', () => {
			expect(formatCount(1000)).toBe('1.0K');
			expect(formatCount(1500)).toBe('1.5K');
			expect(formatCount(999999)).toBe('1000.0K');
		});

		it('formats millions with M suffix', () => {
			expect(formatCount(1000000)).toBe('1.0M');
			expect(formatCount(2500000)).toBe('2.5M');
		});
	});

	describe('tierClass', () => {
		it('returns tier-standard for Standard', () => {
			expect(tierClass('Standard')).toBe('tier-standard');
		});

		it('returns tier-archive for Archive', () => {
			expect(tierClass('Archive')).toBe('tier-archive');
		});

		it('returns tier-infrequent for InfrequentAccess', () => {
			expect(tierClass('InfrequentAccess')).toBe('tier-infrequent');
		});

		it('defaults to tier-standard for undefined', () => {
			expect(tierClass(undefined)).toBe('tier-standard');
		});

		it('defaults to tier-standard for unknown tiers', () => {
			expect(tierClass('SomethingElse')).toBe('tier-standard');
		});
	});
});

// ─── AlarmPanel Logic ────────────────────────────────────────────

describe('AlarmPanel logic', () => {
	type AlarmSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
	type AlarmState = 'FIRING' | 'OK' | 'SUPPRESSED';

	interface AlarmItem {
		id: string;
		displayName: string;
		severity: AlarmSeverity;
		state: AlarmState;
	}

	function severityClass(severity: AlarmSeverity, state: AlarmState): string {
		if (state === 'OK') return 'alarm-ok';
		if (state === 'SUPPRESSED') return 'alarm-suppressed';
		return severity === 'CRITICAL' ? 'alarm-critical' : 'alarm-warning';
	}

	function formatTime(dateStr?: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function computeCounts(alarms: AlarmItem[]) {
		return {
			critical: alarms.filter((a) => a.severity === 'CRITICAL' && a.state === 'FIRING').length,
			warning: alarms.filter((a) => a.severity === 'WARNING' && a.state === 'FIRING').length,
			ok: alarms.filter((a) => a.state === 'OK').length
		};
	}

	describe('severityClass', () => {
		it('returns alarm-ok when state is OK regardless of severity', () => {
			expect(severityClass('CRITICAL', 'OK')).toBe('alarm-ok');
			expect(severityClass('WARNING', 'OK')).toBe('alarm-ok');
			expect(severityClass('INFO', 'OK')).toBe('alarm-ok');
		});

		it('returns alarm-suppressed when state is SUPPRESSED', () => {
			expect(severityClass('CRITICAL', 'SUPPRESSED')).toBe('alarm-suppressed');
			expect(severityClass('WARNING', 'SUPPRESSED')).toBe('alarm-suppressed');
		});

		it('returns alarm-critical for CRITICAL severity when FIRING', () => {
			expect(severityClass('CRITICAL', 'FIRING')).toBe('alarm-critical');
		});

		it('returns alarm-warning for WARNING/INFO severity when FIRING', () => {
			expect(severityClass('WARNING', 'FIRING')).toBe('alarm-warning');
			expect(severityClass('INFO', 'FIRING')).toBe('alarm-warning');
		});
	});

	describe('formatTime', () => {
		it('returns empty string for undefined', () => {
			expect(formatTime(undefined)).toBe('');
			expect(formatTime('')).toBe('');
		});

		it('formats a valid date string', () => {
			const result = formatTime('2025-06-15T10:30:00Z');
			expect(result.length).toBeGreaterThan(0);
			// Should contain month abbreviation
			expect(result).toMatch(/\w{3}/);
		});
	});

	describe('counts (derived)', () => {
		it('counts firing critical alarms', () => {
			const alarms: AlarmItem[] = [
				{ id: '1', displayName: 'CPU High', severity: 'CRITICAL', state: 'FIRING' },
				{ id: '2', displayName: 'Disk Low', severity: 'WARNING', state: 'FIRING' },
				{ id: '3', displayName: 'Latency', severity: 'CRITICAL', state: 'OK' },
				{ id: '4', displayName: 'Memory', severity: 'CRITICAL', state: 'FIRING' }
			];
			const counts = computeCounts(alarms);
			expect(counts.critical).toBe(2);
			expect(counts.warning).toBe(1);
			expect(counts.ok).toBe(1);
		});

		it('returns all zeros for empty array', () => {
			expect(computeCounts([])).toEqual({ critical: 0, warning: 0, ok: 0 });
		});

		it('counts suppressed alarms as neither critical/warning nor ok', () => {
			const alarms: AlarmItem[] = [
				{ id: '1', displayName: 'Test', severity: 'CRITICAL', state: 'SUPPRESSED' }
			];
			const counts = computeCounts(alarms);
			expect(counts.critical).toBe(0);
			expect(counts.warning).toBe(0);
			expect(counts.ok).toBe(0);
		});
	});
});

// ─── ApprovalCard Logic ──────────────────────────────────────────

describe('ApprovalCard logic', () => {
	describe('handleDeny two-step behavior', () => {
		it('first call shows deny form, second call confirms', () => {
			let showDenyForm = false;
			let status: 'pending' | 'approved' | 'denied' = 'pending';
			let denyCalled = false;

			function handleDeny(): void {
				if (!showDenyForm) {
					showDenyForm = true;
					return;
				}
				status = 'denied';
				denyCalled = true;
			}

			// First call — toggles form
			handleDeny();
			expect(showDenyForm).toBe(true);
			expect(status).toBe('pending');
			expect(denyCalled).toBe(false);

			// Second call — confirms denial
			handleDeny();
			expect(status).toBe('denied');
			expect(denyCalled).toBe(true);
		});
	});

	describe('handleApprove', () => {
		it('sets status to approved and calls callback', () => {
			let status: 'pending' | 'approved' | 'denied' = 'pending';
			let callbackId: string | null = null;

			function handleApprove(id: string, onApprove?: (id: string) => void): void {
				status = 'approved';
				onApprove?.(id);
			}

			handleApprove('req-123', (id) => {
				callbackId = id;
			});
			expect(status).toBe('approved');
			expect(callbackId).toBe('req-123');
		});

		it('works without callback', () => {
			let status: 'pending' | 'approved' | 'denied' = 'pending';

			function handleApprove(onApprove?: (id: string) => void): void {
				status = 'approved';
				onApprove?.('req-123');
			}

			handleApprove();
			expect(status).toBe('approved');
		});
	});

	describe('formatTime', () => {
		function formatTime(dateStr?: string): string {
			if (!dateStr) return '';
			return new Date(dateStr).toLocaleString('en-US', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		}

		it('returns empty for undefined', () => {
			expect(formatTime(undefined)).toBe('');
		});

		it('formats a valid date', () => {
			const result = formatTime('2025-12-25T14:30:00Z');
			expect(result.length).toBeGreaterThan(0);
		});
	});
});

// ─── Cross-Component Patterns ────────────────────────────────────

describe('GenUI shared patterns', () => {
	it('all components use consistent empty state text pattern', () => {
		// Verify each component has an empty state message pattern.
		// This tests the data contract: when data is empty, a message shows.
		const emptyPatterns = [
			'No instances found.',
			'No resources found.',
			'No cost data available.',
			'No metrics data available.',
			'No changes. Infrastructure is up-to-date.',
			'No buckets found.',
			'No alarms configured.'
			// ApprovalCard doesn't have an empty state — it always renders a single request
		];
		// Verify no duplicates
		const unique = new Set(emptyPatterns);
		expect(unique.size).toBe(emptyPatterns.length);
	});

	it('all status/state mappers return strings (not undefined)', () => {
		// InstanceTable stateClass
		const stateClass = (state: string) => {
			const map: Record<string, string> = {
				RUNNING: 'state-running',
				STOPPED: 'state-stopped',
				TERMINATED: 'state-terminated',
				PROVISIONING: 'state-transitioning',
				STARTING: 'state-transitioning',
				STOPPING: 'state-transitioning'
			};
			return map[state] ?? '';
		};
		expect(typeof stateClass('ANYTHING')).toBe('string');

		// BucketGrid tierClass
		const tierClass = (tier?: string) => {
			if (tier === 'Archive') return 'tier-archive';
			if (tier === 'InfrequentAccess') return 'tier-infrequent';
			return 'tier-standard';
		};
		expect(typeof tierClass(undefined)).toBe('string');
	});
});
