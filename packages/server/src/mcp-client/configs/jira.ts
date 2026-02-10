import type { MCPServerConfig } from '../types';

export interface JiraOptions {
	domain: string;
	email: string;
	apiToken: string;
}

export function createJiraConfig(options: JiraOptions): MCPServerConfig {
	if (!options.domain || !options.email || !options.apiToken) {
		throw new Error('JIRA_DOMAIN, JIRA_EMAIL, and JIRA_API_TOKEN are required');
	}

	return {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-jira'],
		env: {
			JIRA_DOMAIN: options.domain,
			JIRA_EMAIL: options.email,
			JIRA_API_TOKEN: options.apiToken
		}
	};
}
