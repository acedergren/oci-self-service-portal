import { describe, it, expect, vi } from 'vitest';
import { safeParseJSON } from './mcp-types.js';

describe('safeParseJSON', () => {
	it('returns fallback + warning when JSON is invalid', () => {
		const warn = vi.fn();
		const { ok, value, error } = safeParseJSON('{"oops"', {}, { field: 'config', log: { warn } });
		expect(ok).toBe(false);
		expect(value).toEqual({});
		expect(error?.message).toContain('Invalid JSON');
		expect(warn).toHaveBeenCalled();
	});
});
