/**
 * WireGuard management service.
 * Parses `wg show` output and executes peer revocation over SSH.
 */
import { createHash } from 'crypto';
import { execRemote } from './ssh.service.js';
import { auditService } from './audit.service.js';
import type { Server } from '../db/schema.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WgPeer {
  /** WireGuard public key (base64) */
  publicKey: string;
  /** Preshared key or "(none)" */
  presharedKey: string;
  /** Endpoint IP:port or "(none)" */
  endpoint: string;
  /** Comma-separated allowed IPs */
  allowedIps: string;
  /** Unix timestamp of last handshake (0 = never) */
  latestHandshakeUnix: number;
  /** Bytes received */
  transferRx: number;
  /** Bytes transmitted */
  transferTx: number;
  /** Persistent keepalive interval in seconds (0 = off) */
  persistentKeepalive: number;
  /** Derived: true if last handshake within 10 minutes */
  isActive: boolean;
}

export interface RevocationResult {
  serverId: number;
  serverName: string;
  publicKey: string;
  peerAlias?: string;
  success: boolean;
  error?: string;
}

export interface CreatePeerInput {
  allowedIps: string;
  alias?: string;
  persistentKeepalive?: number;
}

export interface CreatePeerResult {
  publicKey: string;
  privateKey: string;
  presharedKey: string | null;
  allowedIps: string;
  persistentKeepalive: number;
  clientConfig: string;
  remoteConfigPath: string;
}

const HOST_PEER_CONFIG_ROOT = '/etc/wireguard/peers';
const DOCKER_PEER_CONFIG_ROOT = '/config';

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function slugifyPeerLabel(value: string | undefined): string {
  const slug = (value ?? 'peer')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'peer';
}

function peerFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 12);
}

function buildPeerFolderName(publicKey: string, alias?: string): string {
  return `peer_${slugifyPeerLabel(alias)}-${peerFingerprint(publicKey)}`;
}

function getPeerConfigRoot(server: Server): string {
  return server.executionMode === 'docker'
    ? DOCKER_PEER_CONFIG_ROOT
    : HOST_PEER_CONFIG_ROOT;
}

function buildPeerConfigPath(server: Server, publicKey: string, alias?: string): string {
  return `${getPeerConfigRoot(server)}/${buildPeerFolderName(publicKey, alias)}`;
}

function isManagedPeerConfigPath(server: Server, remoteConfigPath: string): boolean {
  const root = getPeerConfigRoot(server);
  return (
    remoteConfigPath.startsWith(`${root}/peer_`) &&
    !remoteConfigPath.includes('\n') &&
    !remoteConfigPath.includes('\r') &&
    !remoteConfigPath.includes('..')
  );
}

/**
 * Wraps a WireGuard command so it runs either on the host or inside a Docker container.
 */
