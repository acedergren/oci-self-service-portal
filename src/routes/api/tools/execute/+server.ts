import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logToolExecution, logToolApproval } from '$lib/server/audit.js';
import { getToolDefinition, requiresApproval, getToolWarning, executeTool } from '$lib/tools/index.js';
import { createLogger } from '$lib/server/logger.js';
import { requirePermission } from '$lib/server/auth/rbac.js';
import { consumeApproval } from '$lib/server/approvals.js';

const log = createLogger('execute');

/**
 * GET /api/tools/execute?toolName=xxx
 * Get approval requirements for a tool
 */
export const GET: RequestHandler = async (event) => {
  requirePermission(event, 'tools:execute');

  const toolName = event.url.searchParams.get('toolName');
  
  if (!toolName) {
    return json({ error: 'Missing toolName parameter' }, { status: 400 });
  }

  const toolDef = getToolDefinition(toolName);
  
  if (!toolDef) {
    return json({ error: `Unknown tool: ${toolName}` }, { status: 404 });
  }

  const warning = getToolWarning(toolName);
  const needsApproval = requiresApproval(toolDef.approvalLevel);

  return json({
    toolName,
    category: toolDef.category,
    approvalLevel: toolDef.approvalLevel,
    requiresApproval: needsApproval,
    warning: warning?.warning,
    impact: warning?.impact,
    description: toolDef.description,
  });
};

/**
 * POST /api/tools/execute
 * Execute a tool after approval
 */
export const POST: RequestHandler = async (event) => {
  requirePermission(event, 'tools:execute');

  let body: Record<string, unknown>;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const toolCallId = body.toolCallId as string | undefined;
  const toolName = body.toolName as string | undefined;
  const args = body.args as Record<string, unknown> | undefined;
  const sessionId = body.sessionId as string | undefined;

  if (!toolName || !args) {
    return json({ error: 'Missing toolName or args' }, { status: 400 });
  }

  const toolDef = getToolDefinition(toolName);

  if (!toolDef) {
    return json({ error: `Unknown tool: ${toolName}` }, { status: 404 });
  }

  const needsApproval = requiresApproval(toolDef.approvalLevel);

  // If tool requires approval, verify server-side approval record
  if (needsApproval) {
    if (!toolCallId || !consumeApproval(toolCallId, toolName)) {
      logToolApproval(
        toolName,
        toolDef.category,
        toolDef.approvalLevel,
        args,
        false,
        sessionId
      );

      return json({
        success: false,
        rejected: true,
        error: 'Tool requires explicit approval via the approval endpoint',
        toolName,
        approvalLevel: toolDef.approvalLevel,
      }, { status: 403 });
    }

    logToolApproval(
      toolName,
      toolDef.category,
      toolDef.approvalLevel,
      args,
      true,
      sessionId
    );
  }

  // Execute the tool via registry
  const startTime = Date.now();

  try {
    const result = await executeTool(toolName, args);
    const duration = Date.now() - startTime;

    log.info({ toolName, duration }, 'tool executed');

    // Log successful execution
    logToolExecution(
      toolName,
      toolDef.category,
      toolDef.approvalLevel,
      args,
      true,
      duration,
      undefined,
      sessionId
    );

    return json({
      success: true,
      toolCallId,
      toolName,
      data: result,
      duration,
      approvalLevel: toolDef.approvalLevel,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    log.error({ toolName, duration, err: errorMessage }, 'tool execution failed');

    // Log failed execution
    logToolExecution(
      toolName,
      toolDef.category,
      toolDef.approvalLevel,
      args,
      false,
      duration,
      errorMessage,
      sessionId
    );

    return json({
      success: false,
      toolCallId,
      toolName,
      error: errorMessage,
      duration,
      approvalLevel: toolDef.approvalLevel,
    }, { status: 500 });
  }
};
