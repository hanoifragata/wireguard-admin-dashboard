/**
 * Server management routes: CRUD, SSH connectivity test, live peer sync.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { servers, peers, type Server } from '../db/schema.js';
import { encrypt } from '../lib/crypto.js';
import { testConnection } from '../services/ssh.service.js';
import { getLivePeers } from '../services/wireguard.service.js';
import { auditService } from '../services/audit.service.js';
import { eq } from 'drizzle-orm';
import {
  getAccessibleServerById,
  listAccessibleServers,
  requireAdmin,
} from '../services/access.service.js';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  endpointHost: z.string().min(1).optional(),
  endpointPort: z.number().int().min(1).max(65535).optional(),
  peerLimit: z.number().int().positive().optional(),
  sshUser: z.string().min(1),
  authMethod: z.enum(['key', 'password']),
  executionMode: z.enum(['host', 'docker']).default('host'),
  dockerContainer: z.string().optional(),
  sshKey: z.string().optional(),
  sshPassword: z.string().optional(),
  wgInterface: z.string().min(1).default('wg0'),
  description: z.string().optional(),
});

const updateServerSchema = createServerSchema.partial();

const testConnectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  endpointHost: z.string().min(1).optional(),
  endpointPort: z.number().int().min(1).max(65535).optional(),
  peerLimit: z.number().int().positive().optional(),
  sshUser: z.string().min(1),
  authMethod: z.enum(['key', 'password']),
  executionMode: z.enum(['host', 'docker']).default('host'),
  dockerContainer: z.string().optional(),
  sshKey: z.string().optional(),
  sshPassword: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strips sensitive fields before returning server to client */
function sanitizeServer(server: Server) {
  const { sshKey: _, sshPassword: __, ...safe } = server;
  return {
    ...safe,
    hasKey: !!server.sshKey,
    hasPassword: !!server.sshPassword,
  };
}

