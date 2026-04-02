import { Outlet, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/store/auth.store.js';
import { auth } from '@/lib/api.js';
import { toast } from 'sonner';
import { Shield, Server, Users, ClipboardList, LogOut, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from './ui/button.js';

export function Layout() {
  const { username, role, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = [
    { to: '/servers', label: 'Servers', icon: Server },
    { to: '/peers', label: 'Peers', icon: Users },
    { to: '/audit', label: 'Audit Log', icon: ClipboardList },
    ...(role === 'admin'
      ? [{ to: '/users', label: 'Users', icon: UserCog }]
      : []),
  ];

  const handleLogout = async () => {
    try {
      await auth.logout();
    } catch {
      // Proceed even if API call fails
    }
    logout();
    toast.success('Logged out');
    await navigate({ to: '/login' });
  };

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-900">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-zinc-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">WireGuard</p>
            <p className="text-xs text-zinc-400">Manager</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-zinc-800 px-3 py-4">
          <div className="flex items-center justify-between px-3">
            <div>
              <p className="text-sm font-medium text-zinc-300">{username}</p>
              <p className="text-xs text-zinc-500">
                {role === 'admin' ? 'Administrator' : 'Operator'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Log out"
            >
              <LogOut className="h-4 w-4 text-zinc-400" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
