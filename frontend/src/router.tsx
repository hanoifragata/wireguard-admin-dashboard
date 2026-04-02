import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from '@tanstack/react-router';
import { useAuthStore } from '@/store/auth.store.js';
import { Layout } from '@/components/Layout.js';
import { LoginPage } from '@/pages/Login.js';
import { ServersPage } from '@/pages/Servers.js';
import { PeersPage } from '@/pages/Peers.js';
import { AuditPage } from '@/pages/Audit.js';
import { UsersPage } from '@/pages/Users.js';

// ─── Root Route ───────────────────────────────────────────────────────────────

const rootRoute = createRootRoute();

// ─── Auth Guard Helper ────────────────────────────────────────────────────────

function requireAuth() {
  const { isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated) {
    throw redirect({ to: '/login' });
  }
}

// ─── Login Route ──────────────────────────────────────────────────────────────

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) throw redirect({ to: '/servers' });
  },
});

// ─── App Layout Route ─────────────────────────────────────────────────────────

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: Layout,
  beforeLoad: requireAuth,
});

// ─── Child Routes ─────────────────────────────────────────────────────────────

const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/servers' }); },
});

const serversRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/servers',
  component: ServersPage,
});

const peersRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/peers',
  validateSearch: (search: Record<string, unknown>) => ({
    serverId:
      typeof search['serverId'] === 'string' && search['serverId'].trim().length > 0
        ? search['serverId']
        : undefined,
  }),
  component: PeersPage,
});

const auditRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/audit',
  component: AuditPage,
});

const usersRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/users',
  component: UsersPage,
  beforeLoad: () => {
    const { role } = useAuthStore.getState();
    if (role !== 'admin') throw redirect({ to: '/servers' });
  },
});

// ─── Router ───────────────────────────────────────────────────────────────────

const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([indexRoute, serversRoute, peersRoute, auditRoute, usersRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
