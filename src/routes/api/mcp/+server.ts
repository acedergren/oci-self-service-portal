/**
 * MCP Servers API
 *
 * MCP servers are not available in stateless Cloudflare Pages deployment.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json({
    initialized: false,
    servers: [],
    totalTools: 0,
    note: 'MCP servers not available in stateless deployment',
  });
};
