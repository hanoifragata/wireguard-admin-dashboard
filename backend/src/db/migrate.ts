/**
 * Runs Drizzle migrations and seeds the admin user if none exists.
 * Called at application startup.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';
import { adminUsers } from './schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/crypto.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const migrationsFolder = join(__dirname, '../../drizzle');

  try {
    migrate(db, { migrationsFolder });
    console.log('[DB] Migrations applied successfully');
  } catch (err) {
    // Drizzle migrate throws when folder doesn't exist — run inline DDL instead
    console.warn('[DB] Migrations folder not found, running inline DDL');
    runInlineDDL();
  }

  await ensureAdminUser();
}

function runInlineDDL(): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','operator')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      ssh_user TEXT NOT NULL,
      auth_method TEXT NOT NULL CHECK(auth_method IN ('key','password')),
      execution_mode TEXT NOT NULL DEFAULT 'host' CHECK(execution_mode IN ('host','docker')),
      docker_container TEXT,
      endpoint_host TEXT,
      endpoint_port INTEGER,
      peer_limit INTEGER,
      ssh_key TEXT,
      ssh_password TEXT,
      wg_interface TEXT NOT NULL DEFAULT 'wg0',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      alias TEXT,
      username TEXT,
      client_config TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS peers_server_public_key_idx
      ON peers(server_id, public_key);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      server_id INTEGER,
      peer_public_key TEXT,
      peer_alias TEXT,
      performed_by TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('success','fail')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS user_server_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_server_permissions_idx
      ON user_server_permissions(user_id, server_id);
  `);
  ensureColumn(
    'admin_users',
    'role',
    "TEXT NOT NULL DEFAULT 'admin'"
  );
  ensureColumn('servers', 'execution_mode', "TEXT NOT NULL DEFAULT 'host'");
  ensureColumn('servers', 'docker_container', 'TEXT');
  ensureColumn('servers', 'endpoint_host', 'TEXT');
  ensureColumn('servers', 'endpoint_port', 'INTEGER');
  ensureColumn('servers', 'peer_limit', 'INTEGER');
  ensureColumn('peers', 'client_config', 'TEXT');
  console.log('[DB] Inline DDL applied');
}

function ensureColumn(table: string, column: string, definition: string): void {
  const existingColumns = db.$client
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  if (!existingColumns.some((entry) => entry.name === column)) {
    db.$client.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureAdminUser(): Promise<void> {
  const username = process.env['ADMIN_USERNAME'] ?? 'admin';
  const password = process.env['ADMIN_PASSWORD'] ?? 'changeme123';

  const existing = db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .all();

  if (existing.length === 0) {
    const passwordHash = await hashPassword(password);
    db.insert(adminUsers).values({ username, passwordHash }).run();
    console.log(`[DB] Admin user '${username}' created`);
  }
}
