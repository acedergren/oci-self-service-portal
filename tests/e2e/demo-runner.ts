/**
 * OCI AI Chat - Automated Demo Runner
 *
 * This module provides automated demo capabilities using opencode-browser.
 * It can run pre-scripted demos with configurable pacing for live presentations.
 *
 * Usage:
 *   Import and call runDemo() with the desired scenario
 *   Each step can be paused for presenter commentary
 */

import type { BrowserTestContext, DemoScenario, DemoStep } from './types';

// ============================================================================
// DEMO SCENARIOS
// ============================================================================

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
	// Quick 5-minute executive demo
	executive: {
		id: 'executive',
		name: 'Executive Overview',
		description: 'Quick overview of portal capabilities for executives',
		estimatedDuration: 5,
		steps: [
			{
				id: '1',
				title: 'Portal Introduction',
				description: 'Navigate to the self-service portal',
				action: 'navigate',
				value: 'http://localhost:5173/self-service',
				talkingPoints: [
					'AI-powered cloud management portal',
					'Personalized experience with user recognition',
					'Natural language interface for all operations'
				]
			},
			{
				id: '2',
				title: 'Highlight Search',
				description: 'Show the AI search capability',
				action: 'highlight',
				selector: 'input[placeholder*="Ask"]',
				talkingPoints: [
					'Natural language queries',
					'No need to learn CLI commands',
					'AI understands OCI terminology'
				]
			},
			{
				id: '3',
				title: 'Quick Cost Comparison',
				description: 'Demonstrate cost comparison capability',
				action: 'click',
				selector: '.quick-link:nth-child(5)', // Compare OCI vs Azure
				talkingPoints: [
					'One-click access to cost analysis',
					'Compare with other cloud providers',
					'Make data-driven decisions'
				]
			},
			{
				id: '4',
				title: 'Wait for AI',
				description: 'Let AI respond',
				action: 'wait',
				duration: 5000,
				talkingPoints: [
					'AI asks clarifying questions',
					'Ensures accurate comparisons',
					'No guesswork - precise requirements'
				]
			},
			{
				id: '5',
				title: 'Capture Screenshot',
				description: 'Screenshot the AI response',
				action: 'screenshot',
				talkingPoints: ['Intelligent requirement gathering', 'Professional response format']
			}
		]
	},

	// Full technical demo
	technical: {
		id: 'technical',
		name: 'Technical Deep Dive',
		description: 'Comprehensive demo for technical audiences',
		estimatedDuration: 15,
		steps: [
			// Portal Overview
			{
				id: '1',
				title: 'Navigate to Portal',
				description: 'Open the self-service portal',
				action: 'navigate',
				value: 'http://localhost:5173/self-service',
				talkingPoints: [
					'Built with SvelteKit and AI SDK',
					'Real-time streaming responses',
					'Enterprise-grade UI design'
				]
			},
			{
				id: '2',
				title: 'Service Categories',
				description: 'Scroll to show all service categories',
				action: 'scroll',
				selector: '.services',
				talkingPoints: [
					'Six major OCI service categories',
					'Quick actions for common operations',
					'Context-aware tool selection'
				]
			},

			// Knowledge Query Demo
			{
				id: '3',
				title: 'Knowledge Query',
				description: 'Ask about OCI Free Tier',
				action: 'type',
				selector: 'input[placeholder*="Ask"]',
				value: 'What compute shapes are available in OCI Always Free tier?',
				talkingPoints: [
					'Knowledge queries use AI knowledge only',
					'No tool calls for informational requests',
					'Expert-level OCI knowledge'
				]
			},
			{
				id: '4',
				title: 'Submit Query',
				description: 'Submit the search',
				action: 'click',
				selector: 'button[type="submit"]'
			},
			{
				id: '5',
				title: 'Wait for Knowledge Response',
				description: 'Wait for AI to respond',
				action: 'wait',
				duration: 8000,
				talkingPoints: [
					'Pure AI response - no tool execution',
					'Comprehensive Free Tier information',
					'ARM shapes highlighted for best value'
				]
			},
			{
				id: '6',
				title: 'Screenshot Knowledge Response',
				description: 'Capture the response',
				action: 'screenshot'
			},
			{
				id: '7',
				title: 'Close Chat',
				description: 'Close the AI assistant',
				action: 'click',
				selector: '.command-close'
			},

			// Workflow Demo - Provision Web Server
			{
				id: '8',
				title: 'Wait for Animation',
				description: 'Let the overlay close',
				action: 'wait',
				duration: 500
			},
			{
				id: '9',
				title: 'Start Web Server Workflow',
				description: 'Click Provision Web Server workflow',
				action: 'click',
				selector: '.workflow-card:nth-child(2)',
				talkingPoints: [
					'Multi-step guided workflow',
					'8 steps from requirements to Terraform',
					'AI guides through each step'
				]
			},
			{
				id: '10',
				title: 'Wait for Requirement Gathering',
				description: 'Wait for AI to ask for requirements',
				action: 'wait',
				duration: 10000,
				talkingPoints: [
					'CRITICAL: AI asks questions FIRST',
					'No tools called without requirements',
					'Prevents failed provisioning attempts'
				]
			},
			{
				id: '11',
				title: 'Screenshot Requirements Question',
				description: 'Capture the requirement gathering',
				action: 'screenshot'
			},
			{
				id: '12',
				title: 'Provide Requirements',
				description: 'Enter web server specifications',
				action: 'type',
				selector: '.command-input input',
				value:
					'I need a web server in Frankfurt (eu-frankfurt-1) with 2 OCPUs and 16GB RAM running Oracle Linux 8 for a Node.js application.',
				talkingPoints: [
					'Natural language specifications',
					'AI understands region names',
					'Translates to correct shape family'
				]
			},
			{
				id: '13',
				title: 'Submit Requirements',
				description: 'Send the requirements',
				action: 'click',
				selector: '.command-input button[type="submit"]'
			},
			{
				id: '14',
				title: 'Wait for Tool Execution',
				description: 'Wait for tools to run',
				action: 'wait',
				duration: 20000,
				talkingPoints: [
					'AI now calls discovery tools',
					'Compartments, ADs, shapes, images',
					'Generates complete Terraform code'
				]
			},
			{
				id: '15',
				title: 'Final Screenshot',
				description: 'Capture the final result',
				action: 'screenshot',
				talkingPoints: [
					'Complete Terraform configuration',
					'Ready for review and deployment',
					'Infrastructure as Code output'
				]
			}
		]
	},

	// Cost comparison focused demo
	costComparison: {
		id: 'cost-comparison',
		name: 'Cloud Cost Comparison',
		description: 'Focused demo on OCI vs Azure pricing',
		estimatedDuration: 7,
		steps: [
			{
				id: '1',
				title: 'Navigate to Portal',
				description: 'Open the portal',
				action: 'navigate',
				value: 'http://localhost:5173/self-service'
			},
			{
				id: '2',
				title: 'Start Cost Workflow',
				description: 'Click Cloud Cost Analysis workflow',
				action: 'click',
				selector: '.workflow-card:first-child',
				talkingPoints: [
					'Automated cost comparison workflow',
					'Fetches real pricing from both clouds',
					'Accounts for Free Tier benefits'
				]
			},
			{
				id: '3',
				title: 'Wait for Requirements',
				description: 'AI asks for workload details',
				action: 'wait',
				duration: 8000,
				talkingPoints: [
					'AI gathers specific requirements',
					'vCPUs, memory, storage, egress',
					'Region-specific pricing'
				]
			},
			{
				id: '4',
				title: 'Screenshot Question',
				description: 'Capture the question',
				action: 'screenshot'
			},
			{
				id: '5',
				title: 'Provide Cost Requirements',
				description: 'Enter workload specifications',
				action: 'type',
				selector: '.command-input input',
				value:
					'Compare costs for 4 vCPU, 32GB RAM, 500GB storage, 100GB monthly egress, running 24/7 in Western Europe.'
			},
			{
				id: '6',
				title: 'Submit',
				description: 'Send the request',
				action: 'click',
				selector: '.command-input button[type="submit"]'
			},
			{
				id: '7',
				title: 'Wait for Comparison',
				description: 'Wait for pricing tools',
				action: 'wait',
				duration: 15000,
				talkingPoints: [
					'OCI pricing fetched via API',
					'Azure pricing from Retail Prices API',
					'AI calculates monthly totals'
				]
			},
			{
				id: '8',
				title: 'Final Screenshot',
				description: 'Capture comparison result',
				action: 'screenshot',
				talkingPoints: [
					'Side-by-side cost breakdown',
					'OCI typically 30-50% cheaper',
					'Includes optimization recommendations'
				]
			}
		]
	}
};

