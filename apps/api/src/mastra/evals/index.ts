/**
 * @mastra/evals Configuration for CloudNow Agent Quality Monitoring
 *
 * Purpose: Configure eval scorers for the Charlie agent to track output quality
 * and safety in production. Scorers evaluate each agent response using LLM-based metrics.
 *
 * Scorers configured:
 * - relevancy: Measures how relevant the answer is to the user's question (0-10 scale)
 * - toxicity: Detects harmful, offensive, or unsafe content in responses (0-10 scale)
 *
 * Sampling Rate: 10% in production (configurable via MASTRA_EVAL_SAMPLE_RATE)
 * - Reduces LLM inference costs for scoring
 * - Provides statistical confidence with minimal overhead
 * - Results visible in Mastra Studio for review and analysis
 *
 * Environment Variables:
 * - MASTRA_EVAL_SAMPLE_RATE: Sampling ratio (default: 0.1 = 10%)
 * - MASTRA_ENABLE_EVALS: Enable/disable evals (default: true)
 *
 * Database Recording:
 * - Scorer results are automatically persisted to the `ai_agent_evals` table
 * - Viewable in admin dashboard and Mastra Studio analytics
 *
 * Cost Considerations:
 * - Each scorer invocation = 1 LLM call (~0.1-0.5 cents per call at gpt-4o-mini rates)
 * - 10% sampling = ~10 LLM calls per 100 agent interactions
 * - Estimated cost: $0.01-0.05 per 100 interactions
 * - Disabled in test environments to avoid API costs
 *
 * Usage (integrated in Charlie agent factory):
 *
 * ```typescript
 * import { createCharlieAgent } from './agents/charlie.js';
 *
 * const agent = createCharlieAgent({
 *   model: 'google.gemini-2.5-flash',
 *   memory,
 *   compartmentId
 * });
 * // Scorers automatically configured with 10% sampling
 * const result = await agent.stream(messages);
 * // Scorer results persisted to database
 * ```
 */

import type { MastraModelConfig } from '@mastra/core/llm';
import { createAnswerRelevancyScorer, createToxicityScorer } from '@mastra/evals/scorers/prebuilt';

/**
 * Create eval scorers configuration for agent quality monitoring.
 *
 * @param model - Model to use for scoring (should be fast + cheap like gpt-4o-mini)
 * @param sampleRate - Sampling ratio (0.0-1.0, default: 0.1 for 10%)
 * @returns Scorers map with relevancy and toxicity evaluation
 */
export function createEvalScorers(
	model: MastraModelConfig,
	sampleRate = Number(process.env.MASTRA_EVAL_SAMPLE_RATE) || 0.1
) {
	return {
		relevancy: {
			scorer: createAnswerRelevancyScorer({
				model,
				options: {
					scale: 10,
					uncertaintyWeight: 0.5
				}
			}),
			sampling: { type: 'ratio' as const, rate: sampleRate }
		},
		toxicity: {
			scorer: createToxicityScorer({
				model,
				options: { scale: 10 }
			}),
			sampling: { type: 'ratio' as const, rate: sampleRate }
		}
	};
}

/**
 * Check if evals should be enabled in current environment.
 *
 * @returns true if evals are enabled (default), false if disabled
 */
export function isEvalsEnabled(): boolean {
	return process.env.MASTRA_ENABLE_EVALS !== 'false';
}

/**
 * Get current eval sampling rate from environment.
 *
 * @returns Sampling rate (0.0-1.0), default 0.1 (10%)
 */
export function getEvalSampleRate(): number {
	const rate = Number(process.env.MASTRA_EVAL_SAMPLE_RATE);
	return !isNaN(rate) ? Math.max(0, Math.min(1, rate)) : 0.1;
}
