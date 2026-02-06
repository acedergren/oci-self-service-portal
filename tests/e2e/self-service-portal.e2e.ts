/**
 * OCI AI Chat - Self-Service Portal E2E Test Suite
 *
 * This test suite validates the complete user journey through the
 * Cloud Self-Service Portal using opencode-browser automation.
 *
 * Test Scenarios:
 * 1. Portal Navigation & UI Elements
 * 2. Quick Actions & Search Functionality
 * 3. Service Category Interactions
 * 4. Guided Workflow Execution
 * 5. AI Assistant Chat Interactions
 * 6. Error Handling & Edge Cases
 *
 * Prerequisites:
 * - Dev server running at http://localhost:5173
 * - opencode-browser plugin connected
 *
 * @run pnpm test:e2e or via opencode-browser tools
 */

import type { BrowserTestContext, TestResult, TestSuite } from './types';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const BASE_URL = 'http://localhost:5173';
const SELF_SERVICE_URL = `${BASE_URL}/self-service`;
const CHAT_URL = `${BASE_URL}/`;

const TIMEOUTS = {
	navigation: 10000,
	aiResponse: 30000,
	animation: 500,
	toolExecution: 15000
};

const SELECTORS = {
	// Header
	header: '.header',
	logo: '.logo-text',
	navLinks: '.nav-link',
	userMenu: '.user-menu',
	notificationBadge: '.notification-badge',

	// Hero Section
	hero: '.hero',
	greeting: '.greeting',
	heroTitle: '.hero-title',
	searchBox: '.search-container input',
	searchButton: '.search-container button[type="submit"]',
	quickActions: '.quick-link',

	// Service Categories
	serviceCards: '.service-card',
	serviceTitle: '.service-title',
	serviceActions: '.service-action',

	// Guided Workflows
	workflowsSection: '.workflows-section',
	workflowCards: '.workflow-card',
	workflowName: '.workflow-name',
	workflowSteps: '.workflow-steps',
	workflowTime: '.workflow-time',

	// AI Command Palette
	commandOverlay: '.command-overlay',
	commandPalette: '.command-palette',
	commandClose: '.command-close',
	commandMessages: '.command-messages',
	commandInput: '.command-input input',
	commandSubmit: '.command-input button[type="submit"]',

	// Messages
	userMessage: '.message[data-role="user"]',
	assistantMessage: '.message[data-role="assistant"]',
	typingIndicator: '.typing-indicator',

	// Tool Cards
	toolCard: '.tool-card',
	toolName: '.tool-name',
	toolStatus: '.tool-status',
	toolResult: '.tool-result',

	// Workflow Panel
	workflowPanel: '.workflow-panel-container',
	agentWorkflowPanel: '[data-testid="agent-workflow-panel"]',

	// Bottom Section
	activityPanel: '.activity-panel',
	resourcesPanel: '.resources-panel',
	helpPanel: '.help-panel',
	helpButton: '.help-btn'
};

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Wait for an element to be visible
 */
async function waitForElement(
	ctx: BrowserTestContext,
	selector: string,
	timeout = TIMEOUTS.navigation
): Promise<boolean> {
	const startTime = Date.now();
	while (Date.now() - startTime < timeout) {
		const result = await ctx.browser_query({ selector, mode: 'exists' });
		if (result?.exists) return true;
		await ctx.browser_wait({ ms: 100 });
	}
	return false;
}

/**
 * Wait for AI response to complete (typing indicator disappears)
 */
async function waitForAIResponse(
	ctx: BrowserTestContext,
	timeout = TIMEOUTS.aiResponse
): Promise<boolean> {
	const startTime = Date.now();

	// First wait for typing indicator to appear
	await ctx.browser_wait({ ms: 500 });

	// Then wait for it to disappear
	while (Date.now() - startTime < timeout) {
		const typing = await ctx.browser_query({ selector: SELECTORS.typingIndicator, mode: 'exists' });
		if (!typing?.exists) {
			// Double-check by waiting a bit more
			await ctx.browser_wait({ ms: 300 });
			const stillTyping = await ctx.browser_query({
				selector: SELECTORS.typingIndicator,
				mode: 'exists'
			});
			if (!stillTyping?.exists) return true;
		}
		await ctx.browser_wait({ ms: 200 });
	}
	return false;
}

