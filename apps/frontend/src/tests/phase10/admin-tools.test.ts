import { describe, it, expect } from 'vitest';
import {
	buildResultViews,
	shouldShowApprovalWarning,
	type ToolExecutionResult
} from '../../routes/admin/tools/playground/result-view.js';

describe('shouldShowApprovalWarning', () => {
	it('flags dangerous and critical levels', () => {
		expect(shouldShowApprovalWarning('dangerous')).toBe(true);
		expect(shouldShowApprovalWarning('critical')).toBe(true);
		expect(shouldShowApprovalWarning('confirm')).toBe(false);
		expect(shouldShowApprovalWarning(undefined)).toBe(false);
	});
});

describe('buildResultViews', () => {
	it('prefers slimmed data payload when available', () => {
		const result: ToolExecutionResult = {
			raw: JSON.stringify({ success: true, data: { id: 'bucket', region: 'phx' } }),
			parsed: { success: true, data: { id: 'bucket', region: 'phx' } }
		};
		const views = buildResultViews(result);
		expect(views.slimmed).toContain('"id"');
		expect(views.slimmed).not.toContain('success');
		expect(views.raw).toContain('success');
	});

	it('falls back to raw payload when slimmed result is empty', () => {
		const result: ToolExecutionResult = {
			raw: 'line:1 column:2 error',
			parsed: 'line:1 column:2 error'
		};
		const views = buildResultViews(result);
		expect(views.slimmed).toContain('error');
		expect(views.raw).toContain('error');
	});
});
