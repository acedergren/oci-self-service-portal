/**
 * Unit tests for the approval service — single-use approval tokens
 * with 5-minute expiry, managed in-memory.
 *
 * Pure utility — no mocks needed. Uses vi.useFakeTimers() to test
 * expiry behaviour without waiting 5 real minutes.
 *
 * Source: apps/api/src/services/approvals.ts (105 lines, 0 direct tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	recordApproval,
	consumeApproval,
	pendingApprovals,
	_resetApprovals
} from '../../services/approvals.js';

beforeEach(() => {
	_resetApprovals();
});

// ── Smoke test ──────────────────────────────────────────────────────────

describe('approvals (smoke)', () => {
	it('records and consumes an approval token', async () => {
		await recordApproval('call-1', 'list-instances');
		const result = await consumeApproval('call-1', 'list-instances');
		expect(result).toBe(true);
	});
});

// ── recordApproval + consumeApproval ────────────────────────────────────

describe('recordApproval + consumeApproval', () => {
	it('returns true on valid consume', async () => {
		await recordApproval('call-A', 'create-vcn');
		expect(await consumeApproval('call-A', 'create-vcn')).toBe(true);
	});

	it('single-use: second consume returns false', async () => {
		await recordApproval('call-B', 'delete-instance');
		await consumeApproval('call-B', 'delete-instance');
		expect(await consumeApproval('call-B', 'delete-instance')).toBe(false);
	});

	it('returns false for wrong tool name', async () => {
		await recordApproval('call-C', 'list-instances');
		expect(await consumeApproval('call-C', 'create-vcn')).toBe(false);
	});

	it('returns false for unknown toolCallId', async () => {
		expect(await consumeApproval('nonexistent', 'list-instances')).toBe(false);
	});
});

// ── Expiry ──────────────────────────────────────────────────────────────

describe('expiry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns true within 5-minute window', async () => {
		await recordApproval('call-D', 'list-instances');

		// Advance 4 minutes 59 seconds
		vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);

		expect(await consumeApproval('call-D', 'list-instances')).toBe(true);
	});

	it('returns false after 5-minute expiry', async () => {
		await recordApproval('call-E', 'list-instances');

		// Advance 5 minutes + 1ms
		vi.advanceTimersByTime(5 * 60 * 1000 + 1);

		expect(await consumeApproval('call-E', 'list-instances')).toBe(false);
	});
});

// ── _resetApprovals ─────────────────────────────────────────────────────

describe('_resetApprovals()', () => {
	it('clears all approval records', async () => {
		await recordApproval('call-F', 'tool-1');
		await recordApproval('call-G', 'tool-2');

		_resetApprovals();

		expect(await consumeApproval('call-F', 'tool-1')).toBe(false);
		expect(await consumeApproval('call-G', 'tool-2')).toBe(false);
	});

	it('clears pending approvals map', () => {
		// Add a pending approval directly (simulating a waiting tool call)
		pendingApprovals.set('pending-1', {
			toolName: 'test',
			args: {},
			createdAt: Date.now(),
			resolve: () => {}
		});

		_resetApprovals();
		expect(pendingApprovals.size).toBe(0);
	});
});

// ── Pending approvals map ───────────────────────────────────────────────

describe('pendingApprovals', () => {
	it('is exported and starts empty after reset', () => {
		expect(pendingApprovals).toBeInstanceOf(Map);
		expect(pendingApprovals.size).toBe(0);
	});

	it('can hold entries that represent waiting tool calls', () => {
		const mockResolve = vi.fn();
		pendingApprovals.set('call-H', {
			toolName: 'delete-vcn',
			args: { vcnId: 'vcn-123' },
			sessionId: 'session-1',
			orgId: 'org-1',
			createdAt: Date.now(),
			resolve: mockResolve
		});

		expect(pendingApprovals.has('call-H')).toBe(true);
		const entry = pendingApprovals.get('call-H')!;
		expect(entry.toolName).toBe('delete-vcn');
		expect(entry.args).toEqual({ vcnId: 'vcn-123' });
	});
});