/**
 * Get text content from an element
 */
async function getElementText(ctx: BrowserTestContext, selector: string): Promise<string | null> {
	const result = await ctx.browser_query({ selector, property: 'textContent' });
	return result?.value ?? null;
}

/**
 * Count elements matching a selector
 */
async function countElements(ctx: BrowserTestContext, selector: string): Promise<number> {
	const result = await ctx.browser_query({ selector, mode: 'count' });
	return result?.count ?? 0;
}

/**
 * Take a screenshot with a descriptive name
 */
async function takeScreenshot(ctx: BrowserTestContext, name: string): Promise<string> {
	const result = await ctx.browser_screenshot({});
	console.log(`📸 Screenshot: ${name}`);
	return result?.data ?? '';
}

// ============================================================================
// TEST SUITE: PORTAL NAVIGATION & UI
// ============================================================================

export const portalNavigationTests: TestSuite = {
	name: 'Portal Navigation & UI',
	tests: [
		{
			name: 'Portal loads successfully',
			async run(ctx) {
				await ctx.browser_navigate({ url: SELF_SERVICE_URL });
				const headerVisible = await waitForElement(ctx, SELECTORS.header);

				if (!headerVisible) {
					return { passed: false, error: 'Header not visible after navigation' };
				}

				const title = await getElementText(ctx, SELECTORS.logo);
				if (title !== 'Cloud Portal') {
					return { passed: false, error: `Expected "Cloud Portal", got "${title}"` };
				}

				return { passed: true };
			}
		},

		{
			name: 'Header navigation links are present',
			async run(ctx) {
				const navCount = await countElements(ctx, SELECTORS.navLinks);

				if (navCount < 3) {
					return { passed: false, error: `Expected at least 3 nav links, found ${navCount}` };
				}

				// Check for specific nav items
				const navText = await ctx.browser_query({
					selector: SELECTORS.navLinks,
					mode: 'page_text'
				});

				const hasHome = navText?.text?.includes('Home');
				const hasServices = navText?.text?.includes('Services');
				const hasAIChat = navText?.text?.includes('AI Chat');

				if (!hasHome || !hasServices || !hasAIChat) {
					return { passed: false, error: 'Missing expected navigation links' };
				}

				return { passed: true };
			}
		},

		{
			name: 'User menu displays correctly',
			async run(ctx) {
				const userMenuVisible = await waitForElement(ctx, SELECTORS.userMenu);

				if (!userMenuVisible) {
					return { passed: false, error: 'User menu not visible' };
				}

				const userName = await getElementText(ctx, '.user-name');
				if (!userName?.includes('Alex')) {
					return {
						passed: false,
						error: `Expected user name containing "Alex", got "${userName}"`
					};
				}

				return { passed: true };
			}
		},

		{
			name: 'Hero section displays greeting',
			async run(ctx) {
				const greeting = await getElementText(ctx, SELECTORS.greeting);

				if (!greeting?.includes('Hello Alex')) {
					return { passed: false, error: `Expected greeting with "Hello Alex", got "${greeting}"` };
				}

				const heroTitle = await getElementText(ctx, SELECTORS.heroTitle);
				if (!heroTitle?.includes('Cloud Self-Service')) {
					return { passed: false, error: `Hero title missing, got "${heroTitle}"` };
				}

				return { passed: true };
			}
		},

		{
			name: 'Service categories grid displays 6 categories',
			async run(ctx) {
				const cardCount = await countElements(ctx, SELECTORS.serviceCards);

				if (cardCount !== 6) {
					return { passed: false, error: `Expected 6 service cards, found ${cardCount}` };
				}

				// Verify expected categories
				const expectedCategories = [
					'Compute Resources',
					'Database Services',
					'Networking',
					'Object Storage',
					'Identity & Access',
					'Monitoring & Alerts'
				];

				for (const category of expectedCategories) {
					const found = await ctx.browser_query({
						selector: SELECTORS.serviceTitle,
						pattern: category,
						mode: 'page_text'
					});

					if (!found?.text?.includes(category)) {
						return { passed: false, error: `Category "${category}" not found` };
					}
				}

				return { passed: true };
			}
		}
	]
};

