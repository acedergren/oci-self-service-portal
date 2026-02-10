import { Chat } from '@ai-sdk/svelte';
import { DefaultChatTransport } from 'ai';
import { z } from 'zod';
import { setContext, getContext } from 'svelte';
import type { ToolCall, PendingApproval, ToolProgressEvent } from '@portal/shared/tools/types';
import { extractToolParts, getToolState, formatToolName } from '$lib/utils/message-parts.js';

const AI_CONTEXT_KEY = Symbol('ai-context');

export interface ChatContextOptions {
	api?: string;
	customFetch?: typeof fetch;
}

/**
 * Zod schema for validating incoming `data-tool-progress` stream parts.
 * Registered with the Chat instance via `dataPartSchemas`.
 */
const toolProgressSchema = z.object({
	toolCallId: z.string(),
	toolName: z.string(),
	stage: z.enum(['queued', 'executing', 'completed', 'error']),
	message: z.string(),
	startedAt: z.number().optional(),
	completedAt: z.number().optional()
});

/**
 * Reactive chat context class that encapsulates AI SDK Chat state.
 * Uses Svelte 5 runes for fine-grained reactivity — any component
 * reading a field will re-render when that specific value changes.
 */
export class ChatContext {
	chat: Chat;

	// Agent state
	currentThought = $state<string | undefined>(undefined);
	reasoningSteps = $state<Array<{ id: string; content: string; timestamp: number }>>([]);
	pendingApproval = $state<PendingApproval | undefined>(undefined);
	isExecutingApproval = $state(false);
	fetchingApprovalFor = $state<string | null>(null);

	// Tool progress tracking — populated by server-sent data-tool-progress parts
	toolProgress = $state<Map<string, ToolProgressEvent>>(new Map());

	// Derived status flags from Chat instance
	readonly isLoading = $derived(
		this.chat.status === 'submitted' || this.chat.status === 'streaming'
	);
	readonly isThinking = $derived(this.chat.status === 'submitted');
	readonly isStreaming = $derived(this.chat.status === 'streaming');

	// Derived tool calls from all assistant messages
	readonly toolCalls: ToolCall[] = $derived.by(() => {
		const messages = this.chat.messages;
		if (messages.length === 0) return [];

		const allToolParts: ToolCall[] = [];
		for (const msg of messages) {
			if (msg.role !== 'assistant') continue;
			const parts = extractToolParts(msg.parts as Array<{ type: string; [key: string]: unknown }>);
			for (const part of parts) {
				allToolParts.push({
					id: part.toolCallId,
					name: formatToolName(part.type),
					args: (part.input ?? {}) as Record<string, unknown>,
					status: getToolState(part.state),
					startedAt: Date.now(),
					completedAt: part.state === 'result' ? Date.now() : undefined
				});
			}
		}
		return allToolParts;
	});

	// The currently executing tool's progress (most recent executing event)
	readonly activeProgress: ToolProgressEvent | undefined = $derived.by(() => {
		for (const progress of this.toolProgress.values()) {
			if (progress.stage === 'executing') return progress;
		}
		return undefined;
	});

	constructor(options: ChatContextOptions = {}) {
		this.chat = new Chat({
			transport: new DefaultChatTransport({
				api: options.api ?? '/api/chat',
				fetch: options.customFetch ?? fetch
			}),
			dataPartSchemas: {
				'tool-progress': toolProgressSchema
			},
			onData: (part) => {
				if (part.type === 'data-tool-progress') {
					const event = part.data as ToolProgressEvent;
					// Reactive map update: create new Map to trigger reactivity
					const next = new Map(this.toolProgress);
					next.set(event.toolCallId, event);
					this.toolProgress = next;
				}
			}
		});
	}

	/** Get progress for a specific tool call */
	getToolProgress(toolCallId: string): ToolProgressEvent | undefined {
		return this.toolProgress.get(toolCallId);
	}

	sendMessage(text: string) {
		this.chat.sendMessage({ text });
	}

	clearAgentState() {
		this.currentThought = undefined;
		this.reasoningSteps = [];
		this.pendingApproval = undefined;
		this.toolProgress = new Map();
	}
}

/**
 * Create a ChatContext and register it in the Svelte component tree.
 * Must be called during component initialization (not in event handlers).
 */
export function createChatContext(options: ChatContextOptions = {}): ChatContext {
	const ctx = new ChatContext(options);
	setContext(AI_CONTEXT_KEY, ctx);
	return ctx;
}

/**
 * Retrieve the ChatContext from a parent component.
 * Must be called during component initialization.
 */
export function getChatContext(): ChatContext {
	return getContext<ChatContext>(AI_CONTEXT_KEY);
}

/**
 * Safe variant that returns undefined when no ChatContext is in the tree.
 * Useful for components that may render outside the ChatContext provider.
 */
export function tryGetChatContext(): ChatContext | undefined {
	return getContext<ChatContext | undefined>(AI_CONTEXT_KEY);
}