async function discoverPeers(server: Server): Promise<void> {
  const livePeers = await getLivePeers(server);

  for (const livePeer of livePeers) {
    db.insert(peers)
      .values({
        serverId: server.id,
        publicKey: livePeer.publicKey,
      })
      .onConflictDoNothing()
      .run();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function serverRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/servers
   * Lists all registered servers (no credentials)
   */
  fastify.get('/', async (request) => {
    const all = await listAccessibleServers(request.user);
    return all.map(sanitizeServer);
  });

  /**
   * GET /api/servers/:id
   * Returns a single server by ID
   */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await getAccessibleServerById(request.user, id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    return sanitizeServer(server);
  });

  /**
   * POST /api/servers
   * Registers a new WireGuard server
   */
  fastify.post('/', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createServerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const d = body.data;

    if (d.authMethod === 'key' && !d.sshKey) {
      return reply.code(400).send({ error: 'SSH key required for key auth' });
    }
    if (d.authMethod === 'password' && !d.sshPassword) {
      return reply.code(400).send({ error: 'SSH password required for password auth' });
    }
    if (d.executionMode === 'docker' && !d.dockerContainer) {
      return reply.code(400).send({ error: 'Docker container is required for docker execution mode' });
    }

    const transientServer = {
      id: 0,
      name: d.name,
      host: d.host,
      port: d.port,
      endpointHost: d.endpointHost ?? null,
      endpointPort: d.endpointPort ?? null,
      peerLimit: d.peerLimit ?? null,
      sshUser: d.sshUser,
      authMethod: d.authMethod,
      executionMode: d.executionMode,
      dockerContainer: d.dockerContainer ?? null,
      sshKey: d.sshKey ? encrypt(d.sshKey) : null,
      sshPassword: d.sshPassword ? encrypt(d.sshPassword) : null,
      wgInterface: d.wgInterface,
      description: d.description ?? null,
      createdAt: new Date().toISOString(),
    } satisfies Server;

    try {
      await testConnection(transientServer);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      await auditService.log({
        action: 'SERVER_ADD',
        performedBy: request.user.username,
        result: 'fail',
        errorMessage,
      });
      return reply.code(400).send({ error: 'SSH connection test failed', message: errorMessage });
    }

    const [inserted] = db
      .insert(servers)
      .values({
        name: d.name,
        host: d.host,
        port: d.port,
        endpointHost: d.endpointHost ?? null,
        endpointPort: d.endpointPort ?? null,
        peerLimit: d.peerLimit ?? null,
        sshUser: d.sshUser,
        authMethod: d.authMethod,
        executionMode: d.executionMode,
        dockerContainer: d.dockerContainer ?? null,
        sshKey: d.sshKey ? encrypt(d.sshKey) : null,
        sshPassword: d.sshPassword ? encrypt(d.sshPassword) : null,
        wgInterface: d.wgInterface,
        description: d.description ?? null,
      })
      .returning()
      .all();

    if (!inserted) return reply.code(500).send({ error: 'Insert failed' });

    try {
      await discoverPeers(inserted);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Peer discovery failed after save';
      await auditService.log({
        action: 'SERVER_DISCOVER_PEERS',
        serverId: inserted.id,
        performedBy: request.user.username,
        result: 'fail',
        errorMessage,
      });
      return reply.code(201).send({
        ...sanitizeServer(inserted),
        warning: `Server saved but peer discovery failed: ${errorMessage}`,
      });
    }

    await auditService.log({
      action: 'SERVER_ADD',
      serverId: inserted.id,
      performedBy: request.user.username,
      result: 'success',
    });

    return reply.code(201).send(sanitizeServer(inserted));
  });

  /**
   * PATCH /api/servers/:id
   * Updates an existing server (partial update)
   */
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const id = parseInt(request.params.id, 10);
    const [existing] = db.select().from(servers).where(eq(servers.id, id)).all();
    if (!existing) return reply.code(404).send({ error: 'Server not found' });

    const body = updateServerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const d = body.data;
    const updates: Partial<typeof servers.$inferInsert> = {};

    if (d.name !== undefined) updates.name = d.name;
    if (d.host !== undefined) updates.host = d.host;
    if (d.port !== undefined) updates.port = d.port;
    if (d.endpointHost !== undefined) updates.endpointHost = d.endpointHost;
    if (d.endpointPort !== undefined) updates.endpointPort = d.endpointPort;
    if (d.peerLimit !== undefined) updates.peerLimit = d.peerLimit;
    if (d.sshUser !== undefined) updates.sshUser = d.sshUser;
    if (d.authMethod !== undefined) updates.authMethod = d.authMethod;
    if (d.executionMode !== undefined) updates.executionMode = d.executionMode;
    if (d.dockerContainer !== undefined) updates.dockerContainer = d.dockerContainer;
    if (d.sshKey !== undefined) updates.sshKey = encrypt(d.sshKey);
    if (d.sshPassword !== undefined) updates.sshPassword = encrypt(d.sshPassword);
    if (d.wgInterface !== undefined) updates.wgInterface = d.wgInterface;
    if (d.description !== undefined) updates.description = d.description;

    const [updated] = db
      .update(servers)
      .set(updates)
      .where(eq(servers.id, id))
      .returning()
      .all();

    await auditService.log({
      action: 'SERVER_UPDATE',
      serverId: id,
      performedBy: request.user.username,
      result: 'success',
    });

    return sanitizeServer(updated!);
  });

  /**
   * DELETE /api/servers/:id
   * Removes a server and all its local peer metadata
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const id = parseInt(request.params.id, 10);
    const [existing] = db.select().from(servers).where(eq(servers.id, id)).all();
    if (!existing) return reply.code(404).send({ error: 'Server not found' });

    db.delete(servers).where(eq(servers.id, id)).run();

    await auditService.log({
      action: 'SERVER_DELETE',
      serverId: id,
      performedBy: request.user.username,
      result: 'success',
    });

    return reply.code(204).send();
  });

  /**
   * POST /api/servers/test-connection
   * Tests SSH connectivity without saving the server
   */
  fastify.post('/test-connection', { config: {} }, async (request, reply) => {
    try {
      requireAdmin(request.user);
    } catch {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = testConnectionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const d = body.data;

    // Build a transient Server-like object for testConnection
    const transient = {
      id: 0,
      name: 'test',
      host: d.host,
      port: d.port,
      endpointHost: d.endpointHost ?? null,
      endpointPort: d.endpointPort ?? null,
      peerLimit: d.peerLimit ?? null,
      sshUser: d.sshUser,
      authMethod: d.authMethod,
      executionMode: d.executionMode,
      dockerContainer: d.dockerContainer ?? null,
      // For test-connection we receive raw (unencrypted) credentials
      sshKey: d.sshKey ? encrypt(d.sshKey) : null,
      sshPassword: d.sshPassword ? encrypt(d.sshPassword) : null,
      wgInterface: 'wg0',
      description: null,
      createdAt: new Date().toISOString(),
    } satisfies Server;

    try {
      await testConnection(transient);
      return { success: true, message: 'SSH connection successful' };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      await auditService.log({
        action: 'SSH_TEST',
        performedBy: request.user.username,
        result: 'fail',
        errorMessage,
      });
      return reply.code(200).send({
        success: false,
        message: errorMessage,
      });
    }
  });

  /**
   * POST /api/servers/:id/test
   * Tests SSH connectivity for an already-registered server
   */
  fastify.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await getAccessibleServerById(request.user, id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    try {
      await testConnection(server);
      await auditService.log({
        action: 'SSH_TEST',
        serverId: id,
        performedBy: request.user.username,
        result: 'success',
      });
      return { success: true, message: 'SSH connection successful' };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      await auditService.log({
        action: 'SSH_TEST',
        serverId: id,
        performedBy: request.user.username,
        result: 'fail',
        errorMessage,
      });
      return { success: false, message: errorMessage };
    }
  });

  /**
   * GET /api/servers/:id/peers
   * Fetches live peers from the WireGuard server and merges with local metadata
   */
  fastify.get<{ Params: { id: string } }>('/:id/peers', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await getAccessibleServerById(request.user, id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    let livePeers;
    try {
      livePeers = await getLivePeers(server);
    } catch (err) {
      return reply.code(502).send({
        error: 'Failed to fetch peers from WireGuard server',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Sync local metadata: upsert peer records
    const localPeers = db.select().from(peers).where(eq(peers.serverId, id)).all();
    const localByKey = new Map(localPeers.map((p) => [p.publicKey, p]));

    // Insert any new peers discovered on the server
    for (const live of livePeers) {
      if (!localByKey.has(live.publicKey)) {
        db.insert(peers)
          .values({ serverId: id, publicKey: live.publicKey })
          .onConflictDoNothing()
          .run();
      }
    }

    // Re-fetch updated local metadata
    const updatedLocal = db.select().from(peers).where(eq(peers.serverId, id)).all();
    const updatedByKey = new Map(updatedLocal.map((p) => [p.publicKey, p]));

    // Merge live data with local metadata
    const merged = livePeers.map((live) => {
      const local = updatedByKey.get(live.publicKey);
      return {
        ...live,
        id: local?.id,
        alias: local?.alias ?? null,
        username: local?.username ?? null,
        notes: local?.notes ?? null,
        serverId: id,
        serverName: server.name,
      };
    });

    return merged;
  });
}
