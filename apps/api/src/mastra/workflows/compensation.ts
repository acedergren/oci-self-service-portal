/**
 * Compensation / Saga Pattern — Distributed Transaction Rollback
 *
 * Provides typed building blocks for declaring compensatable workflow steps.
 * The executor's runtime saga logic calls runCompensations() on failure;
 * this module externalizes the types, factory helpers, and plan utilities
 * so they can be tested and composed independently.
 *
 * Usage pattern:
 * 1. Declare a CompensationAction alongside each tool node
 * 2. The executor pushes it onto the CompensationStack when the node succeeds
 * 3. On failure, the executor calls runCompensations() in reverse order
 * 4. Use CompensationPlan.add() / .clear() to manage rollback sequences in code
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Declares the rollback action for a workflow tool node.
 * Attach this to a node's `data.compensate` field to make it compensatable.
 */
export interface CompensationAction {
	/** The tool name to call for rollback (e.g. 'terminateInstance') */
	action: string;
	/** Arguments to pass to the rollback tool (optional) */
	args?: Record<string, unknown>;
}

/**
 * A single entry in the compensation stack, capturing both the original
 * operation and its rollback action.
 */
export interface CompensationEntry {
	/** The workflow node that owns this compensation */
	nodeId: string;
	/** The tool that was executed successfully (and now needs rollback) */
	toolName: string;
	/** The rollback tool to call on failure */
	compensateAction: string;
	/** Arguments to pass to the rollback tool */
	compensateArgs?: Record<string, unknown>;
}

/**
 * Result of executing a single compensation action.
 */
export interface CompensationResult {
	nodeId: string;
	toolName: string;
	success: boolean;
	error?: string;
}

/**
 * Summary of a completed compensation run.
 */
export interface CompensationSummary {
	/** How many compensations were attempted */
	total: number;
	/** How many succeeded */
	succeeded: number;
	/** How many failed (best-effort, does not stop rollback) */
	failed: number;
	/** Per-step results in the order they were executed (reverse of push order) */
	results: CompensationResult[];
}

// ── CompensationPlan ─────────────────────────────────────────────────────────

/**
 * A mutable stack of compensation entries for programmatic saga composition.
 * Entries are added as steps succeed, then executed in reverse order on failure.
 *
 * @example
 * const plan = new CompensationPlan();
 * plan.add({ nodeId: 'create-instance', toolName: 'launchInstance',
 *             compensateAction: 'terminateInstance', compensateArgs: { id } });
 * // On failure: plan.entries() → reversed and executed by runCompensations()
 */
export class CompensationPlan {
	private readonly _stack: CompensationEntry[] = [];

	/**
	 * Add a compensation entry after a step succeeds.
	 * Entries are stored in execution order; rollback happens in reverse.
	 */
	add(entry: CompensationEntry): this {
		this._stack.push(entry);
		return this;
	}

	/**
	 * Return all entries in push order (executor reverses for rollback).
	 */
	entries(): readonly CompensationEntry[] {
		return this._stack;
	}

	/**
	 * Return entries in rollback order (last-in, first-out).
	 */
	rollbackOrder(): CompensationEntry[] {
		return [...this._stack].reverse();
	}

	/**
	 * Number of compensation entries currently tracked.
	 */
	get size(): number {
		return this._stack.length;
	}

	/**
	 * Whether there are any compensations to run.
	 */
	get hasCompensations(): boolean {
		return this._stack.length > 0;
	}

	/**
	 * Clear all entries (e.g. after successful completion — no rollback needed).
	 */
	clear(): this {
		this._stack.length = 0;
		return this;
	}
}

// ── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Build a CompensationAction for attaching to a tool node's data.
 *
 * @example
 * const node = {
 *   id: 'create-bucket',
 *   type: 'tool',
 *   data: {
 *     toolName: 'createBucket',
 *     compensate: compensationFor('deleteBucket', { bucketName: 'my-bucket' })
 *   }
 * };
 */
export function compensationFor(
	action: string,
	args?: Record<string, unknown>
): CompensationAction {
	return args !== undefined ? { action, args } : { action };
}

/**
 * Build a CompensationEntry from node context and a CompensationAction.
 * Used internally when pushing onto the compensation stack after a node succeeds.
 */
export function buildCompensationEntry(
	nodeId: string,
	toolName: string,
	compensation: CompensationAction
): CompensationEntry {
	const entry: CompensationEntry = {
		nodeId,
		toolName,
		compensateAction: compensation.action
	};
	if (compensation.args !== undefined) {
		entry.compensateArgs = compensation.args;
	}
	return entry;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Execute a list of compensation entries in reverse order (saga rollback).
 * Best-effort: a failed compensation does not stop subsequent ones.
 *
 * @param entries - The compensation stack (in push order; reversed internally)
 * @param executor - Async function that executes a single compensation action
 * @returns Summary of all compensation attempts
 */
export async function runCompensations(
	entries: readonly CompensationEntry[],
	executor: (action: string, args: Record<string, unknown>) => Promise<void>
): Promise<CompensationSummary> {
	const reversed = [...entries].reverse();
	const results: CompensationResult[] = [];

	for (const entry of reversed) {
		try {
			await executor(entry.compensateAction, entry.compensateArgs ?? {});
			results.push({ nodeId: entry.nodeId, toolName: entry.toolName, success: true });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			results.push({ nodeId: entry.nodeId, toolName: entry.toolName, success: false, error });
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	return {
		total: results.length,
		succeeded,
		failed: results.length - succeeded,
		results
	};
}

/**
 * Type guard: check whether a value looks like a CompensationEntry.
 */
export function isCompensationEntry(value: unknown): value is CompensationEntry {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v['nodeId'] === 'string' &&
		typeof v['toolName'] === 'string' &&
		typeof v['compensateAction'] === 'string'
	);
}

/**
 * Summarise a compensation plan for logging / observability.
 */
export function describeCompensationPlan(entries: readonly CompensationEntry[]): string {
	if (entries.length === 0) return 'no compensations registered';
	const steps = entries.map((e) => `${e.nodeId}→${e.compensateAction}`).join(', ');
	return `${entries.length} compensation(s): [${steps}]`;
}