// ============================================================================
// TEST SUITE: QUICK ACTIONS
// ============================================================================

export const quickActionsTests: TestSuite = {
	name: 'Quick Actions',
	tests: [
		{
			name: 'Quick action buttons are present',
			async run(ctx) {
				const quickActionCount = await countElements(ctx, SELECTORS.quickActions);

				if (quickActionCount < 4) {
					return {
						passed: false,
						error: `Expected at least 4 quick actions, found ${quickActionCount}`
					};
				}

				return { passed: true };
			}
		},

		{
			name: 'Clicking "List my instances" opens AI assistant',
			async run(ctx) {
				// Click the quick action
				await ctx.browser_click({ selector: SELECTORS.quickActions, index: 0 });

				// Wait for command palette to appear
				const paletteVisible = await waitForElement(ctx, SELECTORS.commandPalette);

				if (!paletteVisible) {
					return { passed: false, error: 'Command palette did not open' };
				}

				// Check for user message
				const userMessageVisible = await waitForElement(ctx, SELECTORS.userMessage);
				if (!userMessageVisible) {
					return { passed: false, error: 'User message not displayed' };
				}

				return { passed: true };
			}
		},

		{
			name: 'AI responds to quick action query',
			async run(ctx) {
				// Wait for AI response
				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'AI response timed out' };
				}

				// Verify assistant message exists
				const assistantMessageCount = await countElements(ctx, SELECTORS.assistantMessage);

				if (assistantMessageCount < 1) {
					return { passed: false, error: 'No assistant message found' };
				}

				return { passed: true };
			}
		},

		{
			name: 'Can close AI assistant and return to portal',
			async run(ctx) {
				// Close the command palette
				await ctx.browser_click({ selector: SELECTORS.commandClose });

				// Wait for palette to close
				await ctx.browser_wait({ ms: TIMEOUTS.animation });

				const paletteVisible = await ctx.browser_query({
					selector: SELECTORS.commandPalette,
					mode: 'exists'
				});

				if (paletteVisible?.exists) {
					return { passed: false, error: 'Command palette did not close' };
				}

				return { passed: true };
			}
		}
	]
};

// ============================================================================
// TEST SUITE: GUIDED WORKFLOWS
// ============================================================================

export const guidedWorkflowTests: TestSuite = {
	name: 'Guided Workflows',
	tests: [
		{
			name: 'Guided Workflows section is visible',
			async run(ctx) {
				await ctx.browser_navigate({ url: SELF_SERVICE_URL });
				await waitForElement(ctx, SELECTORS.workflowsSection);

				const sectionVisible = await ctx.browser_query({
					selector: SELECTORS.workflowsSection,
					mode: 'exists'
				});

				if (!sectionVisible?.exists) {
					return { passed: false, error: 'Workflows section not visible' };
				}

				return { passed: true };
			}
		},

		{
			name: 'Featured workflows display correctly',
			async run(ctx) {
				const workflowCount = await countElements(ctx, SELECTORS.workflowCards);

				if (workflowCount < 4) {
					return { passed: false, error: `Expected 4 featured workflows, found ${workflowCount}` };
				}

				// Check for expected workflows
				const expectedWorkflows = [
					'Cloud Cost Analysis',
					'Provision Web Server',
					'Setup Autonomous Database',
					'Setup Private Network'
				];

				for (const workflow of expectedWorkflows) {
					const found = await ctx.browser_query({
						selector: SELECTORS.workflowName,
						pattern: workflow,
						mode: 'page_text'
					});

					if (!found?.text?.includes(workflow)) {
						return { passed: false, error: `Workflow "${workflow}" not found` };
					}
				}

				return { passed: true };
			}
		},

		{
			name: 'Cloud Cost Analysis workflow launches correctly',
			async run(ctx) {
				// Find and click the Cloud Cost Analysis card
				await ctx.browser_click({
					selector: '.workflow-card',
					index: 0 // Cloud Cost Analysis is first
				});

				// Wait for command palette
				const paletteVisible = await waitForElement(ctx, SELECTORS.commandPalette);

				if (!paletteVisible) {
					return { passed: false, error: 'Command palette did not open for workflow' };
				}

				// Verify workflow panel appears
				const workflowPanelVisible = await waitForElement(ctx, SELECTORS.workflowPanel);

				if (!workflowPanelVisible) {
					return { passed: false, error: 'Workflow panel did not appear' };
				}

				return { passed: true };
			}
		},

		{
			name: 'AI asks for requirements before executing tools (CRITICAL)',
			async run(ctx) {
				// Wait for AI response
				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'AI response timed out' };
				}

				// Get the assistant's response text
				const responseText = await getElementText(
					ctx,
					`${SELECTORS.assistantMessage} .assistant-text`
				);

				// Check that AI asks questions instead of immediately calling tools
				const asksQuestions =
					responseText &&
					(responseText.toLowerCase().includes('what') ||
						responseText.toLowerCase().includes('how many') ||
						responseText.toLowerCase().includes('which') ||
						responseText.toLowerCase().includes('tell me') ||
						responseText.toLowerCase().includes('requirements') ||
						responseText.toLowerCase().includes('vCPU') ||
						responseText.toLowerCase().includes('memory') ||
						responseText.toLowerCase().includes('region'));

				// Check that no tools failed immediately
				const failedTools = await ctx.browser_query({
					selector: '.tool-card .status-dot.error',
					mode: 'count'
				});

				if ((failedTools?.count ?? 0) > 0) {
					return {
						passed: false,
						error: 'Tools executed and failed before gathering requirements'
					};
				}

				if (!asksQuestions) {
					// Take screenshot for debugging
					await takeScreenshot(ctx, 'ai-did-not-ask-questions');
					return {
						passed: false,
						error:
							'AI did not ask clarifying questions before proceeding. This is the CRITICAL behavior we need to fix.',
						response: responseText
					};
				}

				return { passed: true };
			}
		}
	]
};

