/**
 * Tests for the executeParallelBranches() programmatic API.
 *
 * This covers the standalone parallel execution function (not the workflow graph
 * node factory — that is covered in parallel-node.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
	executeParallelBranches,
	createParallelNode,
	parseParallelResults,
	isParallelNodeError,
	extractParallelErrors
} from '../../mastra/workflows/nodes/parallel.js';

// ── executeParallelBranches() ─────────────────────────────────────────────

describe('executeParallelBranches', () => {
	// ── merge strategy: all ────────────────────────────────────────────

	describe('mergeStrategy: all', () => {
		it('executes all branches and merges results by name', async () => {
			const result = await executeParallelBranches({
				branches: {
					fetchInstances: async () => ({ count: 3 }),
					fetchNetworks: async () => ({ count: 5 })
				},
				mergeStrategy: 'all'
			});

			expect(result.totalCount).toBe(2);
			expect(result.successCount).toBe(2);
			expect(result.failureCount).toBe(0);
			expect(result.branches.fetchInstances.status).toBe('fulfilled');
			expect(result.branches.fetchInstances.value).toEqual({ count: 3 });
			expect(result.branches.fetchNetworks.status).toBe('fulfilled');
			expect(result.branches.fetchNetworks.value).toEqual({ count: 5 });
		});

		it('passes shared context to every branch', async () => {
			const received: Record<string, unknown>[] = [];

			await executeParallelBranches({
				branches: {
					branchA: async (ctx) => {
						received.push({ ...ctx, branch: 'A' });
						return null;
					},
					branchB: async (ctx) => {
						received.push({ ...ctx, branch: 'B' });
						return null;
					}
				},
				context: { compartmentId: 'ocid1.compartment.oc1..test' },
				mergeStrategy: 'all'
			});

			expect(received).toHaveLength(2);
			// Both branches received the shared context
			for (const entry of received) {
				expect(entry.compartmentId).toBe('ocid1.compartment.oc1..test');
			}
		});

		it('throws on first failure with fail-fast error handling', async () => {
			await expect(
				executeParallelBranches({
					branches: {
						goodBranch: async () => ({ ok: true }),
						badBranch: async () => {
							throw new Error('OCI timeout');
						}
					},
					mergeStrategy: 'all',
					errorHandling: 'fail-fast'
				})
			).rejects.toThrow('badBranch');
		});

		it('collects all results including errors with collect-all', async () => {
			const result = await executeParallelBranches({
				branches: {
					successA: async () => ({ data: 'a' }),
					failingB: async () => {
						throw new Error('network error');
					},
					successC: async () => ({ data: 'c' })
				},
				mergeStrategy: 'all',
				errorHandling: 'collect-all'
			});

			expect(result.totalCount).toBe(3);
			expect(result.successCount).toBe(2);
			expect(result.failureCount).toBe(1);
			expect(result.branches.successA.status).toBe('fulfilled');
			expect(result.branches.failingB.status).toBe('rejected');
			expect(result.branches.failingB.error).toContain('network error');
			expect(result.branches.successC.status).toBe('fulfilled');
		});

		it('uses fail-fast as default error handling', async () => {
			await expect(
				executeParallelBranches({
					branches: {
						ok: async () => 42,
						bad: async () => {
							throw new Error('boom');
						}
					},
					mergeStrategy: 'all'
					// errorHandling not specified — defaults to fail-fast
				})
			).rejects.toThrow('bad');
		});
	});

	// ── merge strategy: any ────────────────────────────────────────────

	describe('mergeStrategy: any', () => {
		it('returns first successful branch result', async () => {
			const result = await executeParallelBranches({
				branches: {
					slowBranch: async () => {
						await new Promise((r) => setTimeout(r, 50));
						return { source: 'slow' };
					},
					fastBranch: async () => ({ source: 'fast' })
				},
				mergeStrategy: 'any'
			});

			// Should have exactly one branch result
			expect(result.totalCount).toBe(1);
			expect(result.successCount).toBe(1);
		});

		it('throws AggregateError when all branches fail', async () => {
			await expect(
				executeParallelBranches({
					branches: {
						bad1: async () => {
							throw new Error('error 1');
						},
						bad2: async () => {
							throw new Error('error 2');
						}
					},
					mergeStrategy: 'any'
				})
			).rejects.toThrow(); // Promise.any throws AggregateError when all fail
		});
	});

	// ── merge strategy: first ──────────────────────────────────────────

	describe('mergeStrategy: first', () => {
		it('returns first branch to settle (even if success)', async () => {
			const result = await executeParallelBranches({
				branches: {
					winner: async () => ({ data: 'first' }),
					loser: async () => {
						await new Promise((r) => setTimeout(r, 100));
						return { data: 'second' };
					}
				},
				mergeStrategy: 'first'
			});

			expect(result.totalCount).toBe(1);
		});

		it('returns first to settle even on failure', async () => {
			const result = await executeParallelBranches({
				branches: {
					fastFail: async () => {
						throw new Error('fast failure');
					},
					slowSuccess: async () => {
						await new Promise((r) => setTimeout(r, 100));
						return { ok: true };
					}
				},
				mergeStrategy: 'first'
			});

			expect(result.totalCount).toBe(1);
			// Could be either fulfilled or rejected depending on timing
			const [branchResult] = Object.values(result.branches);
			expect(['fulfilled', 'rejected']).toContain(branchResult.status);
		});
	});

	// ── timeout ────────────────────────────────────────────────────────

	describe('timeout handling', () => {
		it('rejects slow branches that exceed timeoutMs', async () => {
			const result = await executeParallelBranches({
				branches: {
					fastBranch: async () => ({ ok: true }),
					slowBranch: async () => {
						await new Promise((r) => setTimeout(r, 500));
						return { ok: true };
					}
				},
				mergeStrategy: 'all',
				errorHandling: 'collect-all',
				timeoutMs: 50
			});

			// slowBranch should have timed out
			expect(result.branches.slowBranch.status).toBe('rejected');
			expect(result.branches.slowBranch.error).toContain('timed out');
			// fastBranch should have completed
			expect(result.branches.fastBranch.status).toBe('fulfilled');
		}, 10000);

		it('does not apply timeout when timeoutMs is not set', async () => {
			const result = await executeParallelBranches({
				branches: {
					branch: async () => ({ ok: true })
				}
			});

			expect(result.branches.branch.status).toBe('fulfilled');
		});
	});

	// ── edge cases ─────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('handles empty branches map', async () => {
			const result = await executeParallelBranches({ branches: {} });

			expect(result.totalCount).toBe(0);
			expect(result.successCount).toBe(0);
			expect(result.failureCount).toBe(0);
			expect(result.branches).toEqual({});
		});

		it('handles single branch', async () => {
			const result = await executeParallelBranches({
				branches: {
					onlyBranch: async () => ({ result: 42 })
				}
			});

			expect(result.totalCount).toBe(1);
			expect(result.successCount).toBe(1);
			expect(result.branches.onlyBranch.value).toEqual({ result: 42 });
		});

		it('handles branches returning undefined', async () => {
			const result = await executeParallelBranches({
				branches: {
					noReturn: async () => undefined
				}
			});

			expect(result.branches.noReturn.status).toBe('fulfilled');
			expect(result.branches.noReturn.value).toBeUndefined();
		});

		it('handles branches returning null', async () => {
			const result = await executeParallelBranches({
				branches: {
					nullReturn: async () => null
				}
			});

			expect(result.branches.nullReturn.status).toBe('fulfilled');
			expect(result.branches.nullReturn.value).toBeNull();
		});

		it('executes many branches concurrently', async () => {
			const branchCount = 20;
			const branches: Record<string, () => Promise<unknown>> = {};

			for (let i = 0; i < branchCount; i++) {
				branches[`branch-${i}`] = async () => ({ index: i });
			}

			const result = await executeParallelBranches({ branches });

			expect(result.totalCount).toBe(branchCount);
			expect(result.successCount).toBe(branchCount);
			expect(result.failureCount).toBe(0);
		});

		it('uses "all" as default merge strategy', async () => {
			const result = await executeParallelBranches({
				branches: {
					a: async () => 1,
					b: async () => 2
				}
				// mergeStrategy not specified
			});

			// With default 'all', we expect both branches to be present
			expect(result.totalCount).toBe(2);
		});
	});
});

// ── createParallelNode() factory ──────────────────────────────────────────

describe('createParallelNode', () => {
	it('creates a WorkflowNode with type parallel', () => {
		const node = createParallelNode('my-parallel', {
			branches: {
				fetchData: ['api-1', 'api-2'],
				processLocal: ['process-1']
			}
		});

		expect(node.id).toBe('my-parallel');
		expect(node.type).toBe('parallel');
	});

	it('stores branch node IDs in indexed format for executor compatibility', () => {
		const node = createParallelNode('p1', {
			branches: {
				alpha: ['a1', 'a2'],
				beta: ['b1']
			}
		});

		const data = node.data as { branchNodeIds: string[][]; branchNames: string[] };
		expect(data.branchNodeIds).toEqual([['a1', 'a2'], ['b1']]);
		expect(data.branchNames).toEqual(['alpha', 'beta']);
	});

	it('applies default merge strategy and error handling', () => {
		const node = createParallelNode('p1', {
			branches: { only: ['n1'] }
		});

		const data = node.data as { mergeStrategy: string; errorHandling: string };
		expect(data.mergeStrategy).toBe('all');
		expect(data.errorHandling).toBe('fail-fast');
	});

	it('stores custom merge strategy and error handling', () => {
		const node = createParallelNode('p1', {
			branches: { only: ['n1'] },
			mergeStrategy: 'any',
			errorHandling: 'collect-all',
			timeoutMs: 5000
		});

		const data = node.data as { mergeStrategy: string; errorHandling: string; timeoutMs?: number };
		expect(data.mergeStrategy).toBe('any');
		expect(data.errorHandling).toBe('collect-all');
		expect(data.timeoutMs).toBe(5000);
	});

	it('uses default position when not provided', () => {
		const node = createParallelNode('p1', { branches: { b: ['n1'] } });
		expect(node.position).toEqual({ x: 0, y: 0 });
	});

	it('accepts custom position', () => {
		const node = createParallelNode('p1', { branches: { b: ['n1'] } }, { x: 200, y: 300 });
		expect(node.position).toEqual({ x: 200, y: 300 });
	});
});

// ── parseParallelResults() ────────────────────────────────────────────────

describe('parseParallelResults', () => {
	it('maps indexed results to named branches', () => {
		const indexed = {
			'branch-0': { users: ['alice'] },
			'branch-1': { posts: [1, 2, 3] },
			'branch-2': { comments: ['great'] }
		};

		const named = parseParallelResults(indexed, ['fetchUsers', 'fetchPosts', 'fetchComments']);

		expect(named).toEqual({
			fetchUsers: { users: ['alice'] },
			fetchPosts: { posts: [1, 2, 3] },
			fetchComments: { comments: ['great'] }
		});
	});

	it('handles empty results', () => {
		const named = parseParallelResults({}, []);
		expect(named).toEqual({});
	});

	it('skips missing branches (index beyond result count)', () => {
		const indexed = { 'branch-0': { ok: true } };
		const named = parseParallelResults(indexed, ['first', 'missing']);

		expect(named.first).toEqual({ ok: true });
		expect('missing' in named).toBe(false);
	});
});

// ── isParallelNodeError() ─────────────────────────────────────────────────

describe('isParallelNodeError', () => {
	it('returns true for objects with string error field', () => {
		expect(isParallelNodeError({ error: 'Network timeout' })).toBe(true);
		expect(isParallelNodeError({ error: '' })).toBe(true);
	});

	it('returns false for non-error objects', () => {
		expect(isParallelNodeError({ data: 'success' })).toBe(false);
		expect(isParallelNodeError({ error: 42 })).toBe(false); // error must be string
		expect(isParallelNodeError(null)).toBe(false);
		expect(isParallelNodeError(undefined)).toBe(false);
		expect(isParallelNodeError('string')).toBe(false);
	});
});

// ── extractParallelErrors() ───────────────────────────────────────────────

describe('extractParallelErrors', () => {
	it('returns error messages for failed branches and null for successful ones', () => {
		const results = {
			successBranch: { data: 'ok' },
			failedBranch: { error: 'Connection refused' }
		};

		const errors = extractParallelErrors(results, ['successBranch', 'failedBranch']);

		expect(errors.successBranch).toBeNull();
		expect(errors.failedBranch).toBe('Connection refused');
	});

	it('returns all nulls when no branches failed', () => {
		const results = {
			a: { value: 1 },
			b: { value: 2 }
		};

		const errors = extractParallelErrors(results, ['a', 'b']);

		expect(errors.a).toBeNull();
		expect(errors.b).toBeNull();
	});

	it('handles empty branch list', () => {
		const errors = extractParallelErrors({}, []);
		expect(errors).toEqual({});
	});
});
