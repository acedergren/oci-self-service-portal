import type { PageServerLoad } from './$types';

/**
 * Stateless page load - no session persistence in Cloudflare Pages deployment.
 * Conversation history is maintained client-side only.
 */
export const load: PageServerLoad = async () => {
  return {
    sessions: [],
    currentSessionId: null,
    initialMessages: [],
  };
};