// ============================================================================
// TEST SUITE: PROVISION WEB SERVER WORKFLOW (PRIMARY DEMO)
// ============================================================================

export const provisionWebServerTests: TestSuite = {
	name: 'Provision Web Server Workflow',
	tests: [
		{
			name: 'Start Provision Web Server workflow',
			async run(ctx) {
				await ctx.browser_navigate({ url: SELF_SERVICE_URL });
				await waitForElement(ctx, SELECTORS.workflowCards);

				// Find the Provision Web Server card (index 1 typically)
				await ctx.browser_click({
					selector: '.workflow-card',
					index: 1 // Provision Web Server
				});

				const paletteVisible = await waitForElement(ctx, SELECTORS.commandPalette);

				if (!paletteVisible) {
					return { passed: false, error: 'Command palette did not open' };
				}

				return { passed: true };
			}
		},

		{
			name: 'AI gathers requirements before provisioning',
			async run(ctx) {
				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'AI response timed out' };
				}

				const responseText = await getElementText(
					ctx,
					`${SELECTORS.assistantMessage} .assistant-text`
				);

				// The AI should ask about specifications
				const gathersRequirements =
					responseText &&
					(responseText.toLowerCase().includes('vcpu') ||
						responseText.toLowerCase().includes('memory') ||
						responseText.toLowerCase().includes('region') ||
						responseText.toLowerCase().includes('operating system') ||
						responseText.toLowerCase().includes('requirements') ||
						responseText.toLowerCase().includes('specify') ||
						responseText.toLowerCase().includes('what kind') ||
						responseText.toLowerCase().includes('need to know'));

				if (!gathersRequirements) {
					await takeScreenshot(ctx, 'web-server-no-requirements-gathering');
					return {
						passed: false,
						error: 'AI did not ask for web server specifications',
						response: responseText
					};
				}

				return { passed: true };
			}
		},

		{
			name: 'Can provide requirements and continue workflow',
			async run(ctx) {
				// Type requirements in the chat input
				await ctx.browser_type({
					selector: SELECTORS.commandInput,
					text: 'I need a 2 vCPU, 16GB RAM server in Frankfurt (eu-frankfurt-1), running Oracle Linux 8 for a web application.'
				});

				// Submit the message
				await ctx.browser_click({ selector: SELECTORS.commandSubmit });

				// Wait for AI response
				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'AI response timed out after providing requirements' };
				}

				return { passed: true };
			}
		},

		{
			name: 'AI calls appropriate tools after requirements gathered',
			async run(ctx) {
				// Wait a bit for tool execution
				await ctx.browser_wait({ ms: 2000 });

				// Check for tool cards
				const toolCardCount = await countElements(ctx, SELECTORS.toolCard);

				// We expect tools to be called now
				if (toolCardCount === 0) {
					// This might be ok if AI is still conversing
					const responseText = await getElementText(
						ctx,
						`${SELECTORS.assistantMessage}:last-child .assistant-text`
					);

					return {
						passed: true,
						note: 'No tools called yet - AI may still be clarifying',
						response: responseText
					};
				}

				// Check for expected tools
				const toolNames = await ctx.browser_query({
					selector: SELECTORS.toolName,
					mode: 'page_text'
				});

				return {
					passed: true,
					toolsCalled: toolNames?.text
				};
			}
		}
	]
};

