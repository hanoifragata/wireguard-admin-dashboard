/**
 * Authentication routes: login, token refresh, logout, whoami.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { adminUsers, refreshTokens } from '../db/schema.js';
import { verifyPassword, hashToken } from '../lib/crypto.js';
import { eq, lt } from 'drizzle-orm';
import { randomBytes } from 'crypto';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/auth/login
   * Returns access token + refresh token cookie
   */
  fastify.post(
    '/login',
    { config: { public: true } },
    async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }

      const { username, password } = body.data;

      const [user] = db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.username, username))
        .all();

      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Issue access token
      const accessToken = fastify.jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: ACCESS_TOKEN_TTL }
      );

      // Issue refresh token
      const rawRefreshToken = randomBytes(48).toString('hex');
      const tokenHash = hashToken(rawRefreshToken);
      const expiresAt = new Date(
        Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      db.insert(refreshTokens)
        .values({ userId: user.id, tokenHash, expiresAt })
        .run();

      reply.setCookie('refresh_token', rawRefreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/api/auth/refresh',
        maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      });

      return { accessToken, username: user.username, role: user.role };
    }
  );

  /**
   * POST /api/auth/refresh
   * Rotates the refresh token and returns a new access token
   */
  fastify.post(
    '/refresh',
    { config: { public: true } },
    async (request, reply) => {
      const rawToken = request.cookies?.['refresh_token'];
      if (!rawToken) {
        return reply.code(401).send({ error: 'No refresh token' });
      }

      const tokenHash = hashToken(rawToken);
      const now = new Date().toISOString();

      // Evict expired tokens
      db.delete(refreshTokens)
        .where(lt(refreshTokens.expiresAt, now))
        .run();

      const [stored] = db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .all();

      if (!stored || stored.expiresAt < now) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      const [user] = db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, stored.userId))
        .all();

      if (!user) {
        return reply.code(401).send({ error: 'User not found' });
      }

      // Rotate: delete old token, issue new one
      db.delete(refreshTokens)
        .where(eq(refreshTokens.id, stored.id))
        .run();

      const newRawToken = randomBytes(48).toString('hex');
      const newTokenHash = hashToken(newRawToken);
      const expiresAt = new Date(
        Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      db.insert(refreshTokens)
        .values({ userId: user.id, tokenHash: newTokenHash, expiresAt })
        .run();

      const accessToken = fastify.jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: ACCESS_TOKEN_TTL }
      );

      reply.setCookie('refresh_token', newRawToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/api/auth/refresh',
        maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      });

      return { accessToken, username: user.username, role: user.role };
    }
  );

  /**
   * POST /api/auth/logout
   * Invalidates the refresh token
   */
  fastify.post('/logout', async (request, reply) => {
    const rawToken = request.cookies?.['refresh_token'];
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      db.delete(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .run();
    }
    reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    return { ok: true };
  });

  /**
   * GET /api/auth/me
   * Returns the current authenticated user
   */
  fastify.get('/me', async (request) => {
    return {
      id: request.user.id,
      username: request.user.username,
      role: request.user.role,
    };
  });
}
