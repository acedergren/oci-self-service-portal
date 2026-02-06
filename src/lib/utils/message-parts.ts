// src/lib/utils/message-parts.ts
export interface ToolPart {
	type: string;
	toolCallId: string;
	state: string;
	input?: unknown;
	output?: unknown;
	title?: string;
}

/**
 * Extract tool parts from a message parts array
 */
export function extractToolParts(
	parts: Array<{ type: string; [key: string]: unknown }>
): ToolPart[] {
	return parts
		.filter((part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool')
		.map((part) => ({
			type: part.type as string,
			toolCallId: part.toolCallId as string,
			state: part.state as string,
			input: part.input,
			output: part.output,
			title: part.title as string | undefined
		}));
}

/**
 * Map AI SDK tool states to UI states
 */
export function getToolState(
	aiSdkState: string
): 'streaming' | 'pending' | 'running' | 'completed' | 'error' {
	switch (aiSdkState) {
		case 'input-streaming':
			return 'streaming';
		case 'input-available':
			return 'pending';
		case 'result':
			return 'completed';
		default:
			return 'running';
	}
}

/**
 * Format tool type to display name
 */
export function formatToolName(toolType: string): string {
	if (toolType === 'dynamic-tool') return toolType;
	return toolType.replace('tool-', '');
}
