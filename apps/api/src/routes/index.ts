export { healthRoutes } from './health.js';
export { sessionRoutes } from './sessions.js';
export { activityRoutes } from './activity.js';
// toolRoutes removed — superseded by routes/tools/ (execute.ts + approve.ts).
// Legacy file at routes/tools.legacy.ts. See API audit C1.
export { v1ToolRoutes } from './v1-tools.js';
export { metricsRoutes } from './metrics.js';
export { default as searchRoutes } from './search.js';
export { default as mcpRoutes } from './mcp.js';
export { default as chatRoutes } from './chat.js';
export { default as workflowRoutes } from './workflows.js';
export { default as openApiRoute } from './openapi.js';
