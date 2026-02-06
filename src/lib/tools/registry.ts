import { tool } from 'ai';
import type { ToolDefinition, ToolEntry, ApprovalLevel, ToolCategory } from './types.js';
import {
  computeTools,
  networkingTools,
  storageTools,
  databaseTools,
  identityTools,
  observabilityTools,
  pricingTools,
  searchTools,
  billingTools,
  loggingTools,
  terraformTools,
} from './categories/index.js';

/**
 * All tool entries from every category
 */
const allToolEntries: ToolEntry[] = [
  ...computeTools,
  ...networkingTools,
  ...storageTools,
  ...databaseTools,
  ...identityTools,
  ...observabilityTools,
  ...pricingTools,
  ...searchTools,
  ...billingTools,
  ...loggingTools,
  ...terraformTools,
];

/**
 * Tool registry — maps tool name to its definition
 */
const toolDefinitions: Map<string, ToolDefinition> = new Map();

/**
 * Sync executors keyed by tool name
 */
const toolExecutors: Record<string, (args: Record<string, unknown>) => unknown> = {};

/**
 * Async executors keyed by tool name
 */
const asyncToolExecutors: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

// Register all tool entries
for (const entry of allToolEntries) {
  const { execute, executeAsync, ...definition } = entry;
  toolDefinitions.set(definition.name, definition);
  if (execute) toolExecutors[definition.name] = execute;
  if (executeAsync) asyncToolExecutors[definition.name] = executeAsync;
}

/**
 * Get a tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolDefinitions.get(name);
}

/**
 * Get all tool definitions
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(toolDefinitions.values());
}

/**
 * Get tool definitions by category
 */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return getAllToolDefinitions().filter((t) => t.category === category);
}

/**
 * Build the execute wrapper used by both createAISDKTools and createAISDKToolsWithApproval
 */
function buildExecute(
  def: ToolDefinition,
  options?: { onApprovalRequired?: ApprovalCallback }
) {
  const syncExecutor = toolExecutors[def.name];
  const asyncExecutor = asyncToolExecutors[def.name];

  return async (args: Record<string, unknown>) => {
    const hasExecutor = syncExecutor || asyncExecutor;
    if (!hasExecutor) {
      return { error: `No executor found for tool: ${def.name}` };
    }

    const startTime = Date.now();

    try {
      // Check approval if callback provided
      if (options?.onApprovalRequired) {
        const needsApproval = def.approvalLevel === 'confirm' || def.approvalLevel === 'danger';
        if (needsApproval) {
          const approved = await options.onApprovalRequired(
            def.name, args, def.approvalLevel, def.category
          );
          if (!approved) {
            return {
              success: false, tool: def.name, rejected: true,
              error: 'Operation was cancelled by user',
            };
          }
        }
      }

      let result: unknown;
      if (asyncExecutor) {
        result = await asyncExecutor(args);
      } else if (syncExecutor) {
        result = syncExecutor(args);
      }

      const duration = Date.now() - startTime;
      return {
        success: true, tool: def.name, data: result,
        ...(options?.onApprovalRequired ? { duration, approvalLevel: def.approvalLevel } : {}),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false, tool: def.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(options?.onApprovalRequired ? { duration, approvalLevel: def.approvalLevel } : {}),
      };
    }
  };
}

/**
 * Create AI SDK tools from registered tool definitions
 */
export function createAISDKTools(): Record<string, ReturnType<typeof tool>> {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const def of toolDefinitions.values()) {
    const toolDef = {
      description: def.description,
      parameters: def.parameters,
      execute: buildExecute(def),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools[def.name] = tool(toolDef as any);
  }

  return tools;
}

/**
 * Callback for handling tool approval requests
 */
export type ApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
  approvalLevel: ApprovalLevel,
  category: ToolCategory
) => Promise<boolean>;

/**
 * Create AI SDK tools with approval flow for dangerous operations
 */
export function createAISDKToolsWithApproval(
  onApprovalRequired: ApprovalCallback,
  _sessionId?: string
): Record<string, ReturnType<typeof tool>> {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const def of toolDefinitions.values()) {
    const toolDef = {
      description: def.description,
      parameters: def.parameters,
      execute: buildExecute(def, { onApprovalRequired }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools[def.name] = tool(toolDef as any);
  }

  return tools;
}

/**
 * Execute a tool by name. Returns the result or throws on error.
 * Used by the execute endpoint to avoid duplicating executor logic.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const asyncExecutor = asyncToolExecutors[name];
  const syncExecutor = toolExecutors[name];

  if (asyncExecutor) {
    return asyncExecutor(args);
  }
  if (syncExecutor) {
    return syncExecutor(args);
  }
  throw new Error(
    `No executor for tool: ${name}. This tool may be read-only and executed directly.`
  );
}

export { toolDefinitions, asyncToolExecutors };
