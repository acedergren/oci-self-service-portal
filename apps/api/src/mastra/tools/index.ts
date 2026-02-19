export {
	buildMastraTools,
	createAISDKTools,
	createAISDKToolsWithApproval,
	executeTool,
	getToolDefinition,
	getAllToolDefinitions,
	getToolsByCategory,
	toolDefinitions,
	asyncToolExecutors
} from './registry.js';
export type { ApprovalCallback } from './registry.js';
export * from './types.js';
export {
	executeOCI,
	executeOCIAsync,
	slimOCIResponse,
	getDefaultCompartmentId,
	requireCompartmentId,
	toMidnightUTC
} from './executor.js';

import { toolDefinitions as _toolDefs } from './registry.js';

/** All tool names available to Charlie (full OCI tool suite). */
export const CHARLIE_TOOLS: readonly string[] = Object.freeze(Array.from(_toolDefs.keys()));

/** Read-only subset for autonomous use — only tools with approvalLevel === 'auto'. */
export const CLOUDADVISOR_TOOLS: readonly string[] = Object.freeze(
	Array.from(_toolDefs.entries())
		.filter(([, def]) => def.approvalLevel === 'auto')
		.map(([name]) => name)
);
