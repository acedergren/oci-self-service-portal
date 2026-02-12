type TextEvent = { type: 'text'; text: string };
type UsageEvent = { type: 'usage'; usage: { promptTokens?: number; completionTokens?: number } };

export interface ToolCallPayload {
	id: string;
	tool: string;
	args?: Record<string, unknown>;
}

export interface ToolResultPayload {
	id: string;
	ok?: boolean;
	result?: unknown;
	error?: unknown;
}

type ToolCallEvent = { type: 'toolCall'; call: ToolCallPayload };
type ToolResultEvent = { type: 'toolResult'; result: ToolResultPayload };

export type ParsedStreamEvent = TextEvent | UsageEvent | ToolCallEvent | ToolResultEvent | null;

const TEXT_PREFIX = '0:';
const TOOL_CALL_PREFIX = '9:';
const TOOL_RESULT_PREFIX = 'a:';
const DONE_PREFIX = 'd:';

function clampNumber(
	value: number | undefined,
	min: number,
	max: number,
	fallback: number
): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return fallback;
	}
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

function safeJsonParse<T>(value: string): T | null {
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

export function parseStreamLine(line: string): ParsedStreamEvent {
	if (!line) return null;
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith(TEXT_PREFIX)) {
		const text = safeJsonParse<string>(trimmed.slice(TEXT_PREFIX.length));
		return text ? { type: 'text', text } : null;
	}
	if (trimmed.startsWith(TOOL_CALL_PREFIX)) {
		const payload = safeJsonParse<ToolCallPayload>(trimmed.slice(TOOL_CALL_PREFIX.length));
		return payload ? { type: 'toolCall', call: payload } : null;
	}
	if (trimmed.startsWith(TOOL_RESULT_PREFIX)) {
		const payload = safeJsonParse<ToolResultPayload>(trimmed.slice(TOOL_RESULT_PREFIX.length));
		return payload ? { type: 'toolResult', result: payload } : null;
	}
	if (trimmed.startsWith(DONE_PREFIX)) {
		const payload = safeJsonParse<{ usage?: { promptTokens?: number; completionTokens?: number } }>(
			trimmed.slice(DONE_PREFIX.length)
		);
		return payload?.usage ? { type: 'usage', usage: payload.usage } : null;
	}
	return null;
}

export type ToolStatus = 'running' | 'success' | 'error';

export interface ToolTimelineEntry {
	id: string;
	tool: string;
	args?: Record<string, unknown>;
	result?: unknown;
	error?: unknown;
	status: ToolStatus;
	startedAt?: number;
	finishedAt?: number | null;
	durationMs?: number;
}

export interface ToolTimelineState {
	entries: Record<string, ToolTimelineEntry>;
	order: string[];
}

export function createToolTimelineState(): ToolTimelineState {
	return {
		entries: {},
		order: []
	};
}

export function updateToolTimeline(
	state: ToolTimelineState,
	event: ToolCallEvent | ToolResultEvent,
	timestamp: number
): ToolTimelineState {
	if (event.type === 'toolCall') {
		const alreadyExists = state.entries[event.call.id];
		const nextEntry: ToolTimelineEntry = {
			id: event.call.id,
			tool: event.call.tool,
			args: event.call.args,
			status: 'running',
			startedAt: timestamp,
			finishedAt: null
		};
		return {
			entries: {
				...state.entries,
				[event.call.id]: alreadyExists ? { ...alreadyExists, ...nextEntry } : nextEntry
			},
			order: alreadyExists ? state.order : [...state.order, event.call.id]
		};
	}

	const existing = state.entries[event.result.id];
	if (!existing) return state;
	const finishedAt = timestamp;
	const durationMs = existing.startedAt ? Math.max(finishedAt - existing.startedAt, 0) : undefined;
	return {
		entries: {
			...state.entries,
			[event.result.id]: {
				...existing,
				status: event.result.ok === false ? 'error' : 'success',
				result: event.result.result,
				error: event.result.error,
				finishedAt,
				durationMs
			}
		},
		order: state.order
	};
}

export interface ChatConfigInput {
	agentId?: string;
	model?: string;
	systemPrompt?: string;
	temperature: number;
	topP: number;
}

export interface ChatMessageInput {
	role: 'user' | 'assistant';
	content: string;
}

export function buildChatRequestPayload(
	messages: ChatMessageInput[],
	config: ChatConfigInput
): Record<string, unknown> {
	const temperature = clampNumber(config.temperature, 0, 2, 1);
	const topP = clampNumber(config.topP, 0, 1, 1);
	const payload: Record<string, unknown> = {
		messages,
		temperature,
		topP
	};
	if (config.agentId) payload.agentId = config.agentId;
	if (config.model) payload.model = config.model;
	if (config.systemPrompt?.trim()) payload.system = config.systemPrompt.trim();
	return payload;
}
