import { describe, expect, it } from 'vitest';
import { createJiraConfig } from './jira.js';

describe('createJiraConfig', () => {
	it('creates stdio MCP config for Jira server', () => {
		const config = createJiraConfig({
			domain: 'example.atlassian.net',
			email: 'user@example.com',
			apiToken: 'test-token'
		});

		expect(config.type).toBe('stdio');
		if (config.type !== 'stdio') {
			throw new Error('Expected stdio config');
		}
		expect(config.command).toBe('npx');
		expect(config.args).toContain('@modelcontextprotocol/server-jira');
		expect(config.env).toEqual({
			JIRA_DOMAIN: 'example.atlassian.net',
			JIRA_EMAIL: 'user@example.com',
			JIRA_API_TOKEN: 'test-token'
		});
	});

	it('throws if required fields are missing', () => {
		expect(() => createJiraConfig({ domain: '', email: '', apiToken: '' })).toThrow(
			'JIRA_DOMAIN, JIRA_EMAIL, and JIRA_API_TOKEN are required'
		);
	});
});
