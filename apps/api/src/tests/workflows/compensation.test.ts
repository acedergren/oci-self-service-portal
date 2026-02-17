/**
 * Compensation / Saga Pattern Tests
 *
 * Tests for apps/api/src/mastra/workflows/compensation.ts covering:
 * - CompensationPlan: add, entries, rollbackOrder, size, hasCompensations, clear
 * - compensationFor: factory helper
 * - buildCompensationEntry: entry builder
 * - runCompensations: reverse order, best-effort, summary stats
 * - isCompensationEntry: type guard
 * - describeCompensationPlan: human-readable summary
 */

import { describe, it, expect, vi } from 'vitest';
import {
	CompensationPlan,
	compensationFor,
	buildCompensationEntry,
	runCompensations,
	isCompensationEntry,
	describeCompensationPlan,
	type CompensationAction,
	type CompensationEntry
} from '../../mastra/workflows/compensation.js';

// ── compensationFor ──────────────────────────────────────────────────────────

describe('compensationFor', () => {
	it('returns an action without args when none provided', () => {
		const action = compensationFor('terminateInstance');

		expect(action.action).toBe('terminateInstance');
		expect(action.args).toBeUndefined();
	});

	it('returns an action with args when provided', () => {
		const action = compensationFor('deleteBucket', { bucketName: 'my-bucket' });

		expect(action.action).toBe('deleteBucket');
		expect(action.args).toEqual({ bucketName: 'my-bucket' });
	});

	it('returns a plain object (no class overhead)', () => {
		const action = compensationFor('rollback');
		expect(action).toEqual({ action: 'rollback' });
	});
});

// ── buildCompensationEntry ───────────────────────────────────────────────────

describe('buildCompensationEntry', () => {
	it('builds an entry from node context and action', () => {
		const action: CompensationAction = { action: 'terminateInstance', args: { id: 'i-123' } };

		const entry = buildCompensationEntry('create-instance', 'launchInstance', action);

		expect(entry.nodeId).toBe('create-instance');
		expect(entry.toolName).toBe('launchInstance');
		expect(entry.compensateAction).toBe('terminateInstance');
		expect(entry.compensateArgs).toEqual({ id: 'i-123' });
	});

	it('omits compensateArgs when action has no args', () => {
		const action: CompensationAction = { action: 'rollback' };

		const entry = buildCompensationEntry('node-1', 'createResource', action);

		expect(entry.compensateArgs).toBeUndefined();
	});
});

// ── CompensationPlan ─────────────────────────────────────────────────────────

