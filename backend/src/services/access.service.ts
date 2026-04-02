import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  servers,
  userServerPermissions,
  type AdminUser,
  type Server,
} from '../db/schema.js';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'operator';
}

export async function getAccessibleServerIds(user: AuthUser): Promise<number[]> {
  if (user.role === 'admin') {
    return db.select({ id: servers.id }).from(servers).all().map((row) => row.id);
  }

  return db
    .select({ serverId: userServerPermissions.serverId })
    .from(userServerPermissions)
    .where(eq(userServerPermissions.userId, user.id))
    .all()
    .map((row) => row.serverId);
}

export async function listAccessibleServers(user: AuthUser): Promise<Server[]> {
  if (user.role === 'admin') {
    return db.select().from(servers).all();
  }

  const serverIds = await getAccessibleServerIds(user);
  if (serverIds.length === 0) return [];

  return db.select().from(servers).where(inArray(servers.id, serverIds)).all();
}

export async function getAccessibleServerById(
  user: AuthUser,
  serverId: number
): Promise<Server | undefined> {
  if (user.role === 'admin') {
    return db.select().from(servers).where(eq(servers.id, serverId)).get();
  }

  const permission = db
    .select()
    .from(userServerPermissions)
    .where(
      eq(userServerPermissions.userId, user.id)
    )
    .all()
    .some((entry) => entry.serverId === serverId);

  if (!permission) return undefined;

  return db.select().from(servers).where(eq(servers.id, serverId)).get();
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== 'admin') {
    throw new Error('Admin permissions required');
  }
}

export function sanitizeUser(user: AdminUser) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}
