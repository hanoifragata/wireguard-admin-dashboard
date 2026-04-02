/**
 * Audit log routes: paginated query with filters.
 */
import type { FastifyInstance } from 'fastify';
import { auditService } from '../services/audit.service.js';
import { getAccessibleServerIds } from '../services/access.service.js';

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/audit
   * Returns paginated audit log entries.
   *
   * Query params:
   *   - limit (default 50, max 200)
   *   - offset (default 0)
   *   - serverId
   *   - action (partial match)
   *   - performedBy
   *   - result ('success' | 'fail')
   */
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(q['limit'] ?? '50', 10), 200);
    const offset = parseInt(q['offset'] ?? '0', 10);
    const serverId = q['serverId'] ? parseInt(q['serverId'], 10) : undefined;
    const action = q['action'];
    const performedBy = q['performedBy'];
    const result = q['result'] as 'success' | 'fail' | undefined;

    const accessibleServerIds = await getAccessibleServerIds(request.user);
    if (request.user.role !== 'admin' && accessibleServerIds.length === 0) {
      return {
        data: [],
        meta: { total: 0, limit, offset, hasMore: false },
      };
    }

    const queryOptions = {
      limit,
      offset,
      ...(serverId !== undefined ? { serverId } : {}),
      ...(request.user.role !== 'admin' ? { serverIds: accessibleServerIds } : {}),
      ...(action ? { action } : {}),
      ...(performedBy ? { performedBy } : {}),
      ...(result ? { result } : {}),
    };

    const { data, total } = await auditService.query(queryOptions);

    return {
      data,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + data.length < total,
      },
    };
  });
}
