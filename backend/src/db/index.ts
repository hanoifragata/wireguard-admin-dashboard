import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import * as schema from './schema.js';

const dbUrl = process.env['DATABASE_URL'] ?? './data/wg-manager.db';

// Ensure the data directory exists
mkdirSync(dirname(dbUrl), { recursive: true });

const sqlite = new Database(dbUrl);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
