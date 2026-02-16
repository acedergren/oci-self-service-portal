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
// Tool registry — unimplemented stubs pending Mastra migration
// ---------------------------------------------------------------------------

type ToolHandler = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
type ToolDefinitionProvider = (toolName: string) => ToolDefinition | undefined;
type ToolWarningProvider = (toolName: string) => ToolWarning | undefined;

const _executeHandler: ToolHandler | null = null;
const _definitionProvider: ToolDefinitionProvider | null = null;
const _warningProvider: ToolWarningProvider | null = null;

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
