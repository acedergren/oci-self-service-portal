export type ToolExecutionResult = {
	raw: string;
	parsed: unknown;
};

export type OutputMode = 'slimmed' | 'raw';

export function shouldShowApprovalWarning(level?: string | null): boolean {
	if (!level) return false;
	return level === 'dangerous' || level === 'critical';
}

function stringify(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function extractSlimmedPayload(parsed: unknown): unknown {
	if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
		return (parsed as Record<string, unknown>).data;
	}
	return parsed;
}

export function buildResultViews(result: ToolExecutionResult | null): {
	raw: string;
	slimmed: string;
} {
	if (!result) {
		return { raw: '', slimmed: '' };
	}
	const slimmedSource = extractSlimmedPayload(result.parsed);
	const slimmed = stringify(slimmedSource);
	return {
		raw: result.raw || slimmed,
		slimmed: slimmed || result.raw
	};
}
