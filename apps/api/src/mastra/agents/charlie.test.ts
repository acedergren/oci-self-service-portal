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
	})
}));

// Mock tools registry
vi.mock('../tools/registry.js', () => ({
	buildMastraTools: vi.fn(() => ({
		'list-instances': { id: 'list-instances' },
		'create-vcn': { id: 'create-vcn' }
	}))
}));

import {
	getSystemPrompt,
	createCharlieAgent,
	FALLBACK_MODEL_ALLOWLIST,
	DEFAULT_MODEL,
	type CharlieConfig
} from './charlie.js';
import { Agent } from '@mastra/core/agent';

const MockAgent = vi.mocked(Agent);

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
});
