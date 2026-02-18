import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @mastra/core/agent before imports
vi.mock('@mastra/core/agent', () => ({
	Agent: vi.fn().mockImplementation(function (
		this: Record<string, unknown>,
		config: Record<string, unknown>
	) {
		this.id = config.id;
		this.name = config.name;
		this.instructions = config.instructions;
		this.model = config.model;
		this.tools = config.tools;
		this.memory = config.memory;
		this.scorers = config.scorers;
		this.inputProcessors = config.inputProcessors;
		this.outputProcessors = config.outputProcessors;
	})
}));

// Mock tools registry
vi.mock('../tools/registry.js', () => ({
	buildMastraTools: vi.fn(() => ({
		'list-instances': { id: 'list-instances' },
		'create-vcn': { id: 'create-vcn' }
	}))
}));

// Mock @mastra/evals/scorers/prebuilt
vi.mock('@mastra/evals/scorers/prebuilt', () => ({
	createFaithfulnessScorer: vi.fn(() => ({ id: 'faithfulness-scorer' })),
	createAnswerRelevancyScorer: vi.fn(() => ({ id: 'answer-relevancy-scorer' })),
	createPromptAlignmentScorerLLM: vi.fn(() => ({ id: 'prompt-alignment-scorer' })),
	createToxicityScorer: vi.fn(() => ({ id: 'toxicity-scorer' }))
}));

// Mock guardrails
vi.mock('./guardrails.js', () => ({
	promptInjectionDetector: { name: 'prompt-injection-detector' },
	piiDetector: { name: 'pii-detector' },
	createTokenLimiter: vi.fn(() => ({ name: 'token-limiter' })),
	createOutputTokenLimiter: vi.fn(() => ({ name: 'output-token-limiter' }))
}));

import {
	getSystemPrompt,
	createCharlieAgent,
	FALLBACK_MODEL_ALLOWLIST,
	DEFAULT_MODEL,
	type CharlieConfig
} from './charlie.js';
import { Agent } from '@mastra/core/agent';
import {
	createFaithfulnessScorer,
	createAnswerRelevancyScorer,
	createPromptAlignmentScorerLLM,
	createToxicityScorer
} from '@mastra/evals/scorers/prebuilt';

const MockAgent = vi.mocked(Agent);
const mockCreateFaithfulnessScorer = vi.mocked(createFaithfulnessScorer);
const mockCreateAnswerRelevancyScorer = vi.mocked(createAnswerRelevancyScorer);
const mockCreatePromptAlignmentScorerLLM = vi.mocked(createPromptAlignmentScorerLLM);
const mockCreateToxicityScorer = vi.mocked(createToxicityScorer);

// ── getSystemPrompt ──────────────────────────────────────────────────

describe('getSystemPrompt', () => {
	it('includes Charlie persona', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('Charlie');
		expect(prompt).toContain('Oracle Cloud Infrastructure');
	});

	it('includes compartment info when provided', () => {
		const prompt = getSystemPrompt('ocid1.compartment.test');
		expect(prompt).toContain('ocid1.compartment.test');
		expect(prompt).toContain('DEFAULT COMPARTMENT');
	});

	it('includes no-compartment note when not provided', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('No default compartment is configured');
		expect(prompt).toContain('listCompartments');
	});

	it('includes intent classification modes', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('KNOWLEDGE');
		expect(prompt).toContain('INQUIRY');
		expect(prompt).toContain('ACTION');
		expect(prompt).toContain('ANALYSIS');
		expect(prompt).toContain('EXPLORATION');
	});

	it('includes provisioning workflow steps', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('STEP 1: GATHER REQUIREMENTS');
		expect(prompt).toContain('STEP 2: COMPARE PRICING');
		expect(prompt).toContain('STEP 3: PROVISION');
	});

	it('includes tool usage reference', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('listInstances');
		expect(prompt).toContain('compareCloudCosts');
		expect(prompt).toContain('generateTerraform');
		expect(prompt).toContain('terminateInstance');
	});

	it('includes OCI expertise section', () => {
		const prompt = getSystemPrompt();
		expect(prompt).toContain('Flex shapes');
		expect(prompt).toContain('1 OCPU = 2 vCPUs');
		expect(prompt).toContain('10TB/month free');
		expect(prompt).toContain('eu-frankfurt-1');
	});
});