// ============================================================================
// DEMO RUNNER
// ============================================================================

export interface DemoRunnerOptions {
	/** Pause between steps for presenter (ms) */
	stepPause?: number;
	/** Auto-advance or wait for manual trigger */
	autoAdvance?: boolean;
	/** Callback for each step */
	onStep?: (step: DemoStep, index: number) => void;
	/** Callback for screenshots */
	onScreenshot?: (data: string, stepId: string) => void;
	/** Verbose logging */
	verbose?: boolean;
}

const DEFAULT_OPTIONS: DemoRunnerOptions = {
	stepPause: 2000,
	autoAdvance: true,
	verbose: true
};

/**
 * Run an automated demo scenario
 */
export async function runDemo(
	ctx: BrowserTestContext,
	scenarioId: string,
	options: DemoRunnerOptions = {}
): Promise<{ success: boolean; screenshots: string[]; errors: string[] }> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const scenario = DEMO_SCENARIOS[scenarioId];

	if (!scenario) {
		return {
			success: false,
			screenshots: [],
			errors: [`Unknown scenario: ${scenarioId}`]
		};
	}

	const screenshots: string[] = [];
	const errors: string[] = [];

	if (opts.verbose) {
		console.log(`\n🎬 Starting Demo: ${scenario.name}`);
		console.log(`   ${scenario.description}`);
		console.log(`   Estimated duration: ${scenario.estimatedDuration} minutes`);
		console.log(`   Steps: ${scenario.steps.length}\n`);
	}

	for (let i = 0; i < scenario.steps.length; i++) {
		const step = scenario.steps[i];

		if (opts.verbose) {
			console.log(`\n📍 Step ${i + 1}/${scenario.steps.length}: ${step.title}`);
			console.log(`   ${step.description}`);
			if (step.talkingPoints) {
				console.log('   💬 Talking points:');
				step.talkingPoints.forEach((point) => console.log(`      • ${point}`));
			}
		}

		opts.onStep?.(step, i);

		try {
			await executeStep(ctx, step, screenshots, opts);
		} catch (error) {
			const errorMsg = `Step ${i + 1} failed: ${error}`;
			errors.push(errorMsg);
			if (opts.verbose) {
				console.log(`   ❌ ${errorMsg}`);
			}
		}

		// Pause between steps
		if (opts.autoAdvance && i < scenario.steps.length - 1) {
			await ctx.browser_wait({ ms: opts.stepPause ?? 2000 });
		}
	}

	if (opts.verbose) {
		console.log(`\n✅ Demo complete!`);
		console.log(`   Screenshots captured: ${screenshots.length}`);
		console.log(`   Errors: ${errors.length}\n`);
	}

	return {
		success: errors.length === 0,
		screenshots,
		errors
	};
}

