import { describe, expect, it } from 'vitest';
import { createPagerDutyConfig } from './pagerduty.js';

describe('createPagerDutyConfig', () => {
	it('creates stdio MCP config for PagerDuty server', () => {
		const config = createPagerDutyConfig({ apiKey: 'test-key' });

		expect(config.type).toBe('stdio');
		expect(config.command).toBe('npx');
		expect(config.args).toContain('-y');
		expect(config.args).toContain('@modelcontextprotocol/server-pagerduty');
		expect(config.env).toEqual({ PAGERDUTY_API_KEY: 'test-key' });
	});

	it('throws if apiKey is missing', () => {
		expect(() => createPagerDutyConfig({ apiKey: '' })).toThrow('PAGERDUTY_API_KEY is required');
	});
});
