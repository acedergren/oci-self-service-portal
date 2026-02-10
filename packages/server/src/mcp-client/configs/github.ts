import type { MCPServerConfig } from '../types';

export interface GitHubOptions {
	token: string;
}

export function createGitHubConfig(options: GitHubOptions): MCPServerConfig {
	if (!options.token || options.token.trim().length === 0) {
		throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is required');
	}

	return {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: {
			GITHUB_PERSONAL_ACCESS_TOKEN: options.token
		}
	};
}