/**
 * Execute a single demo step
 */
async function executeStep(
	ctx: BrowserTestContext,
	step: DemoStep,
	screenshots: string[],
	opts: DemoRunnerOptions
): Promise<void> {
	switch (step.action) {
		case 'navigate':
			await ctx.browser_navigate({ url: step.value! });
			// Wait for page to load
			await ctx.browser_wait({ ms: 1500 });
			break;

		case 'click':
			await ctx.browser_click({
				selector: step.selector!,
				timeoutMs: 10000
			});
			break;

		case 'type':
			await ctx.browser_type({
				selector: step.selector!,
				text: step.value!,
				clear: true
			});
			break;

		case 'wait':
			await ctx.browser_wait({ ms: step.duration ?? 1000 });
			break;

		case 'screenshot': {
			const result = await ctx.browser_screenshot({});
			if (result?.data) {
				screenshots.push(result.data);
				opts.onScreenshot?.(result.data, step.id);
				if (opts.verbose) {
					console.log(`   📸 Screenshot captured`);
				}
			}
			break;
		}

		case 'scroll':
			await ctx.browser_scroll({ selector: step.selector });
			break;

		case 'highlight':
			// Highlighting is handled by the presenter
			// Just wait a moment for them to point it out
			await ctx.browser_wait({ ms: 500 });
			break;

		case 'speak':
			// Speaking points are handled by the presenter
			// This is just a pause point
			await ctx.browser_wait({ ms: step.duration ?? 2000 });
			break;
	}
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run the executive overview demo
 */
export async function runExecutiveDemo(ctx: BrowserTestContext, options?: DemoRunnerOptions) {
	return runDemo(ctx, 'executive', options);
}

/**
 * Run the full technical demo
 */
export async function runTechnicalDemo(ctx: BrowserTestContext, options?: DemoRunnerOptions) {
	return runDemo(ctx, 'technical', options);
}

/**
 * Run the cost comparison demo
 */
export async function runCostComparisonDemo(ctx: BrowserTestContext, options?: DemoRunnerOptions) {
	return runDemo(ctx, 'costComparison', options);
}

/**
 * List available demo scenarios
 */
export function listDemoScenarios(): Array<{
	id: string;
	name: string;
	description: string;
	duration: number;
	steps: number;
}> {
	return Object.values(DEMO_SCENARIOS).map((s) => ({
		id: s.id,
		name: s.name,
		description: s.description,
		duration: s.estimatedDuration,
		steps: s.steps.length
	}));
}
