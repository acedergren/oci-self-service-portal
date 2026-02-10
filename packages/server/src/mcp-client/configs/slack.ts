import type { MCPServerConfig } from '../types';

export interface SlackOptions {
	botToken: string;
	teamId?: string;
}

export function createSlackConfig(options: SlackOptions): MCPServerConfig {
	if (!options.botToken || options.botToken.trim().length === 0) {
		throw new Error('SLACK_BOT_TOKEN is required');
	}

	return {
		type: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-slack'],
		env: {
			SLACK_BOT_TOKEN: options.botToken,
			...(options.teamId ? { SLACK_TEAM_ID: options.teamId } : {})
		}
	};
}
