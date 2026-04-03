import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ServerCog,
  ShieldCheck,
  KeyRound,
  Lock,
  Plus,
  ScanSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import { ServerCard } from '@/components/ServerCard.js';
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
import { Textarea } from '@/components/ui/textarea.js';
import {
  serversApi,
  type ConnectionTestResult,
  type CreateServerInput,
  type Server,
} from '@/lib/api.js';
import { useAuthStore } from '@/store/auth.store.js';

type AuthMethod = 'key' | 'password';
type ExecutionMode = 'host' | 'docker';

interface ServerFormState {
  name: string;
  host: string;
  port: string;
  endpointHost: string;
  endpointPort: string;
  peerLimit: string;
  sshUser: string;
  authMethod: AuthMethod;
  executionMode: ExecutionMode;
  dockerContainer: string;
  sshKey: string;
  sshPassword: string;
  wgInterface: string;
  description: string;
}

const initialFormState: ServerFormState = {
  name: '',
  host: '',
  port: '22',
  endpointHost: '',
  endpointPort: '51820',
  peerLimit: '',
  sshUser: 'root',
  authMethod: 'password',
  executionMode: 'host',
  dockerContainer: '',
  sshKey: '',
  sshPassword: '',
  wgInterface: 'wg0',
  description: '',
};

function mapServerToForm(server: Server): ServerFormState {
  return {
    name: server.name,
    host: server.host,
    port: String(server.port),
    endpointHost: server.endpointHost ?? '',
    endpointPort: server.endpointPort ? String(server.endpointPort) : '51820',
    peerLimit: server.peerLimit ? String(server.peerLimit) : '',
    sshUser: server.sshUser,
    authMethod: server.authMethod,
    executionMode: server.executionMode,
    dockerContainer: server.dockerContainer ?? '',
    sshKey: '',
    sshPassword: '',
    wgInterface: server.wgInterface,
    description: server.description ?? '',
  };
}

