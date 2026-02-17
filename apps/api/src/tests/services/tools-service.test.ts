/**
 * Unit tests for the tools service — tool registry with definition
 * lookups, warning checks, approval logic, and execution delegation.
 *
 * Pure utility — no mocks needed. Tests validate the stub behavior
 * (providers are null), approval logic, and execution error handling.
 *
 * Source: apps/api/src/services/tools.ts (54 lines, 0 tests)
 */

import { describe, it, expect } from 'vitest';
import {
	getToolDefinition,
	getToolWarning,
	requiresApproval,
	executeTool
} from '../../services/tools.js';

// ── getToolDefinition ────────────────────────────────────────────────────

describe('getToolDefinition', () => {
	it('returns undefined when no provider is registered', () => {
		const result = getToolDefinition('list-instances');
		expect(result).toBeUndefined();
	});

	it('returns undefined for any tool name', () => {
		expect(getToolDefinition('')).toBeUndefined();
		expect(getToolDefinition('nonexistent')).toBeUndefined();
	});
});

// ── getToolWarning ───────────────────────────────────────────────────────

describe('getToolWarning', () => {
	it('returns undefined when no warning provider is registered', () => {
		const result = getToolWarning('delete-instance');
		expect(result).toBeUndefined();
	});
});

// ── requiresApproval ─────────────────────────────────────────────────────

describe('requiresApproval', () => {
	it('returns false for none level', () => {
		expect(requiresApproval('none')).toBe(false);
	});

	it('returns true for confirm level', () => {
		expect(requiresApproval('confirm')).toBe(true);
	});

	it('returns true for admin level', () => {
		expect(requiresApproval('admin')).toBe(true);
	});

	it('returns true for any non-none string', () => {
		expect(requiresApproval('danger')).toBe(true);
		expect(requiresApproval('auto')).toBe(true);
	});
});

// ── executeTool ──────────────────────────────────────────────────────────

describe('executeTool', () => {
	it('throws when no handler is registered', async () => {
		await expect(executeTool('list-instances', {})).rejects.toThrow(
			'No tool handler registered for execution'
		);
	});
});
