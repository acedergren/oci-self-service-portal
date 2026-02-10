import type { MCPServerConfig } from '../types';

export interface PagerDutyOptions {
	apiKey: string;
}

export function createPagerDutyConfig(options: PagerDutyOptions): MCPServerConfig {
	if (!options.apiKey || options.apiKey.trim().length === 0) {
		throw new Error('PAGERDUTY_API_KEY is required');
	}

	return {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-pagerduty'],
		env: {
			PAGERDUTY_API_KEY: options.apiKey
		}
	};
}