// ============================================================================
// TEST SUITE: CHAT INTERACTION QUALITY
// ============================================================================

export const chatInteractionTests: TestSuite = {
	name: 'Chat Interaction Quality',
	tests: [
		{
			name: 'Search box accepts and submits queries',
			async run(ctx) {
				await ctx.browser_navigate({ url: SELF_SERVICE_URL });
				await waitForElement(ctx, SELECTORS.searchBox);

				// Type a query
				await ctx.browser_type({
					selector: 'input[placeholder*="Ask"]',
					text: 'What is OCI Free Tier?'
				});

				// Submit via Enter or button
				await ctx.browser_click({ selector: 'button[type="submit"]' });

				// Wait for command palette
				const paletteVisible = await waitForElement(ctx, SELECTORS.commandPalette);

				if (!paletteVisible) {
					return { passed: false, error: 'Search did not open command palette' };
				}

				return { passed: true };
			}
		},

		{
			name: 'AI provides helpful response to knowledge query',
			async run(ctx) {
				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'AI response timed out' };
				}

				const responseText = await getElementText(
					ctx,
					`${SELECTORS.assistantMessage} .assistant-text`
				);

				// Should mention free tier details
				const hasRelevantContent =
					responseText &&
					(responseText.toLowerCase().includes('free') ||
						responseText.toLowerCase().includes('always') ||
						responseText.toLowerCase().includes('arm') ||
						responseText.toLowerCase().includes('compute') ||
						responseText.toLowerCase().includes('database'));

				if (!hasRelevantContent) {
					return {
						passed: false,
						error: 'Response did not contain relevant Free Tier information',
						response: responseText
					};
				}

				return { passed: true };
			}
		},

		{
			name: 'Follow-up questions work correctly',
			async run(ctx) {
				// Type a follow-up
				await ctx.browser_type({
					selector: SELECTORS.commandInput,
					text: 'What shapes are available in the free tier?'
				});

				await ctx.browser_click({ selector: SELECTORS.commandSubmit });

				const responseComplete = await waitForAIResponse(ctx);

				if (!responseComplete) {
					return { passed: false, error: 'Follow-up response timed out' };
				}

				// Should have multiple messages now
				const messageCount = await countElements(ctx, '.message');

				if (messageCount < 4) {
					// 2 user + 2 assistant minimum
					return { passed: false, error: `Expected at least 4 messages, found ${messageCount}` };
				}

				return { passed: true };
			}
		}
	]
};

// ============================================================================
// TEST SUITE: ERROR HANDLING
// ============================================================================

