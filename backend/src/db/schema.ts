import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql, relations } from 'drizzle-orm';

// ─── Servers ─────────────────────────────────────────────────────────────────

export const servers = sqliteTable('servers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(22),
  sshUser: text('ssh_user').notNull(),
  /** 'key' = private key auth, 'password' = password auth */
  authMethod: text('auth_method', { enum: ['key', 'password'] }).notNull(),
  /** 'host' = WireGuard installed on host, 'docker' = WireGuard inside a container */
  executionMode: text('execution_mode', { enum: ['host', 'docker'] })
    .notNull()
    .default('host'),
  /** Optional Docker container name when executionMode='docker' */
  dockerContainer: text('docker_container'),
  /** Public host used in generated client configs */
  endpointHost: text('endpoint_host'),
  /** Public UDP port used in generated client configs */
  endpointPort: integer('endpoint_port'),
  /** Optional operational cap for how many peers this server should allow */
  peerLimit: integer('peer_limit'),
  /** AES-256-GCM encrypted SSH private key (base64) */
  sshKey: text('ssh_key'),
  /** AES-256-GCM encrypted SSH password (base64) */
  sshPassword: text('ssh_password'),
  wgInterface: text('wg_interface').notNull().default('wg0'),
  description: text('description'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

// ─── Peers ────────────────────────────────────────────────────────────────────

export const peers = sqliteTable(
  'peers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** WireGuard public key (base64) */
    publicKey: text('public_key').notNull(),
    /** Human-readable display name */
    alias: text('alias'),
    /** Owner/username for bulk operations */
    username: text('username'),
    /** Encrypted client configuration for peers created from the dashboard */
    clientConfig: text('client_config'),
    notes: text('notes'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (table) => ({
    peerPerServerUniqueIdx: uniqueIndex('peers_server_public_key_idx').on(
      table.serverId,
      table.publicKey
    ),
  })
);

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Free-form action name, e.g. 'PEER_REVOKE', 'SERVER_ADD', 'SSH_TEST' */
  action: text('action').notNull(),
  serverId: integer('server_id'),
  peerPublicKey: text('peer_public_key'),
  peerAlias: text('peer_alias'),
  performedBy: text('performed_by').notNull(),
  result: text('result', { enum: ['success', 'fail'] }).notNull(),
  errorMessage: text('error_message'),
  /** ISO-8601 timestamp */
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

// ─── Admin Users ─────────────────────────────────────────────────────────────

export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** bcrypt-hashed password */
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'operator'] }).notNull().default('admin'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

// ─── Refresh Tokens ──────────────────────────────────────────────────────────

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  /** Opaque random token stored hashed */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

export const userServerPermissions = sqliteTable(
  'user_server_permissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (table) => ({
    userServerUniqueIdx: uniqueIndex('user_server_permissions_idx').on(
      table.userId,
      table.serverId
    ),
  })
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const serversRelations = relations(servers, ({ many }) => ({
  peers: many(peers),
  auditLogs: many(auditLogs),
}));

export const peersRelations = relations(peers, ({ one }) => ({
  server: one(servers, { fields: [peers.serverId], references: [servers.id] }),
}));

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  serverPermissions: many(userServerPermissions),
}));

export const userServerPermissionsRelations = relations(
  userServerPermissions,
  ({ one }) => ({
    user: one(adminUsers, {
      fields: [userServerPermissions.userId],
      references: [adminUsers.id],
    }),
    server: one(servers, {
      fields: [userServerPermissions.serverId],
      references: [servers.id],
    }),
  })
);

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
export type Peer = typeof peers.$inferSelect;
export type NewPeer = typeof peers.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type UserServerPermission = typeof userServerPermissions.$inferSelect;