export function ServersPage() {
  const role = useAuthStore((state) => state.role);
  const canManageServers = role === 'admin';
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<ServerFormState>(initialFormState);
  const [editingServer, setEditingServer] = useState<Server | null>(null);

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: (): Promise<Server[]> => serversApi.list(),
  });

  const resetDialog = () => {
    setIsDialogOpen(false);
    setEditingServer(null);
    setForm(initialFormState);
  };

  const openCreateDialog = () => {
    setEditingServer(null);
    setForm(initialFormState);
    setIsDialogOpen(true);
  };

  const openEditDialog = (server: Server) => {
    setEditingServer(server);
    setForm(mapServerToForm(server));
    setIsDialogOpen(true);
  };

  const buildServerPayload = (
    currentForm: ServerFormState,
    mode: 'create' | 'edit',
    existingServer?: Server
  ): CreateServerInput | Partial<CreateServerInput> | null => {
    const authMethod = currentForm.authMethod;
    const executionMode = currentForm.executionMode;

    if (executionMode === 'docker' && !currentForm.dockerContainer.trim()) {
      toast.error('Docker container is required for docker execution mode');
      return null;
    }

    if (mode === 'create') {
      if (authMethod === 'key' && !currentForm.sshKey.trim()) {
        toast.error('SSH key required for key authentication');
        return null;
      }

      if (authMethod === 'password' && !currentForm.sshPassword.trim()) {
        toast.error('SSH password required for password authentication');
        return null;
      }

      return {
        name: currentForm.name.trim(),
        host: currentForm.host.trim(),
        port: Number(currentForm.port),
        endpointHost: currentForm.endpointHost.trim() || undefined,
        endpointPort: currentForm.endpointPort ? Number(currentForm.endpointPort) : undefined,
        peerLimit: currentForm.peerLimit ? Number(currentForm.peerLimit) : undefined,
        sshUser: currentForm.sshUser.trim(),
        authMethod,
        executionMode,
        dockerContainer:
          executionMode === 'docker' ? currentForm.dockerContainer.trim() : undefined,
        sshKey: authMethod === 'key' ? currentForm.sshKey : undefined,
        sshPassword: authMethod === 'password' ? currentForm.sshPassword : undefined,
        wgInterface: currentForm.wgInterface.trim(),
        description: currentForm.description.trim() || undefined,
      };
    }

    if (!existingServer) return null;

    if (authMethod === 'key' && !existingServer.hasKey && !currentForm.sshKey.trim()) {
      toast.error('Add an SSH key before switching this server to key authentication');
      return null;
    }

    if (
      authMethod === 'password' &&
      !existingServer.hasPassword &&
      !currentForm.sshPassword.trim()
    ) {
      toast.error('Add an SSH password before switching this server to password authentication');
      return null;
    }

    const payload: Partial<CreateServerInput> = {
      name: currentForm.name.trim(),
      host: currentForm.host.trim(),
      port: Number(currentForm.port),
      endpointHost: currentForm.endpointHost.trim() || undefined,
      endpointPort: currentForm.endpointPort ? Number(currentForm.endpointPort) : undefined,
      peerLimit: currentForm.peerLimit ? Number(currentForm.peerLimit) : undefined,
      sshUser: currentForm.sshUser.trim(),
      authMethod,
      executionMode,
      dockerContainer:
        executionMode === 'docker' ? currentForm.dockerContainer.trim() : undefined,
      wgInterface: currentForm.wgInterface.trim(),
      description: currentForm.description.trim() || undefined,
    };

    if (currentForm.sshKey.trim()) {
      payload.sshKey = currentForm.sshKey;
    }

    if (currentForm.sshPassword.trim()) {
      payload.sshPassword = currentForm.sshPassword;
    }

    return payload;
  };

  const createMutation = useMutation({
    mutationFn: async (): Promise<Server> => {
      const payload = buildServerPayload(form, 'create');
      if (!payload) {
        throw new Error('Missing required server fields');
      }

      return serversApi.create(payload as CreateServerInput);
    },
    onSuccess: (createdServer: Server) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      resetDialog();
      toast.success(
        createdServer.warning ?? `Server "${createdServer.name}" registered`
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Server registration failed'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (): Promise<Server> => {
      if (!editingServer) {
        throw new Error('No server selected for editing');
      }

      const payload = buildServerPayload(form, 'edit', editingServer);
      if (!payload) {
        throw new Error('Missing required server fields');
      }

      return serversApi.update(editingServer.id, payload);
    },
    onSuccess: (updatedServer: Server) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      resetDialog();
      toast.success(`Server "${updatedServer.name}" updated`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Server update failed'
      );
    },
  });

  const testMutation = useMutation({
    mutationFn: (): Promise<ConnectionTestResult> =>
      serversApi.testConnection({
        host: form.host,
        port: Number(form.port),
        endpointHost: form.endpointHost || undefined,
        endpointPort: form.endpointPort ? Number(form.endpointPort) : undefined,
        sshUser: form.sshUser,
        authMethod: form.authMethod,
        executionMode: form.executionMode,
        dockerContainer:
          form.executionMode === 'docker' ? form.dockerContainer : undefined,
        sshKey: form.authMethod === 'key' ? form.sshKey : undefined,
        sshPassword: form.authMethod === 'password' ? form.sshPassword : undefined,
      }),
    onSuccess: (result: ConnectionTestResult) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Connection test failed'
      );
    },
  });

  const serverCount = serversQuery.data?.length ?? 0;
  const isEditing = editingServer !== null;
  const activeMutation = isEditing ? updateMutation : createMutation;

  return (
    <div className="min-h-full bg-zinc-950 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-4 lg:grid-cols-[1.5fr,1fr]">
          <Card className="overflow-hidden border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_35%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98))]">
            <CardHeader>
              <CardTitle className="text-3xl">WireGuard Servers</CardTitle>
              <CardDescription>
                Register VPN hosts, validate SSH before saving, and auto-discover
                peers into the local inventory.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {canManageServers ? (
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" />
                  Add server
                </Button>
              ) : null}
              <div className="rounded-full border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-400">
                {serverCount} registered server{serverCount === 1 ? '' : 's'}
              </div>
              {!canManageServers ? (
                <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-300">
                  Operator mode: view assigned servers and manage their peers
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Verified onboarding</p>
                  <p className="text-lg font-semibold text-zinc-100">
                    SSH checked first
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-2xl bg-blue-500/10 p-3 text-blue-400">
                  <ServerCog className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Peer sync</p>
                  <p className="text-lg font-semibold text-zinc-100">
                    Auto-discovery on save
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-400">
                  <ScanSearch className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Inventory</p>
                  <p className="text-lg font-semibold text-zinc-100">
                    Cross-server visibility
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          {serversQuery.isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-zinc-400">
                Loading registered servers...
              </CardContent>
            </Card>
          ) : serversQuery.isError ? (
            <Card>
              <CardContent className="p-6 text-sm text-red-400">
                {serversQuery.error instanceof Error
                  ? serversQuery.error.message
                  : 'Failed to load servers'}
              </CardContent>
            </Card>
          ) : serverCount === 0 ? (
            <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
              <CardContent className="flex flex-col items-center justify-center gap-4 p-10 text-center">
                <ServerCog className="h-10 w-10 text-zinc-600" />
                <div>
                  <p className="text-lg font-medium text-zinc-100">
                    No servers yet
                  </p>
                  <p className="text-sm text-zinc-500">
                    {canManageServers
                      ? 'Add your first WireGuard server to start discovering and managing peers.'
                      : 'No servers are assigned to this operator yet.'}
                  </p>
                </div>
                {canManageServers ? (
                  <Button onClick={openCreateDialog}>
                    Register server
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 justify-items-start xl:grid-cols-2">
              {serversQuery.data?.map((server: Server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  canDeleteServer={canManageServers}
                  onEdit={canManageServers ? openEditDialog : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={canManageServers && isDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetDialog();
            return;
          }

          setIsDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader onClose={resetDialog}>
            <DialogTitle>
              {isEditing ? 'Edit WireGuard server' : 'Add WireGuard server'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the saved server details. Leave SSH credentials blank to keep the existing secret unchanged.'
                : 'Credentials are encrypted before storage. The server must pass an SSH check before it is saved.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="host">Host</Label>
              <Input
                id="host"
                value={form.host}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, host: event.target.value }))
                }
                placeholder="vpn.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={form.port}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, port: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sshUser">SSH User</Label>
              <Input
                id="sshUser"
                value={form.sshUser}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sshUser: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpointHost">Public endpoint host</Label>
              <Input
                id="endpointHost"
                value={form.endpointHost}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, endpointHost: event.target.value }))
                }
                placeholder="vpn.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpointPort">Public endpoint port</Label>
              <Input
                id="endpointPort"
                type="number"
                value={form.endpointPort}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, endpointPort: event.target.value }))
                }
                placeholder="51820"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="authMethod">Authentication</Label>
              <Select
                id="authMethod"
                value={form.authMethod}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    authMethod: event.target.value as AuthMethod,
                  }))
                }
              >
                <option value="password">Password</option>
                <option value="key">Private key</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="executionMode">WireGuard runtime</Label>
              <Select
                id="executionMode"
                value={form.executionMode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    executionMode: event.target.value as ExecutionMode,
                  }))
                }
              >
                <option value="host">On host</option>
                <option value="docker">Inside Docker</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wgInterface">WireGuard interface</Label>
              <Input
                id="wgInterface"
                value={form.wgInterface}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    wgInterface: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="peerLimit">Peer limit</Label>
              <Input
                id="peerLimit"
                type="number"
                value={form.peerLimit}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, peerLimit: event.target.value }))
                }
                placeholder="Optional operational limit"
              />
            </div>
            {form.executionMode === 'docker' && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="dockerContainer">Docker container</Label>
                <Input
                  id="dockerContainer"
                  value={form.dockerContainer}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      dockerContainer: event.target.value,
                    }))
                  }
                  placeholder="wireguard, wg-easy, linuxserver-wireguard..."
                />
              </div>
            )}
            {form.authMethod === 'password' ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="sshPassword" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  {isEditing ? 'Replace SSH password' : 'SSH password'}
                </Label>
                <Input
                  id="sshPassword"
                  type="password"
                  value={form.sshPassword}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      sshPassword: event.target.value,
                    }))
                  }
                  placeholder={isEditing ? 'Leave blank to keep current password' : undefined}
                />
              </div>
            ) : (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="sshKey" className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {isEditing ? 'Replace private key (`id_rsa`)' : 'Private key (`id_rsa`)'}
                </Label>
                <Textarea
                  id="sshKey"
                  rows={8}
                  value={form.sshKey}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, sshKey: event.target.value }))
                  }
                  placeholder={
                    isEditing
                      ? 'Leave blank to keep current private key'
                      : '-----BEGIN OPENSSH PRIVATE KEY-----'
                  }
                />
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional notes about this server"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              isLoading={testMutation.isPending}
              disabled={isEditing}
              title={
                isEditing
                  ? 'Use the Test button on the server card to verify the current saved connection'
                  : undefined
              }
            >
              Test connection
            </Button>
            <Button
              variant="ghost"
              onClick={resetDialog}
              disabled={activeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => activeMutation.mutate()}
              isLoading={activeMutation.isPending}
            >
              {isEditing ? 'Save changes' : 'Save server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
