/**
 * Types for E2E Browser Testing
 */

export interface TestResult {
	passed: boolean;
	error?: string;
	note?: string;
	response?: string | null;
	toolsCalled?: string;
}

export interface TestCase {
	name: string;
	run: (ctx: BrowserTestContext) => Promise<TestResult>;
}

export interface TestSuite {
	name: string;
	tests: TestCase[];
}

/**
 * Browser test context - wrapper for opencode-browser tools
 */
export interface BrowserTestContext {
	browser_navigate: (params: { url: string; tabId?: number }) => Promise<unknown>;
	browser_click: (params: {
		selector: string;
		index?: number;
		tabId?: number;
		timeoutMs?: number;
	}) => Promise<unknown>;
	browser_type: (params: {
		selector: string;
		text: string;
		clear?: boolean;
		tabId?: number;
	}) => Promise<unknown>;
	browser_query: (params: {
		selector?: string;
		mode?: string;
		property?: string;
		pattern?: string;
		tabId?: number;
	}) => Promise<{ exists?: boolean; count?: number; value?: string; text?: string } | null>;
	browser_wait: (params: { ms: number; tabId?: number }) => Promise<unknown>;
	browser_screenshot: (params: { tabId?: number }) => Promise<{ data?: string } | null>;
	browser_scroll: (params: {
		selector?: string;
		x?: number;
		y?: number;
		tabId?: number;
	}) => Promise<unknown>;
}

/**
 * Demo step for scripted demonstrations
 */
export interface DemoStep {
	id: string;
	title: string;
	description: string;
	action: 'navigate' | 'click' | 'type' | 'wait' | 'screenshot' | 'speak' | 'highlight' | 'scroll';
	selector?: string;
	value?: string;
	duration?: number;
	talkingPoints?: string[];
}

/**
 * Demo scenario
 */
export interface DemoScenario {
	id: string;
	name: string;
	description: string;
	estimatedDuration: number; // minutes
	steps: DemoStep[];
}