// ── Constants ─────────────────────────────────────────────────────────

describe('constants', () => {
	it('FALLBACK_MODEL_ALLOWLIST contains expected models', () => {
		expect(FALLBACK_MODEL_ALLOWLIST).toContain('google.gemini-2.5-flash');
		expect(FALLBACK_MODEL_ALLOWLIST).toContain('cohere.command-r-plus');
		expect(FALLBACK_MODEL_ALLOWLIST).toContain('meta.llama-3.3-70b');
		expect(FALLBACK_MODEL_ALLOWLIST.length).toBeGreaterThanOrEqual(5);
	});

	it('DEFAULT_MODEL is in the allowlist', () => {
		expect(FALLBACK_MODEL_ALLOWLIST).toContain(DEFAULT_MODEL);
	});

	it('DEFAULT_MODEL is gemini-2.5-flash', () => {
		expect(DEFAULT_MODEL).toBe('google.gemini-2.5-flash');
	});
});

// ── createCharlieAgent ──────────────────────────────────────────

describe('createCharlieAgent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates an Agent with correct id and name', () => {
		const config: CharlieConfig = { model: 'google.gemini-2.5-flash' };
		createCharlieAgent(config);

		expect(MockAgent).toHaveBeenCalledOnce();
		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.id).toBe('charlie');
		expect(agentConfig.name).toBe('Charlie');
	});

	it('passes the model from config', () => {
		createCharlieAgent({ model: 'cohere.command-r-plus' });

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.model).toBe('cohere.command-r-plus');
	});

	it('passes memory when provided', () => {
		const mockMemory = { recall: vi.fn() };
		createCharlieAgent({
			model: DEFAULT_MODEL,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			memory: mockMemory as any
		});

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.memory).toBe(mockMemory);
	});

	it('generates system prompt with compartmentId', () => {
		createCharlieAgent({
			model: DEFAULT_MODEL,
			compartmentId: 'ocid1.test.compartment'
		});

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.instructions).toContain('ocid1.test.compartment');
	});

	it('includes tools from buildMastraTools()', () => {
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.tools).toHaveProperty('list-instances');
		expect(agentConfig.tools).toHaveProperty('create-vcn');
	});

	it('includes inputProcessors and outputProcessors (guardrails)', () => {
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(Array.isArray(agentConfig.inputProcessors)).toBe(true);
		expect((agentConfig.inputProcessors as unknown[]).length).toBeGreaterThanOrEqual(2);
		expect(Array.isArray(agentConfig.outputProcessors)).toBe(true);
		expect((agentConfig.outputProcessors as unknown[]).length).toBeGreaterThanOrEqual(1);
	});
});

// ── eval scorers ─────────────────────────────────────────────────────

