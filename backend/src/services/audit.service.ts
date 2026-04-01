/**
 * Audit logging service.
 * Records every significant action to the audit_logs table.
 */
import { db } from '../db/index.js';
import { auditLogs, type AuditLog } from '../db/schema.js';
import { desc, eq, like, and, inArray, type SQL } from 'drizzle-orm';

export interface LogEntry {
  action: string;
  serverId?: number;
  peerPublicKey?: string;
  peerAlias?: string;
  performedBy: string;
  result: 'success' | 'fail';
  errorMessage?: string;
}

export interface AuditQueryOptions {
  limit?: number;
  offset?: number;
  serverId?: number;
  serverIds?: number[];
  action?: string;
  performedBy?: string;
  result?: 'success' | 'fail';
}

class AuditService {
  /**
   * Appends an entry to the audit log.
   */
  async log(entry: LogEntry): Promise<void> {
    db.insert(auditLogs)
      .values({
        action: entry.action,
        serverId: entry.serverId ?? null,
        peerPublicKey: entry.peerPublicKey ?? null,
        peerAlias: entry.peerAlias ?? null,
        performedBy: entry.performedBy,
        result: entry.result,
        errorMessage: entry.errorMessage ?? null,
      })
      .run();
  }

  /**
   * Queries audit logs with optional filters and pagination.
   *
   * @returns Paginated list of audit log entries and total count
   */
  async query(opts: AuditQueryOptions = {}): Promise<{
    data: AuditLog[];
    total: number;
  }> {
    const {
      limit = 50,
      offset = 0,
      serverId,
      serverIds,
      action,
      performedBy,
      result,
    } = opts;

    const conditions: SQL[] = [];

    if (serverId !== undefined) {
      conditions.push(eq(auditLogs.serverId, serverId));
    } else if (serverIds && serverIds.length > 0) {
      conditions.push(inArray(auditLogs.serverId, serverIds));
    }
    if (action) {
      conditions.push(like(auditLogs.action, `%${action}%`));
    }
    if (performedBy) {
      conditions.push(eq(auditLogs.performedBy, performedBy));
    }
    if (result) {
      conditions.push(eq(auditLogs.result, result));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const data = db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const [countRow] = db
      .select({ count: db.$count(auditLogs, whereClause) })
      .from(auditLogs)
      .all();

    return { data, total: countRow?.count ?? 0 };
  }
}

export const auditService = new AuditService();