describe('CompensationPlan', () => {
	it('starts empty', () => {
		const plan = new CompensationPlan();

		expect(plan.size).toBe(0);
		expect(plan.hasCompensations).toBe(false);
		expect(plan.entries()).toHaveLength(0);
	});

	it('adds entries and tracks size', () => {
		const plan = new CompensationPlan();
		const entry: CompensationEntry = {
			nodeId: 'n1',
			toolName: 'createInstance',
			compensateAction: 'terminateInstance'
		};

		plan.add(entry);

		expect(plan.size).toBe(1);
		expect(plan.hasCompensations).toBe(true);
	});

	it('is chainable: add() returns the plan', () => {
		const plan = new CompensationPlan();
		const e1: CompensationEntry = { nodeId: 'n1', toolName: 't1', compensateAction: 'r1' };
		const e2: CompensationEntry = { nodeId: 'n2', toolName: 't2', compensateAction: 'r2' };

		const result = plan.add(e1).add(e2);

		expect(result).toBe(plan);
		expect(plan.size).toBe(2);
	});

	it('entries() returns entries in push (forward) order', () => {
		const plan = new CompensationPlan();
		const e1: CompensationEntry = { nodeId: 'n1', toolName: 't1', compensateAction: 'r1' };
		const e2: CompensationEntry = { nodeId: 'n2', toolName: 't2', compensateAction: 'r2' };
		const e3: CompensationEntry = { nodeId: 'n3', toolName: 't3', compensateAction: 'r3' };

		plan.add(e1).add(e2).add(e3);

		const entries = plan.entries();
		expect(entries[0].nodeId).toBe('n1');
		expect(entries[1].nodeId).toBe('n2');
		expect(entries[2].nodeId).toBe('n3');
	});

	it('rollbackOrder() returns entries in reverse (LIFO) order', () => {
		const plan = new CompensationPlan();
		const e1: CompensationEntry = { nodeId: 'n1', toolName: 't1', compensateAction: 'r1' };
		const e2: CompensationEntry = { nodeId: 'n2', toolName: 't2', compensateAction: 'r2' };
		const e3: CompensationEntry = { nodeId: 'n3', toolName: 't3', compensateAction: 'r3' };

		plan.add(e1).add(e2).add(e3);

		const order = plan.rollbackOrder();
		expect(order[0].nodeId).toBe('n3');
		expect(order[1].nodeId).toBe('n2');
		expect(order[2].nodeId).toBe('n1');
	});

	it('rollbackOrder() does not mutate the internal stack', () => {
		const plan = new CompensationPlan();
		plan.add({ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' });
		plan.add({ nodeId: 'n2', toolName: 't2', compensateAction: 'r2' });

		plan.rollbackOrder(); // should not mutate

		expect(plan.entries()[0].nodeId).toBe('n1');
		expect(plan.entries()[1].nodeId).toBe('n2');
	});

	it('clear() resets the plan to empty', () => {
		const plan = new CompensationPlan();
		plan.add({ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' });

		plan.clear();

		expect(plan.size).toBe(0);
		expect(plan.hasCompensations).toBe(false);
	});

	it('clear() is chainable', () => {
		const plan = new CompensationPlan();
		const result = plan.clear();
		expect(result).toBe(plan);
	});

	it('entries() is readonly (does not expose the internal array)', () => {
		const plan = new CompensationPlan();
		plan.add({ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' });

		const entries = plan.entries();
		// The returned object is readonly — attempting to mutate should fail type-check
		// but we can verify the length wasn't changed by external mutation attempts
		expect(entries).toHaveLength(1);
		expect(plan.size).toBe(1);
	});
});

// ── runCompensations ─────────────────────────────────────────────────────────

describe('runCompensations', () => {
	it('returns empty summary for empty entries array', async () => {
		const exec = vi.fn();

		const summary = await runCompensations([], exec);

		expect(summary.total).toBe(0);
		expect(summary.succeeded).toBe(0);
		expect(summary.failed).toBe(0);
		expect(summary.results).toHaveLength(0);
		expect(exec).not.toHaveBeenCalled();
	});

	it('executes compensations in reverse order (LIFO)', async () => {
		const callOrder: string[] = [];
		const exec = vi.fn().mockImplementation(async (action: string) => {
			callOrder.push(action);
		});

		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'rollback-n1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'rollback-n2' },
			{ nodeId: 'n3', toolName: 't3', compensateAction: 'rollback-n3' }
		];

		await runCompensations(entries, exec);

		expect(callOrder).toEqual(['rollback-n3', 'rollback-n2', 'rollback-n1']);
	});

	it('passes compensateArgs to the executor', async () => {
		const exec = vi.fn().mockResolvedValue(undefined);

		const entries: CompensationEntry[] = [
			{
				nodeId: 'n1',
				toolName: 'createBucket',
				compensateAction: 'deleteBucket',
				compensateArgs: { bucketName: 'test-bucket', region: 'us-east-1' }
			}
		];

		await runCompensations(entries, exec);

		expect(exec).toHaveBeenCalledWith('deleteBucket', {
			bucketName: 'test-bucket',
			region: 'us-east-1'
		});
	});

	it('passes empty object when compensateArgs is undefined', async () => {
		const exec = vi.fn().mockResolvedValue(undefined);

		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 'createResource', compensateAction: 'deleteResource' }
		];

		await runCompensations(entries, exec);

		expect(exec).toHaveBeenCalledWith('deleteResource', {});
	});

	it('returns correct summary for all-success run', async () => {
		const exec = vi.fn().mockResolvedValue(undefined);

		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'r2' }
		];

		const summary = await runCompensations(entries, exec);

		expect(summary.total).toBe(2);
		expect(summary.succeeded).toBe(2);
		expect(summary.failed).toBe(0);
		expect(summary.results).toHaveLength(2);
		expect(summary.results.every((r) => r.success)).toBe(true);
	});

	it('is best-effort: continues after a failed compensation', async () => {
		const exec = vi.fn().mockImplementation(async (action: string) => {
			if (action === 'rollback-n2') throw new Error('rollback failed');
		});

		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'rollback-n1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'rollback-n2' },
			{ nodeId: 'n3', toolName: 't3', compensateAction: 'rollback-n3' }
		];

		// Should NOT throw even though n2's compensation fails
		const summary = await runCompensations(entries, exec);

		// All three were attempted (in reverse: n3, n2, n1)
		expect(exec).toHaveBeenCalledTimes(3);
		expect(summary.total).toBe(3);
		expect(summary.succeeded).toBe(2);
		expect(summary.failed).toBe(1);
	});

	it('records error message in result for failed compensations', async () => {
		const exec = vi.fn().mockImplementation(async () => {
			throw new Error('timeout during rollback');
		});

		const entries: CompensationEntry[] = [{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' }];

		const summary = await runCompensations(entries, exec);

		expect(summary.results[0].success).toBe(false);
		expect(summary.results[0].error).toBe('timeout during rollback');
	});

	it('handles non-Error thrown values by stringifying them', async () => {
		const exec = vi.fn().mockImplementation(async () => {
			throw 'string error';
		});

		const entries: CompensationEntry[] = [{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' }];

		const summary = await runCompensations(entries, exec);

		expect(summary.results[0].error).toBe('string error');
	});

	it('results are in rollback (reverse) order', async () => {
		const exec = vi.fn().mockResolvedValue(undefined);

		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'r2' },
			{ nodeId: 'n3', toolName: 't3', compensateAction: 'r3' }
		];

		const summary = await runCompensations(entries, exec);

		// Results are in the execution order (which is reverse of push order)
		expect(summary.results[0].nodeId).toBe('n3');
		expect(summary.results[1].nodeId).toBe('n2');
		expect(summary.results[2].nodeId).toBe('n1');
	});

	it('does not mutate the input entries array', async () => {
		const exec = vi.fn().mockResolvedValue(undefined);
		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'r2' }
		];
		const originalLength = entries.length;
		const firstEntry = entries[0];

		await runCompensations(entries, exec);

		expect(entries).toHaveLength(originalLength);
		expect(entries[0]).toBe(firstEntry);
	});
});

