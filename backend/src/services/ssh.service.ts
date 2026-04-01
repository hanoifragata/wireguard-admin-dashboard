/**
 * SSH connection pool and command execution service.
 * Maintains one persistent SSH connection per server, auto-reconnecting on failure.
 */
import { Client, type ConnectConfig } from 'ssh2';
import { decrypt } from '../lib/crypto.js';
import type { Server } from '../db/schema.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface PoolEntry {
  client: Client;
  serverId: number;
  connectedAt: Date;
  lastUsedAt: Date;
}

/** SSH connection pool keyed by server ID */
const pool = new Map<number, PoolEntry>();

/** Maximum connection idle time before eviction (10 minutes) */
const MAX_IDLE_MS = 10 * 60 * 1000;

/**
 * Builds SSH ConnectConfig from a Server record, decrypting credentials.
 */
function buildConnectConfig(server: Server): ConnectConfig {
  const base: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.sshUser,
    readyTimeout: 15_000,
    keepaliveInterval: 30_000,
  };

  if (server.authMethod === 'key') {
    if (!server.sshKey) throw new Error('SSH key not configured for this server');
    base.privateKey = decrypt(server.sshKey);
  } else {
    if (!server.sshPassword) throw new Error('SSH password not configured for this server');
    base.password = decrypt(server.sshPassword);
  }

  return base;
}

/**
 * Returns a connected SSH client for the given server, reusing from pool if available.
 */
async function getConnection(server: Server): Promise<Client> {
  const existing = pool.get(server.id);
  if (existing) {
    const idleMs = Date.now() - existing.lastUsedAt.getTime();
    if (idleMs < MAX_IDLE_MS) {
      existing.lastUsedAt = new Date();
      return existing.client;
    }
    // Evict stale connection
    existing.client.end();
    pool.delete(server.id);
  }

  return createConnection(server);
}

/**
 * Creates a new SSH connection for the given server and adds it to the pool.
 */
async function createConnection(server: Server): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const config = buildConnectConfig(server);

    client.once('ready', () => {
      pool.set(server.id, {
        client,
        serverId: server.id,
        connectedAt: new Date(),
        lastUsedAt: new Date(),
      });

      client.once('error', () => {
        pool.delete(server.id);
      });

      client.once('end', () => {
        pool.delete(server.id);
      });

      resolve(client);
    });

    client.once('error', (err: Error) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    client.connect(config);
  });
}

/**
 * Executes a shell command on the remote server via SSH.
 *
 * @param server - The server record (used to build/reuse SSH connection)
 * @param command - Shell command to run
 * @returns stdout, stderr, and exit code
 */
export async function execRemote(
  server: Server,
  command: string
): Promise<ExecResult> {
  const client = await getConnection(server);

  return new Promise((resolve, reject) => {
    client.exec(command, { pty: false }, (err, stream) => {
      if (err) {
        reject(new Error(`exec failed: ${err.message}`));
        return;
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      stream.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      stream.on('close', (code: number | null) => {
        const entry = pool.get(server.id);
        if (entry) entry.lastUsedAt = new Date();

        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
          stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
          exitCode: code ?? 0,
        });
      });

      stream.on('error', (err: Error) => {
        reject(new Error(`stream error: ${err.message}`));
      });
    });
  });
}

/**
 * Tests SSH connectivity to a server without adding it to the pool.
 *
 * @returns true if connection succeeds, throws on failure
 */
export async function testConnection(server: Server): Promise<true> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const config = buildConnectConfig(server);

    const timeout = setTimeout(() => {
      client.end();
      reject(new Error('Connection timed out after 15s'));
    }, 15_000);

    client.once('ready', () => {
      clearTimeout(timeout);
      client.end();
      resolve(true);
    });

    client.once('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`SSH error: ${err.message}`));
    });

    client.connect(config);
  });
}

/**
 * Disconnects and removes the SSH connection for a server from the pool.
 */
export function disconnectServer(serverId: number): void {
  const entry = pool.get(serverId);
  if (entry) {
    entry.client.end();
    pool.delete(serverId);
  }
}

/**
 * Evicts all idle connections that have exceeded MAX_IDLE_MS.
 * Should be called periodically (e.g., every 5 minutes).
 */
export function evictIdleConnections(): void {
  const now = Date.now();
  for (const [id, entry] of pool.entries()) {
    if (now - entry.lastUsedAt.getTime() > MAX_IDLE_MS) {
      entry.client.end();
      pool.delete(id);
    }
  }
}
