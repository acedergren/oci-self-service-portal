/**
 * AI Step Node - Execute an AI language model step in a workflow
 *
 * This node calls an AI language model (via the provider registry) with a
 * configurable prompt template. Variable interpolation allows injecting
 * outputs from previous steps using {{nodeId.path.to.value}} syntax.
 *
 * Key features:
 * - Prompt template interpolation from previous step outputs
 * - Model selection via provider registry (defaults to 'oci:cohere.command-r-plus')
 * - Optional system prompt for role/context setting
 * - Optional output schema validation (forces JSON response + validates fields)
 * - Temperature and maxTokens configuration
 * - Retry support via the executor's withRetry mechanism
 */

import type { WorkflowNode } from '@portal/shared/workflows';

/**
 * Output schema specification for structured AI responses.
 * When provided, the AI response must be valid JSON matching this schema.
 * Each key maps to its expected type descriptor (used for documentation).
 */
export interface AIStepOutputSchema {
	[key: string]: 'string' | 'number' | 'boolean' | 'object' | 'array' | string;
}

/**
 * Configuration for an AI step node
 */
export interface AIStepNodeConfig {
	/**
	 * Prompt template. Supports {{nodeId.path}} variable interpolation.
	 * Example: "Summarize the instances in {{listInstances.data}}"
	 */
	prompt: string;
	/**
	 * System prompt for role/context setting.
	 * Example: "You are a cloud cost optimization expert."
	 */
	systemPrompt?: string;
	/**
	 * Model identifier in provider:model format.
	 * Defaults to 'oci:cohere.command-r-plus'.
	 * Example: 'anthropic:claude-3-5-sonnet-20241022'
	 */
	model?: string;
	/** Sampling temperature (0.0–1.0). Lower = more deterministic. */
	temperature?: number;
	/** Maximum output tokens */
	maxTokens?: number;
	/**
	 * Output schema for structured JSON responses.
	 * When provided, the AI must return valid JSON with these fields.
	 * Example: { summary: 'string', costSavings: 'number' }
	 */
	outputSchema?: AIStepOutputSchema;
}

/**
 * Create an AI step workflow node.
 *
 * The executor's executeAIStepNode() method processes this node type
 * by calling generateText() via the AI SDK with the configured model.
 * If outputSchema is provided, the response is parsed as JSON and validated.
 *
 * Example:
 * ```typescript
 * const node = createAIStepNode('summarize-1', {
 *   prompt: 'Analyze these OCI instances: {{listInstances.data}}',
 *   systemPrompt: 'You are a cloud cost advisor. Be concise.',
 *   model: 'oci:cohere.command-r-plus',
 *   temperature: 0.2,
 *   outputSchema: {
 *     summary: 'string',
 *     stoppedInstances: 'array',
 *     estimatedMonthlySavings: 'number'
 *   }
 * });
 * ```
 */
export function createAIStepNode(
	id: string,
	config: AIStepNodeConfig,
	position: { x: number; y: number } = { x: 0, y: 0 }
): WorkflowNode {
	return {
		id,
		type: 'ai-step',
		position,
		data: {
			prompt: config.prompt,
			systemPrompt: config.systemPrompt,
			model: config.model,
			temperature: config.temperature,
			maxTokens: config.maxTokens,
			outputSchema: config.outputSchema
		}
	};
}

/**
 * AI step result shape when no outputSchema is provided.
 * The raw text response and usage statistics from the model.
 */
export interface AIStepTextResult {
	text: string;
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
}

/**
 * Type guard: check if an AI step result is a raw text result (no schema)
 */
export function isAIStepTextResult(result: unknown): result is AIStepTextResult {
	return (
		typeof result === 'object' &&
		result !== null &&
		'text' in result &&
		typeof (result as Record<string, unknown>).text === 'string'
	);
}

/**
 * Build a prompt template string with named variable placeholders.
 *
 * This is a helper for constructing prompts that will be interpolated
 * by the executor at runtime. Variable paths follow {{nodeId.fieldPath}} syntax.
 *
 * Example:
 * ```typescript
 * const prompt = buildPromptTemplate(
 *   'Analyze the following compute instances and identify cost savings:',
 *   { instances: 'listInstances.data', region: 'input.region' }
 * );
 * // "Analyze the following...\ninstances: {{listInstances.data}}\nregion: {{input.region}}"
 * ```
 */
export function buildPromptTemplate(basePrompt: string, variables: Record<string, string>): string {
	const varLines = Object.entries(variables)
		.map(([label, path]) => `${label}: {{${path}}}`)
		.join('\n');

	return varLines ? `${basePrompt}\n${varLines}` : basePrompt;
}