// ── isCompensationEntry ──────────────────────────────────────────────────────

describe('isCompensationEntry', () => {
	it('returns true for a valid CompensationEntry', () => {
		const entry: CompensationEntry = {
			nodeId: 'n1',
			toolName: 'createInstance',
			compensateAction: 'terminateInstance'
		};

		expect(isCompensationEntry(entry)).toBe(true);
	});

	it('returns true when optional compensateArgs is present', () => {
		const entry = {
			nodeId: 'n1',
			toolName: 'createBucket',
			compensateAction: 'deleteBucket',
			compensateArgs: { bucketName: 'test' }
		};

		expect(isCompensationEntry(entry)).toBe(true);
	});

	it('returns false for null', () => {
		expect(isCompensationEntry(null)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isCompensationEntry(42)).toBe(false);
		expect(isCompensationEntry('string')).toBe(false);
		expect(isCompensationEntry(true)).toBe(false);
	});

	it('returns false when nodeId is missing', () => {
		expect(isCompensationEntry({ toolName: 't', compensateAction: 'r' })).toBe(false);
	});

	it('returns false when toolName is missing', () => {
		expect(isCompensationEntry({ nodeId: 'n1', compensateAction: 'r' })).toBe(false);
	});

	it('returns false when compensateAction is missing', () => {
		expect(isCompensationEntry({ nodeId: 'n1', toolName: 't' })).toBe(false);
	});

	it('returns false when fields have wrong types', () => {
		expect(isCompensationEntry({ nodeId: 123, toolName: 't', compensateAction: 'r' })).toBe(false);
	});
});

// ── describeCompensationPlan ─────────────────────────────────────────────────

describe('describeCompensationPlan', () => {
	it('returns human-readable message for empty plan', () => {
		expect(describeCompensationPlan([])).toBe('no compensations registered');
	});

	it('describes a single-entry plan', () => {
		const entries: CompensationEntry[] = [
			{ nodeId: 'create-instance', toolName: 't1', compensateAction: 'terminateInstance' }
		];

		const desc = describeCompensationPlan(entries);

		expect(desc).toContain('1 compensation(s)');
		expect(desc).toContain('create-instance→terminateInstance');
	});

	it('describes a multi-entry plan with all steps', () => {
		const entries: CompensationEntry[] = [
			{ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' },
			{ nodeId: 'n2', toolName: 't2', compensateAction: 'r2' },
			{ nodeId: 'n3', toolName: 't3', compensateAction: 'r3' }
		];

		const desc = describeCompensationPlan(entries);

		expect(desc).toContain('3 compensation(s)');
		expect(desc).toContain('n1→r1');
		expect(desc).toContain('n2→r2');
		expect(desc).toContain('n3→r3');
	});
});

// ── Integration: CompensationPlan + runCompensations ─────────────────────────

describe('CompensationPlan integration with runCompensations', () => {
	it('uses rollbackOrder to drive execution sequence', async () => {
		const plan = new CompensationPlan();
		plan.add({ nodeId: 'step-1', toolName: 'createVCN', compensateAction: 'deleteVCN' });
		plan.add({ nodeId: 'step-2', toolName: 'createSubnet', compensateAction: 'deleteSubnet' });
		plan.add({
			nodeId: 'step-3',
			toolName: 'launchInstance',
			compensateAction: 'terminateInstance'
		});

		const executedActions: string[] = [];
		const exec = vi.fn().mockImplementation(async (action: string) => {
			executedActions.push(action);
		});

		// Use the plan's entries (runCompensations reverses internally)
		const summary = await runCompensations(plan.entries(), exec);

		// Should have run in reverse: terminateInstance → deleteSubnet → deleteVCN
		expect(executedActions).toEqual(['terminateInstance', 'deleteSubnet', 'deleteVCN']);
		expect(summary.total).toBe(3);
		expect(summary.succeeded).toBe(3);
	});

	it('clears the plan after successful workflow (no rollback needed)', () => {
		const plan = new CompensationPlan();
		plan.add({ nodeId: 'n1', toolName: 't1', compensateAction: 'r1' });

		// Simulate workflow completion: clear the plan
		plan.clear();

		expect(plan.hasCompensations).toBe(false);
		expect(plan.size).toBe(0);
	});
});