function buildWireGuardCommand(server: Server, innerCommand: string): string {
  if (server.executionMode === 'docker') {
    if (!server.dockerContainer) {
      throw new Error('Docker execution mode requires a container name');
    }
    return `docker exec ${shellEscape(server.dockerContainer)} sh -lc ${shellEscape(innerCommand)}`;
  }

  return innerCommand;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses the raw output of `wg show <iface> dump` into structured peer objects.
 *
 * The dump format (tab-separated) is:
 * - Line 0: interface info (private_key, public_key, listen_port, fwmark)
 * - Lines 1+: peer rows (public_key, preshared_key, endpoint, allowed_ips,
 *             latest_handshake, transfer_rx, transfer_tx, persistent_keepalive)
 */
export function parseWgDump(raw: string): WgPeer[] {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const peers: WgPeer[] = [];
  const ACTIVE_HANDSHAKE_WINDOW_S = 10 * 60;

  for (const line of lines.slice(1)) {
    const parts = line.split('\t');
    if (parts.length < 8) continue;

    const [
      publicKey = '',
      presharedKey = '',
      endpoint = '',
      allowedIps = '',
      latestHandshakeRaw = '0',
      transferRxRaw = '0',
      transferTxRaw = '0',
      persistentKeepaliveRaw = 'off',
    ] = parts;

    const latestHandshakeUnix = parseInt(latestHandshakeRaw, 10) || 0;
    const nowUnix = Math.floor(Date.now() / 1000);
    const secondsSinceHandshake = nowUnix - latestHandshakeUnix;
    const isActive =
      latestHandshakeUnix > 0 && secondsSinceHandshake < ACTIVE_HANDSHAKE_WINDOW_S;

    peers.push({
      publicKey,
      presharedKey,
      endpoint,
      allowedIps,
      latestHandshakeUnix,
      transferRx: parseInt(transferRxRaw, 10) || 0,
      transferTx: parseInt(transferTxRaw, 10) || 0,
      persistentKeepalive:
        persistentKeepaliveRaw === 'off'
          ? 0
          : parseInt(persistentKeepaliveRaw, 10) || 0,
      isActive,
    });
  }

  return peers;
}

// ─── Live Data ─────────────────────────────────────────────────────────────────

/**
 * Fetches live peer data from a WireGuard server via SSH.
 * Runs `wg show <interface> dump` and parses the output.
 */
export async function getLivePeers(server: Server): Promise<WgPeer[]> {
  const { stdout, exitCode, stderr } = await execRemote(
    server,
    buildWireGuardCommand(server, `wg show ${shellEscape(server.wgInterface)} dump`)
  );

  if (exitCode !== 0) {
    throw new Error(
      `wg show failed (exit ${exitCode}): ${stderr || 'unknown error'}`
    );
  }

  return parseWgDump(stdout);
}

async function writePeerConfigDirectory(
  server: Server,
  publicKey: string,
  clientConfig: string,
  alias?: string
): Promise<string> {
  const remoteConfigPath = buildPeerConfigPath(server, publicKey, alias);
  const folderName = remoteConfigPath.split('/').at(-1);
  if (!folderName || !isManagedPeerConfigPath(server, remoteConfigPath)) {
    throw new Error('Refusing to write peer config outside the managed directory');
  }

  const configPath = `${remoteConfigPath}/${folderName}.conf`;
  const qrPath = `${remoteConfigPath}/${folderName}.png`;
  const configBase64 = Buffer.from(clientConfig, 'utf8').toString('base64');

  const command = [
    'set -e',
    `dir=${shellEscape(remoteConfigPath)}`,
    `conf=${shellEscape(configPath)}`,
    `qr=${shellEscape(qrPath)}`,
    'umask 077',
    'mkdir -p "$dir"',
    `printf %s ${shellEscape(configBase64)} | base64 -d > "$conf"`,
    'chmod 700 "$dir"',
    'chmod 600 "$conf"',
    'if command -v qrencode >/dev/null 2>&1; then qrencode -o "$qr" < "$conf" || rm -f "$qr"; fi',
  ].join('; ');

  const result = await execRemote(server, buildWireGuardCommand(server, command));
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to create peer config directory: ${result.stderr || 'unknown error'}`
    );
  }

  return remoteConfigPath;
}

async function removePeerConfigDirectory(
  server: Server,
  remoteConfigPath: string
): Promise<void> {
  if (!isManagedPeerConfigPath(server, remoteConfigPath)) {
    throw new Error('Refusing to remove peer config outside the managed directory');
  }

  const command = [
    'set -e',
    `dir=${shellEscape(remoteConfigPath)}`,
    'if [ -d "$dir" ]; then rm -rf "$dir"; fi',
    'if [ -e "$dir" ]; then echo "managed peer directory still exists" >&2; exit 1; fi',
  ].join('; ');

  const result = await execRemote(server, buildWireGuardCommand(server, command));
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to remove peer config directory: ${result.stderr || 'unknown error'}`
    );
  }
}

