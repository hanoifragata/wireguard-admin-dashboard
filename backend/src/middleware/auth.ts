/**
 * JWT authentication middleware for Fastify.
 * Registers a preHandler hook that validates the Bearer token.
 */
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number; username: string; role: 'admin' | 'operator' };
    user: { id: number; username: string; role: 'admin' | 'operator' };
  }
}

/**
 * Registers a global authentication hook.
 * Routes can opt out by setting `config: { public: true }` in their route options.
 */
export function registerAuthHook(fastify: FastifyInstance<any, any, any, any>): void {
  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip public routes
      const routeConfig = (request.routeOptions as { config?: { public?: boolean } })
        .config;
      if (routeConfig?.public) return;

      try {
        await request.jwtVerify();
      } catch {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Invalid or expired token' });
      }
    }
  );
}
