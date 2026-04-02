import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, UserPlus, Users as UsersIcon, Trash2, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi, serversApi, type Server, type UserSummary } from '@/lib/api.js';
import { Button } from '@/components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Select } from '@/components/ui/select.js';
import { Badge } from '@/components/ui/badge.js';

interface FormState {
  username: string;
  password: string;
  role: 'admin' | 'operator';
  serverIds: number[];
}

const initialFormState: FormState = {
  username: '',
  password: '',
  role: 'operator',
  serverIds: [],
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: (): Promise<UserSummary[]> => usersApi.list(),
  });

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: (): Promise<Server[]> => serversApi.list(),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingUser
        ? usersApi.update(editingUser.id, {
            role: form.role,
            password: form.password || undefined,
            serverIds: form.serverIds,
          })
        : usersApi.create({
            username: form.username,
            password: form.password,
            role: form.role,
            serverIds: form.serverIds,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsOpen(false);
      setEditingUser(null);
      setForm(initialFormState);
      toast.success(editingUser ? 'User updated' : 'User created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'User save failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => usersApi.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    },
  });

  const serverOptions = serversQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const operatorCount = useMemo(
    () => users.filter((user) => user.role === 'operator').length,
    [users]
  );
  const adminCount = users.length - operatorCount;

  const openCreate = () => {
    setEditingUser(null);
    setForm(initialFormState);
    setIsOpen(true);
  };

  const openEdit = (user: UserSummary) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      password: '',
      role: user.role,
      serverIds: user.serverIds,
    });
    setIsOpen(true);
  };

  const toggleServer = (serverId: number) => {
    setForm((prev) => ({
      ...prev,
      serverIds: prev.serverIds.includes(serverId)
        ? prev.serverIds.filter((id) => id !== serverId)
        : [...prev.serverIds, serverId],
    }));
  };

  const handleSave = () => {
    if (!editingUser && form.username.trim().length < 3) {
      toast.error('Username must be at least 3 characters');
      return;
    }

    if (!editingUser && form.password.trim().length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    if (form.role === 'operator' && form.serverIds.length === 0) {
      toast.error('Select at least one server for this operator');
      return;
    }

    saveMutation.mutate();
  };

  return (
    <div className="min-h-full bg-zinc-950 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.45fr,1fr]">
          <Card className="border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98))]">
            <CardHeader>
              <CardTitle className="text-2xl">User Access Control</CardTitle>
              <CardDescription>
                Create operators, limit them to specific VPN servers, and keep privileged administration isolated.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="rounded-full border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-400">
                {users.length} account{users.length === 1 ? '' : 's'} configured
              </div>
              <Button onClick={openCreate}>
                <UserPlus className="h-4 w-4" />
                New user
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-blue-500/10 p-3 text-blue-400">
                  <UsersIcon className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Users</p>
                <p className="text-2xl font-semibold text-zinc-100">{users.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
                  <Shield className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Admins</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {adminCount}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-amber-500/10 p-3 text-amber-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Operators</p>
                <p className="text-2xl font-semibold text-zinc-100">{operatorCount}</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-950/70">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Servers</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                      No users configured yet.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="hover:bg-zinc-950/40">
                      <td className="px-4 py-3 text-sm text-zinc-100">{user.username}</td>
                      <td className="px-4 py-3">
                        <Badge variant={user.role === 'admin' ? 'success' : 'outline'}>
                          {user.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-300">
                        {user.role === 'admin' ? (
                          'All servers'
                        ) : user.servers && user.servers.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {user.servers.map((server) => (
                              <Badge key={server.id} variant="outline">
                                {server.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          'No access'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                            <PencilLine className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMutation.mutate(user.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader onClose={() => setIsOpen(false)}>
            <DialogTitle>{editingUser ? 'Edit user' : 'Create user'}</DialogTitle>
            <DialogDescription>
              Operators only see assigned servers. Admins retain full access.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={form.username}
                  disabled={editingUser !== null}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, username: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  id="role"
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      role: event.target.value as 'admin' | 'operator',
                    }))
                  }
                >
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                {editingUser ? 'New password (optional)' : 'Password'}
              </Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
              />
            </div>

            <div className="space-y-3">
              <Label>Allowed servers</Label>
              <p className="text-xs text-zinc-500">
                Operators can only view and manage the servers selected here. Admins always keep full access.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {serverOptions.map((server) => (
                  <label
                    key={server.id}
                    className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={form.role === 'admin' || form.serverIds.includes(server.id)}
                      disabled={form.role === 'admin'}
                      onChange={() => toggleServer(server.id)}
                      className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                    />
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{server.name}</p>
                      <p className="text-xs text-zinc-500">
                        {server.host}:{server.port}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} isLoading={saveMutation.isPending}>
              {editingUser ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