async function rollbackCreatedPeer(
  server: Server,
  publicKey: string,
  remoteConfigPath: string
): Promise<string | null> {
  const iface = server.wgInterface;
  const errors: string[] = [];

  try {
    await removePeerConfigDirectory(server, remoteConfigPath);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const removeResult = await execRemote(
      server,
      buildWireGuardCommand(
        server,
        `wg set ${shellEscape(iface)} peer ${shellEscape(publicKey)} remove`
      )
    );
    if (removeResult.exitCode !== 0) {
      errors.push(removeResult.stderr || 'wg set remove failed during rollback');
    }

    const saveResult = await execRemote(
      server,
      buildWireGuardCommand(server, `wg-quick save ${shellEscape(iface)}`)
    );
    if (saveResult.exitCode !== 0) {
      errors.push(saveResult.stderr || 'wg-quick save failed during rollback');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return errors.length > 0 ? errors.join('; ') : null;
}

/**
 * Creates a new WireGuard peer on a server and returns a ready-to-use client config.
 *
 * @param server - Target WireGuard server
 * @param input - Peer network settings
 * @returns Generated key material plus the client configuration text
 */
export async function createPeer(
  server: Server,
  input: CreatePeerInput
): Promise<CreatePeerResult> {
  const iface = server.wgInterface;
  const keepalive = input.persistentKeepalive ?? 25;

  const keygenResult = await execRemote(
    server,
    buildWireGuardCommand(
      server,
      "client_private=$(wg genkey) && client_public=$(printf '%s' \"$client_private\" | wg pubkey) && printf '%s\t%s' \"$client_private\" \"$client_public\""
    )
  );

  if (keygenResult.exitCode !== 0) {
    throw new Error(`Peer key generation failed: ${keygenResult.stderr || 'unknown error'}`);
  }

  const [privateKey, publicKey] = keygenResult.stdout.split('\t');
  if (!privateKey || !publicKey) {
    throw new Error('Peer key generation returned an invalid response');
  }

  const endpointHost = server.endpointHost ?? server.host;

  const serverPublicKeyResult = await execRemote(
    server,
    buildWireGuardCommand(server, `wg show ${shellEscape(iface)} public-key`)
  );
  if (serverPublicKeyResult.exitCode !== 0 || !serverPublicKeyResult.stdout) {
    throw new Error(`Failed to read server public key: ${serverPublicKeyResult.stderr || 'unknown error'}`);
  }

  const serverPortResult = await execRemote(
    server,
    buildWireGuardCommand(server, `wg show ${shellEscape(iface)} listen-port`)
  );
  if (serverPortResult.exitCode !== 0 || !serverPortResult.stdout) {
    throw new Error(`Failed to read listen port: ${serverPortResult.stderr || 'unknown error'}`);
  }

  const addResult = await execRemote(
    server,
    buildWireGuardCommand(
      server,
      `wg set ${shellEscape(iface)} peer ${shellEscape(publicKey)} allowed-ips ${shellEscape(input.allowedIps)} persistent-keepalive ${shellEscape(String(keepalive))}`
    )
  );
  if (addResult.exitCode !== 0) {
    throw new Error(`Failed to add peer: ${addResult.stderr || 'unknown error'}`);
  }

  const saveResult = await execRemote(
    server,
    buildWireGuardCommand(server, `wg-quick save ${shellEscape(iface)}`)
  );
  if (saveResult.exitCode !== 0) {
    throw new Error(`Failed to persist peer: ${saveResult.stderr || 'unknown error'}`);
  }

  const verifyResult = await execRemote(
    server,
    buildWireGuardCommand(
      server,
      `wg show ${shellEscape(iface)} peers | grep -F -c -- ${shellEscape(publicKey)} || true`
    )
  );
  const verifyCount = parseInt(verifyResult.stdout, 10) || 0;
  if (verifyCount === 0) {
    throw new Error('Peer creation verification failed');
  }

  const serverPort =
    server.endpointPort ??
    (parseInt(serverPortResult.stdout, 10) || 51820);
  const clientConfig = `[Interface]
PrivateKey = ${privateKey}
Address = ${input.allowedIps}
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKeyResult.stdout}
AllowedIPs = 0.0.0.0/0
Endpoint = ${endpointHost}:${serverPort}
PersistentKeepalive = ${keepalive}`;

  const remoteConfigPath = buildPeerConfigPath(server, publicKey, input.alias);
  try {
    await writePeerConfigDirectory(server, publicKey, clientConfig, input.alias);
  } catch (error) {
    const rollbackError = await rollbackCreatedPeer(server, publicKey, remoteConfigPath);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      rollbackError
        ? `${errorMessage}. Rollback also failed: ${rollbackError}`
        : errorMessage
    );
  }

  return {
    publicKey,
    privateKey,
    presharedKey: null,
    allowedIps: input.allowedIps,
    persistentKeepalive: keepalive,
    clientConfig,
    remoteConfigPath,
  };
}

// ─── Revocation ───────────────────────────────────────────────────────────────

/**
 * Revokes a single peer from a WireGuard server via SSH.
 *
 * Sequence:
 * 1. `wg set <iface> peer <pubkey> remove`
 * 2. `wg-quick save <iface>` (persist config)
 * 3. Verify: `wg show <iface> peers | grep <pubkey>` must return empty
 *
 * @param server - Target WireGuard server
 * @param publicKey - Peer's public key to revoke
 * @param performedBy - Username performing the action (for audit log)
 */
export async function revokePeer(
  server: Server,
  publicKey: string,
  performedBy: string,
  peerAlias?: string,
  remoteConfigPath?: string
): Promise<RevocationResult> {
  const iface = server.wgInterface;
  const result: RevocationResult = {
    serverId: server.id,
    serverName: server.name,
    publicKey,
    success: false,
    ...(peerAlias ? { peerAlias } : {}),
  };

  try {
    // Step 1: Remove peer from running config
    const removeResult = await execRemote(
      server,
      buildWireGuardCommand(
        server,
        `wg set ${shellEscape(iface)} peer ${shellEscape(publicKey)} remove`
      )
    );
    if (removeResult.exitCode !== 0) {
      throw new Error(`wg set remove failed: ${removeResult.stderr}`);
    }

    // Step 2: Persist config to disk
    const saveResult = await execRemote(
      server,
      buildWireGuardCommand(server, `wg-quick save ${shellEscape(iface)}`)
    );
    if (saveResult.exitCode !== 0) {
      // Non-fatal: config may still be effective in memory
      console.warn(
        `[WG] wg-quick save warning for server ${server.id}: ${saveResult.stderr}`
      );
    }

    // Step 3: Verify removal
    const verifyResult = await execRemote(
      server,
      buildWireGuardCommand(
        server,
        `wg show ${shellEscape(iface)} peers | grep -F -c -- ${shellEscape(publicKey)} || true`
      )
    );
    const count = parseInt(verifyResult.stdout, 10);
    if (count > 0) {
      throw new Error('Peer still present after removal — verification failed');
    }

    await removePeerConfigDirectory(
      server,
      remoteConfigPath ?? buildPeerConfigPath(server, publicKey, peerAlias)
    );

    result.success = true;

    await auditService.log({
      action: 'PEER_REVOKE',
      serverId: server.id,
      peerPublicKey: publicKey,
      performedBy,
      result: 'success',
      ...(peerAlias ? { peerAlias } : {}),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.error = errorMessage;

    await auditService.log({
      action: 'PEER_REVOKE',
      serverId: server.id,
      peerPublicKey: publicKey,
      performedBy,
      result: 'fail',
      errorMessage,
      ...(peerAlias ? { peerAlias } : {}),
    });
  }

  return result;
}

/**
 * Bulk-revokes multiple peers across multiple servers.
 * Operations are executed in parallel per-server, sequentially within each server.
 */
export async function bulkRevoke(
  targets: Array<{
    server: Server;
    publicKey: string;
    alias?: string;
    remoteConfigPath?: string;
  }>,
  performedBy: string
): Promise<RevocationResult[]> {
  // Group targets by server
  const byServer = new Map<number, typeof targets>();
  for (const t of targets) {
    const list = byServer.get(t.server.id) ?? [];
    list.push(t);
    byServer.set(t.server.id, list);
  }

  // Revoke per-server in parallel, sequential within server
  const results = await Promise.all(
    Array.from(byServer.values()).map(async (serverTargets) => {
      const serverResults: RevocationResult[] = [];
      for (const target of serverTargets) {
        const r = await revokePeer(
          target.server,
          target.publicKey,
          performedBy,
          target.alias,
          target.remoteConfigPath
        );
        serverResults.push(r);
      }
      return serverResults;
    })
  );

  return results.flat();
}
