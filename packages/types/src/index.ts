/**
 * @portal/types - Shared TypeScript types and Zod schemas
 *
 * This package contains all shared type definitions, Zod schemas,
 * and validation utilities used across frontend and backend.
 */

// Re-export all tool types and schemas
export * from './tools/types.js';

// Re-export all workflow types and schemas
export * from './workflows/types.js';

// Re-export all server API types and schemas
export * from './server/api/types.js';

export const PACKAGE_VERSION = '0.0.1';