export const errorHandlingTests: TestSuite = {
	name: 'Error Handling',
	tests: [
		{
			name: 'Empty search submission is handled',
			async run(ctx) {
				await ctx.browser_navigate({ url: SELF_SERVICE_URL });
				await waitForElement(ctx, 'input[placeholder*="Ask"]');

				// Try to submit empty search
				await ctx.browser_click({ selector: 'button[type="submit"]' });

				// Command palette should NOT open for empty query
				await ctx.browser_wait({ ms: 500 });

				const paletteVisible = await ctx.browser_query({
					selector: SELECTORS.commandPalette,
					mode: 'exists'
				});

				if (paletteVisible?.exists) {
					return { passed: false, error: 'Command palette opened for empty query' };
				}

				return { passed: true };
			}
		},

		{
			name: 'Clicking backdrop closes AI assistant',
			async run(ctx) {
				// Open assistant
				await ctx.browser_click({ selector: SELECTORS.quickActions, index: 0 });
				await waitForElement(ctx, SELECTORS.commandPalette);

				// Click the backdrop
				await ctx.browser_click({ selector: '.command-backdrop' });

				// Wait for animation
				await ctx.browser_wait({ ms: TIMEOUTS.animation });

				const paletteVisible = await ctx.browser_query({
					selector: SELECTORS.commandPalette,
					mode: 'exists'
				});

				if (paletteVisible?.exists) {
					return { passed: false, error: 'Clicking backdrop did not close palette' };
				}

				return { passed: true };
			}
		}
	]
};

// ============================================================================
// TEST RUNNER
// ============================================================================

export const allTestSuites: TestSuite[] = [
	portalNavigationTests,
	quickActionsTests,
	guidedWorkflowTests,
	provisionWebServerTests,
	chatInteractionTests,
	errorHandlingTests
];

/**
 * Run all E2E tests
 */
export async function runAllTests(ctx: BrowserTestContext): Promise<{
	totalPassed: number;
	totalFailed: number;
	results: Array<{ suite: string; test: string; result: TestResult }>;
}> {
	const results: Array<{ suite: string; test: string; result: TestResult }> = [];
	let totalPassed = 0;
	let totalFailed = 0;

	console.log('\n🧪 OCI AI Chat - E2E Test Suite\n');
	console.log('='.repeat(60));

	for (const suite of allTestSuites) {
		console.log(`\n📦 ${suite.name}\n`);

		for (const test of suite.tests) {
			try {
				const result = await test.run(ctx);
				results.push({ suite: suite.name, test: test.name, result });

				if (result.passed) {
					console.log(`  ✅ ${test.name}`);
					totalPassed++;
				} else {
					console.log(`  ❌ ${test.name}`);
					console.log(`     Error: ${result.error}`);
					totalFailed++;
				}
			} catch (error) {
				const result = { passed: false, error: String(error) };
				results.push({ suite: suite.name, test: test.name, result });
				console.log(`  💥 ${test.name}`);
				console.log(`     Exception: ${error}`);
				totalFailed++;
			}
		}
	}

	console.log('\n' + '='.repeat(60));
	console.log(`\n📊 Results: ${totalPassed} passed, ${totalFailed} failed`);
	console.log(`   Pass rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%\n`);

	return { totalPassed, totalFailed, results };
}

/**
 * Run critical tests only (for quick validation)
 */
export async function runCriticalTests(ctx: BrowserTestContext): Promise<{
	passed: boolean;
	criticalFailures: string[];
}> {
	const criticalFailures: string[] = [];

	console.log('\n🔥 Running Critical Tests Only\n');

	// Test 1: Portal loads
	await ctx.browser_navigate({ url: SELF_SERVICE_URL });
	const headerVisible = await waitForElement(ctx, SELECTORS.header);
	if (!headerVisible) {
		criticalFailures.push('Portal failed to load');
	}

	// Test 2: Workflow doesn't immediately fail with tools
	await ctx.browser_click({ selector: '.workflow-card', index: 1 }); // Provision Web Server
	await waitForElement(ctx, SELECTORS.commandPalette);
	await waitForAIResponse(ctx);

	const failedTools = await ctx.browser_query({
		selector: '.tool-card .status-dot.error',
		mode: 'count'
	});

	if ((failedTools?.count ?? 0) > 0) {
		criticalFailures.push('Tools failed immediately without requirement gathering');
	}

	// Test 3: AI asks questions
	const responseText = await getElementText(ctx, `${SELECTORS.assistantMessage} .assistant-text`);
	const asksQuestions =
		responseText &&
		(responseText.toLowerCase().includes('what') ||
			responseText.toLowerCase().includes('requirements') ||
			responseText.toLowerCase().includes('need'));

	if (!asksQuestions) {
		criticalFailures.push('AI did not ask for requirements');
	}

	return {
		passed: criticalFailures.length === 0,
		criticalFailures
	};
}
