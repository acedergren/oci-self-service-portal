/**
 * @portal/server - Shared server-side business logic
 *
 * This package contains server-only modules extracted from @portal/shared:
 * Oracle connection management, auth, admin repositories, agent state,
 * MCP client, logging, metrics, crypto, and more.
 */

// Re-export error hierarchy from @portal/types
export * from './errors.js';

// Core utilities
export * from './logger.js';
export * from './sentry.js';
export * from './tracing.js';
export * from './metrics.js';
export * from './crypto.js';
export * from './rate-limiter.js';
// approvals.ts excluded from barrel due to name collision with metrics.ts (pendingApprovals).
// Import directly: import { ... } from '@portal/server/approvals';

export const PACKAGE_VERSION = '0.0.1';
