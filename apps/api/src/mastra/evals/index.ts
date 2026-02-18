/**
 * Mastra Evals Configuration
 *
 * TODO: Install @mastra/evals when available:
 *   pnpm --filter @portal/api add @mastra/evals
 *
 * Planned configuration:
 * - relevancy scorer at 10% sampling on Charlie agent
 * - toxicity scorer at 10% sampling on Charlie agent
 * - Results visible in Mastra Studio dashboard
 *
 * See: https://mastra.ai/docs/evals
 */

export const evalsConfig = {
	samplingRate: 0.1,
	scorers: ['relevancy', 'toxicity'],
	agentId: 'charlie'
} as const;