describe('eval scorers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset env vars
		delete process.env.MASTRA_ENABLE_EVALS;
		delete process.env.MASTRA_EVAL_SAMPLE_RATE;
	});

	it('configures faithfulness, answer-relevancy, prompt-alignment, and toxicity scorers by default', () => {
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		const scorers = agentConfig.scorers as Record<string, unknown>;

		expect(scorers).toBeDefined();
		expect(scorers).toHaveProperty('faithfulness');
		expect(scorers).toHaveProperty('answer-relevancy');
		expect(scorers).toHaveProperty('prompt-alignment');
		expect(scorers).toHaveProperty('toxicity');
	});

	it('calls createFaithfulnessScorer with model and scale 10', () => {
		createCharlieAgent({ model: 'google.gemini-2.5-flash' });

		expect(mockCreateFaithfulnessScorer).toHaveBeenCalledOnce();
		const args = mockCreateFaithfulnessScorer.mock.calls[0][0];
		expect(args.model).toBe('google.gemini-2.5-flash');
		expect(args.options?.scale).toBe(10);
	});

	it('calls createAnswerRelevancyScorer with model, scale 10, uncertaintyWeight 0.5', () => {
		createCharlieAgent({ model: 'google.gemini-2.5-flash' });

		expect(mockCreateAnswerRelevancyScorer).toHaveBeenCalledOnce();
		const args = mockCreateAnswerRelevancyScorer.mock.calls[0][0];
		expect(args.model).toBe('google.gemini-2.5-flash');
		expect(args.options?.scale).toBe(10);
		expect(args.options?.uncertaintyWeight).toBe(0.5);
	});

	it('calls createPromptAlignmentScorerLLM with model and scale 10', () => {
		createCharlieAgent({ model: 'google.gemini-2.5-flash' });

		expect(mockCreatePromptAlignmentScorerLLM).toHaveBeenCalledOnce();
		const args = mockCreatePromptAlignmentScorerLLM.mock.calls[0][0];
		expect(args.model).toBe('google.gemini-2.5-flash');
		expect(args.options?.scale).toBe(10);
	});

	it('calls createToxicityScorer with model and scale 10', () => {
		createCharlieAgent({ model: 'google.gemini-2.5-flash' });

		expect(mockCreateToxicityScorer).toHaveBeenCalledOnce();
		const args = mockCreateToxicityScorer.mock.calls[0][0];
		expect(args.model).toBe('google.gemini-2.5-flash');
		expect(args.options?.scale).toBe(10);
	});

	it('uses 10% sampling rate by default', () => {
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		const scorers = agentConfig.scorers as Record<
			string,
			{ sampling: { type: string; rate: number } }
		>;

		expect(scorers['faithfulness'].sampling.type).toBe('ratio');
		expect(scorers['faithfulness'].sampling.rate).toBe(0.1);
		expect(scorers['answer-relevancy'].sampling.rate).toBe(0.1);
		expect(scorers['prompt-alignment'].sampling.rate).toBe(0.1);
		expect(scorers['toxicity'].sampling.rate).toBe(0.1);
	});

	it('uses custom sample rate from MASTRA_EVAL_SAMPLE_RATE env var', () => {
		process.env.MASTRA_EVAL_SAMPLE_RATE = '0.25';
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		const scorers = agentConfig.scorers as Record<
			string,
			{ sampling: { type: string; rate: number } }
		>;
		expect(scorers['faithfulness'].sampling.rate).toBe(0.25);
		expect(scorers['toxicity'].sampling.rate).toBe(0.25);
	});

	it('disables scorers when MASTRA_ENABLE_EVALS=false', () => {
		process.env.MASTRA_ENABLE_EVALS = 'false';
		createCharlieAgent({ model: DEFAULT_MODEL });

		const agentConfig = MockAgent.mock.calls[0][0];
		expect(agentConfig.scorers).toBeUndefined();
	});

	it('does not call scorer factories when evals disabled', () => {
		process.env.MASTRA_ENABLE_EVALS = 'false';
		createCharlieAgent({ model: DEFAULT_MODEL });

		expect(mockCreateFaithfulnessScorer).not.toHaveBeenCalled();
		expect(mockCreateAnswerRelevancyScorer).not.toHaveBeenCalled();
		expect(mockCreatePromptAlignmentScorerLLM).not.toHaveBeenCalled();
		expect(mockCreateToxicityScorer).not.toHaveBeenCalled();
	});
});

// ── Sentry observability (mastra.ts plugin) ──────────────────────────
// Full integration tests are in tests/plugins/mastra.test.ts.
// Here we verify the Charlie agent is created regardless of Sentry config.
