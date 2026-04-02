/**
 * WireGuard Manager — Fastify application entry point.
 */
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { runMigrations } from './db/migrate.js';
import { registerAuthHook } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { serverRoutes } from './routes/servers.js';
import { peerRoutes } from './routes/peers.js';
import { auditRoutes } from './routes/audit.js';
import { userRoutes } from './routes/users.js';
import { evictIdleConnections } from './services/ssh.service.js';

const loggerOptions: FastifyServerOptions['logger'] =
  process.env['NODE_ENV'] !== 'production'
    ? {
        level: process.env['LOG_LEVEL'] ?? 'info',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }
    : {
        level: process.env['LOG_LEVEL'] ?? 'info',
      };

const fastify = Fastify({
  logger: loggerOptions,
});

async function bootstrap(): Promise<void> {
  // ─── Run DB migrations ──────────────────────────────────────────────────────
  await runMigrations();

  // ─── Register plugins ───────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(cookie);

  await fastify.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'change-this-secret-in-production-min-32-chars',
    sign: { algorithm: 'HS256' },
  });

  // ─── Authentication hook ────────────────────────────────────────────────────
  registerAuthHook(fastify);

  // ─── API routes ─────────────────────────────────────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(serverRoutes, { prefix: '/api/servers' });
  await fastify.register(peerRoutes, { prefix: '/api/peers' });
  await fastify.register(auditRoutes, { prefix: '/api/audit' });
  await fastify.register(userRoutes, { prefix: '/api/users' });

  // ─── Health check ────────────────────────────────────────────────────────────
  fastify.get('/health', { config: { public: true } }, () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ─── Background jobs ─────────────────────────────────────────────────────────
  setInterval(evictIdleConnections, 5 * 60 * 1000);

  // ─── Start server ────────────────────────────────────────────────────────────
  const host = process.env['HOST'] ?? '0.0.0.0';
  const port = parseInt(process.env['PORT'] ?? '3001', 10);

  await fastify.listen({ host, port });
  console.log(`[WG Manager] API server running on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('[WG Manager] Fatal startup error:', err);
  process.exit(1);
});
