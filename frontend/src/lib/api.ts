/**
 * Typed API client for the WireGuard Manager backend.
 * All requests automatically attach the JWT access token.
 */
import { useAuthStore } from '@/store/auth.store.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Server {
  id: number;
  name: string;
  host: string;
  port: number;
  endpointHost: string | null;
  endpointPort: number | null;
  peerLimit: number | null;
  sshUser: string;
  authMethod: 'key' | 'password';
  executionMode: 'host' | 'docker';
  dockerContainer: string | null;
  wgInterface: string;
  description: string | null;
  createdAt: string;
  hasKey: boolean;
  hasPassword: boolean;
  warning?: string;
}

export interface WgPeer {
  publicKey: string;
  presharedKey: string;
  endpoint: string;
  allowedIps: string;
  latestHandshakeUnix: number;
  transferRx: number;
  transferTx: number;
  persistentKeepalive: number;
  isActive: boolean;
  // Merged local metadata
  id?: number;
  serverId: number;
  serverName: string;
  alias: string | null;
  username: string | null;
  notes: string | null;
}

export interface PeerMetadata {
  id: number;
  serverId: number;
  serverName: string | null;
  publicKey: string;
  alias: string | null;
  username: string | null;
  notes: string | null;
  hasConfig: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalPeer extends PeerMetadata {
  serverName: string | null;
  wgInterface: string | null;
  allowedIps: string | null;
  endpoint: string | null;
  latestHandshakeUnix: number;
  transferRx: number;
  transferTx: number;
  persistentKeepalive: number;
  isActive: boolean;
  status: 'healthy' | 'quiet' | 'never-established' | 'unavailable';
}

export interface AuditLog {
  id: number;
  action: string;
  serverId: number | null;
  peerPublicKey: string | null;
  peerAlias: string | null;
  performedBy: string;
  result: 'success' | 'fail';
  errorMessage: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface RevocationResult {
  serverId: number;
  serverName: string;
  publicKey: string;
  peerAlias?: string;
  success: boolean;
  error?: string;
}

export interface BulkRevokeResponse {
  results: RevocationResult[];
  summary: { total: number; success: number; fail: number };
}

export interface CreatePeerResponse {
  peer: PeerMetadata;
  config: string;
  privateKey: string;
}

export interface PeerConfigDownload {
  filename: string;
  publicKey: string;
  config: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface CreateServerInput {
  name: string;
  host: string;
  port: number;
  endpointHost?: string;
  endpointPort?: number;
  peerLimit?: number;
  sshUser: string;
  authMethod: 'key' | 'password';
  executionMode: 'host' | 'docker';
  dockerContainer?: string;
  sshKey?: string;
  sshPassword?: string;
  wgInterface: string;
  description?: string;
}

export interface UserSummary {
  id: number;
  username: string;
  role: 'admin' | 'operator';
  createdAt: string;
  serverIds: number[];
  servers?: Array<{ id: number; name: string }>;
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Try to refresh the token
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry with new token
      headers['Authorization'] = `Bearer ${useAuthStore.getState().accessToken}`;
      const retry = await fetch(url, {
        ...init,
        headers,
        credentials: 'include',
      });
      if (!retry.ok) {
        const body = await retry.json().catch(() => ({}));
        throw new ApiError(retry.status, (body as { error?: string }).error ?? retry.statusText, body);
      }
      return retry.json() as Promise<T>;
    }
    // Refresh failed — log out
    useAuthStore.getState().logout();
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const refreshUrl = `${API_BASE_URL}/auth/refresh`;
    const res = await fetch(refreshUrl, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      accessToken: string;
      username: string;
      role: 'admin' | 'operator';
    };
    useAuthStore.getState().setToken(data.accessToken, data.username, data.role);
    return true;
  } catch {
    return false;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (username: string, password: string) =>
    request<{ accessToken: string; username: string; role: 'admin' | 'operator' }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ id: number; username: string; role: 'admin' | 'operator' }>('/auth/me'),
};

// ─── Servers ──────────────────────────────────────────────────────────────────

export const serversApi = {
  list: () => request<Server[]>('/servers'),

  get: (id: number) => request<Server>(`/servers/${id}`),

  create: (data: CreateServerInput) =>
    request<Server>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<CreateServerInput>) =>
    request<Server>(`/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    request<void>(`/servers/${id}`, { method: 'DELETE' }),

  testConnection: (data: {
    host: string;
    port: number;
    endpointHost?: string;
    endpointPort?: number;
    sshUser: string;
    authMethod: 'key' | 'password';
    executionMode: 'host' | 'docker';
    dockerContainer?: string;
    sshKey?: string;
    sshPassword?: string;
  }) =>
    request<ConnectionTestResult>('/servers/test-connection', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  testSaved: (id: number) =>
    request<ConnectionTestResult>(`/servers/${id}/test`, { method: 'POST' }),

  peers: (id: number) => request<WgPeer[]>(`/servers/${id}/peers`),
};

// ─── Peers ────────────────────────────────────────────────────────────────────

export const peersApi = {
  create: (data: {
    serverId: number;
    alias?: string;
    notes?: string;
    persistentKeepalive?: number;
  }) =>
    request<CreatePeerResponse>('/peers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: (params?: { alias?: string; username?: string; serverId?: number }) => {
    const qs = new URLSearchParams();
    if (params?.alias) qs.set('alias', params.alias);
    if (params?.username) qs.set('username', params.username);
    if (params?.serverId) qs.set('serverId', String(params.serverId));
    const query = qs.toString();
    return request<GlobalPeer[]>(`/peers${query ? `?${query}` : ''}`);
  },

  get: (id: number) => request<PeerMetadata>(`/peers/${id}`),

  downloadConfig: (id: number) =>
    request<PeerConfigDownload>(`/peers/${id}/config`),

  update: (id: number, data: { alias?: string; username?: string; notes?: string }) =>
    request<PeerMetadata>(`/peers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  bulkRevoke: (targets: Array<{ serverId: number; publicKey: string; alias?: string }>) =>
    request<BulkRevokeResponse>('/peers/bulk', {
      method: 'DELETE',
      body: JSON.stringify({ targets }),
    }),
};

// ─── Audit ────────────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params?: {
    limit?: number;
    offset?: number;
    serverId?: number;
    action?: string;
    performedBy?: string;
    result?: 'success' | 'fail';
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.serverId) qs.set('serverId', String(params.serverId));
    if (params?.action) qs.set('action', params.action);
    if (params?.performedBy) qs.set('performedBy', params.performedBy);
    if (params?.result) qs.set('result', params.result);
    const query = qs.toString();
    return request<PaginatedResponse<AuditLog>>(`/audit${query ? `?${query}` : ''}`);
  },
};

export const usersApi = {
  list: () => request<UserSummary[]>('/users'),

  create: (data: {
    username: string;
    password: string;
    role: 'admin' | 'operator';
    serverIds: number[];
  }) =>
    request<UserSummary>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: number,
    data: {
      password?: string;
      role?: 'admin' | 'operator';
      serverIds?: number[];
    }
  ) =>
    request<UserSummary>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),
};

export { ApiError };
