/**
 * Peer management routes: list all peers, search, update metadata, bulk revoke.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { peers, servers } from '../db/schema.js';
import { eq, like, and, or, inArray, type SQL } from 'drizzle-orm';
import { bulkRevoke, createPeer, getLivePeers } from '../services/wireguard.service.js';
import { auditService } from '../services/audit.service.js';
import { getAccessibleServerIds } from '../services/access.service.js';
import { decrypt, encrypt } from '../lib/crypto.js';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const updatePeerSchema = z.object({
  alias: z.string().max(100).optional(),
  username: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

const createPeerSchema = z.object({
  serverId: z.number().int().positive(),
  alias: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  persistentKeepalive: z.number().int().min(0).max(65535).optional(),
});

const bulkRevokeSchema = z.object({
  targets: z
    .array(
      z.object({
        serverId: z.number().int().positive(),
        publicKey: z.string().min(1),
        alias: z.string().optional(),
      })
    )
    .min(1)
    .max(200),
});

function parseIpv4(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }

  return result >>> 0;
}

function formatIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function inferNextAvailableAllowedIp(existingAllowedIps: string[]): string {
  const usedIps = new Set<number>();
  let networkBase: number | null = null;
  let prefix: number | null = null;
  const discoveredIps: number[] = [];

  for (const allowedIps of existingAllowedIps) {
    const firstEntry = allowedIps
      .split(',')
      .map((entry) => entry.trim())
      .find(Boolean);

    if (!firstEntry) continue;

    const [ipRaw, prefixRaw] = firstEntry.split('/');
    const ipValue = ipRaw ? parseIpv4(ipRaw) : null;
    const parsedPrefix = prefixRaw ? Number(prefixRaw) : 32;
    if (ipValue === null || Number.isNaN(parsedPrefix) || parsedPrefix < 0 || parsedPrefix > 32) {
      continue;
    }

    discoveredIps.push(ipValue);

    if (networkBase === null && parsedPrefix < 32) {
      const mask = parsedPrefix === 0 ? 0 : ((0xffffffff << (32 - parsedPrefix)) >>> 0);
      networkBase = ipValue & mask;
      prefix = parsedPrefix;
    }

    usedIps.add(ipValue);
  }

  if (discoveredIps.length === 0) {
    throw new Error('Unable to infer peer subnet automatically. Add one peer manually first or update the server config.');
  }

  if (networkBase === null || prefix === null) {
    // Most WireGuard installs keep peers as /32 entries only. In that case,
    // infer a practical /24 from the first discovered peer address.
    const seedIp = discoveredIps[0];
    if (seedIp === undefined) {
      throw new Error('Unable to infer peer subnet automatically. Add one peer manually first or update the server config.');
    }
    prefix = 24;
    networkBase = seedIp & 0xffffff00;
  }

  const hostCapacity = prefix === 32 ? 1 : Math.max(1, 2 ** (32 - prefix));
  for (let hostOffset = 2; hostOffset < hostCapacity - 1; hostOffset += 1) {
    const candidate = (networkBase + hostOffset) >>> 0;
    if (!usedIps.has(candidate)) {
      return `${formatIpv4(candidate)}/32`;
    }
  }

  throw new Error('No available peer IPs found in the inferred subnet');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function peerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/peers
   * Creates a new peer on a target server and stores local metadata.
   */
  fastify.post('/', async (request, reply) => {
    const body = createPeerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const accessibleServerIds = await getAccessibleServerIds(request.user);
    if (!accessibleServerIds.includes(body.data.serverId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const server = db.select().from(servers).where(eq(servers.id, body.data.serverId)).get();
    if (!server) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    if (server.peerLimit !== null && server.peerLimit !== undefined) {
      const currentPeerCount = db
        .select({ count: db.$count(peers, eq(peers.serverId, server.id)) })
        .from(peers)
        .all()[0]?.count ?? 0;

      if (currentPeerCount >= server.peerLimit) {
        return reply.code(400).send({
          error: `Peer limit reached for this server (${server.peerLimit})`,
        });
      }
    }

    try {
      const livePeers = await getLivePeers(server);
      const allowedIps = inferNextAvailableAllowedIp(
        livePeers.map((peer) => peer.allowedIps).filter((value) => value.length > 0)
      );

      const createdPeer = await createPeer(server, {
        allowedIps,
        ...(body.data.persistentKeepalive !== undefined
          ? { persistentKeepalive: body.data.persistentKeepalive }
          : {}),
      });

      const [storedPeer] = db
        .insert(peers)
        .values({
          serverId: server.id,
          publicKey: createdPeer.publicKey,
          clientConfig: encrypt(createdPeer.clientConfig),
          ...(body.data.alias ? { alias: body.data.alias } : {}),
          ...(body.data.notes ? { notes: body.data.notes } : {}),
        })
        .returning()
        .all();

      await auditService.log({
        action: 'PEER_CREATE',
        serverId: server.id,
        peerPublicKey: createdPeer.publicKey,
        performedBy: request.user.username,
        result: 'success',
        ...(body.data.alias ? { peerAlias: body.data.alias } : {}),
      });

      return reply.code(201).send({
        peer: {
          id: storedPeer?.id ?? 0,
          serverId: server.id,
          serverName: server.name,
          publicKey: createdPeer.publicKey,
          alias: body.data.alias ?? null,
          username: null,
          notes: body.data.notes ?? null,
          hasConfig: true,
          createdAt: storedPeer?.createdAt ?? new Date().toISOString(),
          updatedAt: storedPeer?.updatedAt ?? new Date().toISOString(),
        },
        config: createdPeer.clientConfig,
        privateKey: createdPeer.privateKey,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Peer creation failed';
      await auditService.log({
        action: 'PEER_CREATE',
        serverId: server.id,
        performedBy: request.user.username,
        result: 'fail',
        errorMessage,
        ...(body.data.alias ? { peerAlias: body.data.alias } : {}),
      });
      return reply.code(400).send({ error: errorMessage });
    }
  });

  /**
   * GET /api/peers
   * Returns local peer metadata with optional alias/username search.
   * Query params: alias, username, serverId
   */
  fastify.get('/', async (request) => {
    const { alias, username, serverId } = request.query as Record<string, string | undefined>;
    const accessibleServerIds = await getAccessibleServerIds(request.user);

    const conditions: SQL[] = [];
    if (accessibleServerIds.length === 0) return [];
    conditions.push(inArray(peers.serverId, accessibleServerIds));

    if (alias) {
      conditions.push(like(peers.alias, `%${alias}%`));
    }
    if (username) {
      conditions.push(
        or(
          like(peers.username, `%${username}%`),
          like(peers.alias, `%${username}%`)
        )!
      );
    }
    if (serverId) {
      conditions.push(eq(peers.serverId, parseInt(serverId, 10)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = db
      .select({
        id: peers.id,
        serverId: peers.serverId,
        serverName: servers.name,
        publicKey: peers.publicKey,
        alias: peers.alias,
        username: peers.username,
        notes: peers.notes,
        clientConfig: peers.clientConfig,
        createdAt: peers.createdAt,
        updatedAt: peers.updatedAt,
        wgInterface: servers.wgInterface,
      })
      .from(peers)
      .leftJoin(servers, eq(peers.serverId, servers.id))
      .where(whereClause)
      .all();

    const scopedServerIds = serverId
      ? [parseInt(serverId, 10)]
      : [...new Set(rows.map((row) => row.serverId))];

    const serverRows = scopedServerIds.length
      ? db
          .select()
          .from(servers)
          .where(inArray(servers.id, scopedServerIds))
          .all()
      : [];

    const livePeersByServer = new Map<number, Map<string, Awaited<ReturnType<typeof getLivePeers>>[number]>>();

    await Promise.all(
      serverRows.map(async (server) => {
        try {
          const livePeers = await getLivePeers(server);
          livePeersByServer.set(
            server.id,
            new Map(livePeers.map((livePeer) => [livePeer.publicKey, livePeer]))
          );
        } catch (error) {
          fastify.log.warn(
            {
              serverId: server.id,
              serverName: server.name,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to fetch live peers for server'
          );
          livePeersByServer.set(server.id, new Map());
        }
      })
    );

    return rows.map((row) => {
      const live = livePeersByServer.get(row.serverId)?.get(row.publicKey);
      const status = !live
        ? 'unavailable'
        : live.isActive
          ? 'healthy'
          : live.latestHandshakeUnix > 0
            ? 'quiet'
            : 'never-established';
      const { clientConfig, ...safeRow } = row;

      return {
        ...safeRow,
        allowedIps: live?.allowedIps ?? null,
        endpoint: live?.endpoint ?? null,
        latestHandshakeUnix: live?.latestHandshakeUnix ?? 0,
        transferRx: live?.transferRx ?? 0,
        transferTx: live?.transferTx ?? 0,
        persistentKeepalive: live?.persistentKeepalive ?? 0,
        isActive: live?.isActive ?? false,
        status,
        hasConfig: clientConfig !== null,
      };
    });
  });

  /**
   * GET /api/peers/:id
   * Returns a single peer's local metadata
   */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const accessibleServerIds = await getAccessibleServerIds(request.user);
    if (accessibleServerIds.length === 0) {
      return reply.code(404).send({ error: 'Peer not found' });
    }
    const [peer] = db
      .select({
        id: peers.id,
        serverId: peers.serverId,
        serverName: servers.name,
        publicKey: peers.publicKey,
        alias: peers.alias,
        username: peers.username,
        notes: peers.notes,
        clientConfig: peers.clientConfig,
        createdAt: peers.createdAt,
        updatedAt: peers.updatedAt,
      })
      .from(peers)
      .leftJoin(servers, eq(peers.serverId, servers.id))
      .where(and(eq(peers.id, id), inArray(peers.serverId, accessibleServerIds)))
      .all();

    if (!peer) return reply.code(404).send({ error: 'Peer not found' });
    const { clientConfig, ...safePeer } = peer;
    return {
      ...safePeer,
      hasConfig: clientConfig !== null,
    };
  });

  /**
   * GET /api/peers/:id/config
   * Downloads the stored client configuration for peers created from the dashboard.
   */
  fastify.get<{ Params: { id: string } }>('/:id/config', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const accessibleServerIds = await getAccessibleServerIds(request.user);
    if (accessibleServerIds.length === 0) {
      return reply.code(404).send({ error: 'Peer not found' });
    }

    const [peer] = db
      .select({
        id: peers.id,
        serverId: peers.serverId,
        publicKey: peers.publicKey,
        alias: peers.alias,
        clientConfig: peers.clientConfig,
      })
      .from(peers)
      .where(and(eq(peers.id, id), inArray(peers.serverId, accessibleServerIds)))
      .all();

    if (!peer) {
      return reply.code(404).send({ error: 'Peer not found' });
    }

    if (!peer.clientConfig) {
      return reply
        .code(404)
        .send({ error: 'Client config is not available for this peer' });
    }

    const safeAlias = (peer.alias?.trim() || 'wireguard-peer').replace(/[^a-zA-Z0-9._-]+/g, '-');

    return {
      filename: `${safeAlias}.conf`,
      publicKey: peer.publicKey,
      config: decrypt(peer.clientConfig),
    };
  });

  /**
   * PATCH /api/peers/:id
   * Updates local metadata for a peer (alias, username, notes)
   */
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const accessibleServerIds = await getAccessibleServerIds(request.user);
    const [existing] = db
      .select()
      .from(peers)
      .where(and(eq(peers.id, id), inArray(peers.serverId, accessibleServerIds)))
      .all();
    if (!existing) return reply.code(404).send({ error: 'Peer not found' });

    const body = updatePeerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof peers.$inferInsert> = { updatedAt: now };

    if (body.data.alias !== undefined) updates.alias = body.data.alias;
    if (body.data.username !== undefined) updates.username = body.data.username;
    if (body.data.notes !== undefined) updates.notes = body.data.notes;

    const [updated] = db
      .update(peers)
      .set(updates)
      .where(eq(peers.id, id))
      .returning()
      .all();

    await auditService.log({
      action: 'PEER_UPDATE_METADATA',
      serverId: existing.serverId,
      peerPublicKey: existing.publicKey,
      performedBy: request.user.username,
      result: 'success',
      ...(updated?.alias ? { peerAlias: updated.alias } : {}),
    });

    if (!updated) {
      return reply.code(500).send({ error: 'Peer update failed' });
    }

    const { clientConfig, ...safeUpdated } = updated;
    return {
      ...safeUpdated,
      serverName: null,
      hasConfig: clientConfig !== null,
    };
  });

  /**
   * DELETE /api/peers/bulk
   * Revokes multiple peers across one or more servers via SSH.
   * Body: { targets: [{ serverId, publicKey, alias? }] }
   */
  fastify.delete('/bulk', async (request, reply) => {
    const body = bulkRevokeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const { targets } = body.data;

    // Fetch all relevant servers
    const serverIds = [...new Set(targets.map((t) => t.serverId))];
    const accessibleServerIds = await getAccessibleServerIds(request.user);
    if (!serverIds.every((id) => accessibleServerIds.includes(id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const serverRows = db
      .select()
      .from(servers)
      .where(inArray(servers.id, serverIds))
      .all();

    if (serverRows.length !== serverIds.length) {
      return reply.code(404).send({ error: 'One or more servers not found' });
    }

    const serverMap = new Map(serverRows.map((s) => [s.id, s]));

    // Build revocation targets with server objects
    const revocationTargets = targets.map((t) => ({
      server: serverMap.get(t.serverId)!,
      publicKey: t.publicKey,
      ...(t.alias ? { alias: t.alias } : {}),
    }));

    const results = await bulkRevoke(revocationTargets, request.user.username);

    // Remove successfully revoked peers from local DB
    for (const result of results) {
      if (result.success) {
        db.delete(peers)
          .where(
            and(
              eq(peers.serverId, result.serverId),
              eq(peers.publicKey, result.publicKey)
            )
          )
          .run();
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      results,
      summary: { total: results.length, success: successCount, fail: failCount },
    };
  });
}
