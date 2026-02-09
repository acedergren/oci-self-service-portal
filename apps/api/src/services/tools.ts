/**
 * Tool registry service — provides tool definitions, approval requirements,
 * and execution. Will be populated when the tool registry migrates from
 * apps/frontend/src/lib/tools/ to this API.
 *
 * For now, delegates to registered handlers that can be set by the app
 * or mocked in tests.
 */

export interface ToolDefinition {
	name: string;
	category: string;
	description: string;
	approvalLevel: 'none' | 'confirm' | 'admin';
}

export interface ToolWarning {
	warning: string;
	impact: string;
}

// ---------------------------------------------------------------------------
// Tool registry — extensible via registerToolHandler()
// ---------------------------------------------------------------------------

type ToolHandler = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
type ToolDefinitionProvider = (toolName: string) => ToolDefinition | undefined;
type ToolWarningProvider = (toolName: string) => ToolWarning | undefined;

let _executeHandler: ToolHandler | null = null;
let _definitionProvider: ToolDefinitionProvider | null = null;
let _warningProvider: ToolWarningProvider | null = null;

export function registerToolHandlers(handlers: {
	execute: ToolHandler;
	getDefinition: ToolDefinitionProvider;
	getWarning?: ToolWarningProvider;
}) {
	_executeHandler = handlers.execute;
	_definitionProvider = handlers.getDefinition;
	_warningProvider = handlers.getWarning ?? null;
}

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
	return _definitionProvider?.(toolName);
}

export function getToolWarning(toolName: string): ToolWarning | undefined {
	return _warningProvider?.(toolName);
}

export function requiresApproval(approvalLevel: string): boolean {
	return approvalLevel !== 'none';
}

export async function executeTool(
	toolName: string,
	args: Record<string, unknown>
): Promise<unknown> {
	if (!_executeHandler) {
		throw new Error(`No tool handler registered for execution`);
	}
	return _executeHandler(toolName, args);
}

/** Reset handlers (for testing). */
export function _resetToolHandlers() {
	_executeHandler = null;
	_definitionProvider = null;
	_warningProvider = null;
}
