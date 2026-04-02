import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  adminUsers,
  refreshTokens,
  servers,
  userServerPermissions,
} from '../db/schema.js';
import { hashPassword } from '../lib/crypto.js';
import { requireAdmin, sanitizeUser } from '../services/access.service.js';
import { auditService } from '../services/audit.service.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'operator']).default('operator'),
  serverIds: z.array(z.number().int().positive()).default([]),
});

const updateUserSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  role: z.enum(['admin', 'operator']).optional(),
  serverIds: z.array(z.number().int().positive()).optional(),
});

async function replacePermissions(userId: number, serverIds: number[]): Promise<void> {
  db.delete(userServerPermissions).where(eq(userServerPermissions.userId, userId)).run();

  if (serverIds.length === 0) return;

  db.insert(userServerPermissions)
    .values(serverIds.map((serverId) => ({ userId, serverId })))
    .run();
}

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const users = db.select().from(adminUsers).all();
    const permissions = db.select().from(userServerPermissions).all();
    const serversList = db.select({ id: servers.id, name: servers.name }).from(servers).all();

    const serverMap = new Map(serversList.map((server) => [server.id, server.name]));
    const permissionsByUser = new Map<number, number[]>();

    for (const permission of permissions) {
      const current = permissionsByUser.get(permission.userId) ?? [];
      current.push(permission.serverId);
      permissionsByUser.set(permission.userId, current);
    }

    return users.map((user) => {
      const serverIds = permissionsByUser.get(user.id) ?? [];
      return {
        ...sanitizeUser(user),
        serverIds,
        servers: serverIds.map((id) => ({ id, name: serverMap.get(id) ?? `Server ${id}` })),
      };
    });
  });

  fastify.post('/', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createUserSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const existing = db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, body.data.username))
      .get();

    if (existing) {
      return reply.code(409).send({ error: 'Username already exists' });
    }

    if (body.data.serverIds.length > 0) {
      const foundServers = db
        .select({ id: servers.id })
        .from(servers)
        .where(inArray(servers.id, body.data.serverIds))
        .all();
      if (foundServers.length !== body.data.serverIds.length) {
        return reply.code(400).send({ error: 'One or more servers do not exist' });
      }
    }

    const passwordHash = await hashPassword(body.data.password);
    const [created] = db
      .insert(adminUsers)
      .values({
        username: body.data.username,
        passwordHash,
        role: body.data.role,
      })
      .returning()
      .all();

    if (!created) {
      return reply.code(500).send({ error: 'Failed to create user' });
    }

    await replacePermissions(created.id, body.data.serverIds);

    await auditService.log({
      action: 'USER_CREATE',
      performedBy: request.user.username,
      result: 'success',
    });

    return reply.code(201).send({
      ...sanitizeUser(created),
      serverIds: body.data.serverIds,
    });
  });

  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const userId = parseInt(request.params.id, 10);
    const body = updateUserSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const existing = db.select().from(adminUsers).where(eq(adminUsers.id, userId)).get();
    if (!existing) {
      return reply.code(404).send({ error: 'User not found' });
    }

    if (body.data.serverIds !== undefined) {
      const foundServers = body.data.serverIds.length
        ? db
            .select({ id: servers.id })
            .from(servers)
            .where(inArray(servers.id, body.data.serverIds))
            .all()
        : [];

      if (foundServers.length !== body.data.serverIds.length) {
        return reply.code(400).send({ error: 'One or more servers do not exist' });
      }
    }

    const updates: Partial<typeof adminUsers.$inferInsert> = {};
    let shouldRevokeSessions = false;
    if (body.data.role !== undefined) updates.role = body.data.role;
    if (body.data.password !== undefined) {
      updates.passwordHash = await hashPassword(body.data.password);
      shouldRevokeSessions = true;
    }
    if (body.data.role !== undefined && body.data.role !== existing.role) {
      shouldRevokeSessions = true;
    }

    const [updatedCandidate] = Object.keys(updates).length
      ? db
          .update(adminUsers)
          .set(updates)
          .where(eq(adminUsers.id, userId))
          .returning()
          .all()
      : [existing];

    const updated = updatedCandidate ?? existing;

    if (body.data.serverIds !== undefined) {
      await replacePermissions(userId, body.data.serverIds);
      shouldRevokeSessions = true;
    } else if (body.data.role === 'admin') {
      await replacePermissions(userId, []);
    }

    if (shouldRevokeSessions) {
      db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).run();
    }

    const currentServerIds =
      body.data.serverIds ??
      db
        .select({ serverId: userServerPermissions.serverId })
        .from(userServerPermissions)
        .where(eq(userServerPermissions.userId, userId))
        .all()
        .map((row) => row.serverId);

    await auditService.log({
      action: 'USER_UPDATE',
      performedBy: request.user.username,
      result: 'success',
    });

    return {
      ...sanitizeUser(updated),
      serverIds: currentServerIds,
    };
  });

  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const userId = parseInt(request.params.id, 10);
    if (userId === request.user.id) {
      return reply.code(400).send({ error: 'You cannot delete your own account' });
    }

    const existing = db.select().from(adminUsers).where(eq(adminUsers.id, userId)).get();
    if (!existing) {
      return reply.code(404).send({ error: 'User not found' });
    }

    db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).run();
    db.delete(adminUsers).where(eq(adminUsers.id, userId)).run();

    await auditService.log({
      action: 'USER_DELETE',
      performedBy: request.user.username,
      result: 'success',
    });

    return reply.code(204).send();
  });
}
