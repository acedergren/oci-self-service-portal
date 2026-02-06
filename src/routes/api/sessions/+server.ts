import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sessionRepository, listSessionsEnriched } from '$lib/server/oracle/repositories/session-repository.js';
import { getCurrentSessionId } from '$lib/server/session.js';
import { createLogger } from '$lib/server/logger.js';
import { requirePermission } from '$lib/server/auth/rbac.js';

const log = createLogger('sessions-api');

export const GET: RequestHandler = async (event) => {
  requirePermission(event, 'sessions:read');

  const { cookies, locals, url } = event;
  if (!locals.dbAvailable) {
    return json({ sessions: [], total: 0, message: 'Database not available' });
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  const search = url.searchParams.get('search') || undefined;

  try {
    const { sessions, total } = await listSessionsEnriched({
      userId: locals.user?.id,
      limit,
      offset,
      search,
    });

    const currentSessionId = getCurrentSessionId(cookies);

    return json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        model: s.model,
        region: s.region,
        status: s.status,
        messageCount: s.messageCount,
        lastMessage: s.lastMessage,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        isCurrent: s.id === currentSessionId,
      })),
      total,
    });
  } catch (err) {
    log.error({ err }, 'Failed to list sessions');
    return json({ sessions: [], total: 0, error: 'Failed to retrieve sessions' }, { status: 500 });
  }
};

export const POST: RequestHandler = async (event) => {
  requirePermission(event, 'sessions:write');

  const { request, locals } = event;
  if (!locals.dbAvailable) {
    return json({ error: 'Database not available' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  try {
    const session = await sessionRepository.create({
      model: (body.model as string) || 'default',
      region: (body.region as string) || 'eu-frankfurt-1',
      title: body.title as string | undefined,
      userId: locals.user?.id,
    });

    return json({ session }, { status: 201 });
  } catch (err) {
    log.error({ err }, 'Failed to create session');
    return json({ error: 'Failed to create session' }, { status: 500 });
  }
};
