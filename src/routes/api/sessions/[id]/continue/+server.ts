import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Stateless session continue API - sessions not persisted.
 */
export const POST: RequestHandler = async () => {
  return json({
    error: 'Session management not available in stateless deployment',
  }, { status: 501 });
};
