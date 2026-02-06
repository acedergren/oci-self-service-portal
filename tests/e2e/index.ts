/**
 * OCI AI Chat - E2E Test Suite Index
 *
 * Export all test suites and demo runners for use with opencode-browser
 */

// Test suites
export {
	portalNavigationTests,
	quickActionsTests,
	guidedWorkflowTests,
	provisionWebServerTests,
	chatInteractionTests,
	errorHandlingTests,
	allTestSuites,
	runAllTests,
	runCriticalTests
} from './self-service-portal.e2e';

// Demo runner
export {
	DEMO_SCENARIOS,
	runDemo,
	runExecutiveDemo,
	runTechnicalDemo,
	runCostComparisonDemo,
	listDemoScenarios
} from './demo-runner';

// Types
export type {
	TestResult,
	TestCase,
	TestSuite,
	BrowserTestContext,
	DemoStep,
	DemoScenario
} from './types';
