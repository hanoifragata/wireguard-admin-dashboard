import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
  Users,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { PeerTable } from '@/components/PeerTable.js';
import { RevokeModal } from '@/components/RevokeModal.js';
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
import { peersApi, serversApi, type CreatePeerResponse, type GlobalPeer, type Server } from '@/lib/api.js';

function getPeerKey(peer: GlobalPeer): string {
  return `${peer.serverId}:${peer.publicKey}`;
}

function parseIpv4(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }

  return result >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [networkRaw, prefixRaw] = cidr.split('/');
  if (!networkRaw || !prefixRaw) return false;

  const ipValue = parseIpv4(ip);
  const networkValue = parseIpv4(networkRaw);
  const prefix = Number(prefixRaw);

  if (ipValue === null || networkValue === null || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask =
    prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);

  return (ipValue & mask) === (networkValue & mask);
}

function matchesIpOrSubnet(filter: string, allowedIps: string | null): boolean {
  if (!allowedIps) return false;

  const normalizedFilter = filter.trim().toLowerCase();
  if (normalizedFilter.length === 0) return true;

  const allowedEntries = allowedIps
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (normalizedFilter.includes('/')) {
    return allowedEntries.some((entry) => {
      if (entry.toLowerCase() === normalizedFilter) return true;

      const [entryIp] = entry.split('/');
      return entryIp ? isIpInCidr(entryIp, normalizedFilter) : false;
    });
  }

  return allowedEntries.some((entry) => {
    const entryLower = entry.toLowerCase();
    if (entryLower === normalizedFilter) return true;

    const [entryIp] = entry.split('/');
    if (!entryIp) return false;

    return entryIp === normalizedFilter || isIpInCidr(normalizedFilter, entry);
  });
}

export function PeersPage() {
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/layout/peers' });
  const [aliasFilter, setAliasFilter] = useState('');
  const [publicKeyFilter, setPublicKeyFilter] = useState('');
  const [serverFilter, setServerFilter] = useState(search.serverId ?? '');
  const [ipFilter, setIpFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'healthy' | 'quiet' | 'never-established' | 'unavailable'
  >('all');
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  const [editingPeer, setEditingPeer] = useState<GlobalPeer | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createServerId, setCreateServerId] = useState(search.serverId ?? '');
  const [createAlias, setCreateAlias] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createdConfig, setCreatedConfig] = useState<string | null>(null);
  const [alias, setAlias] = useState('');
  const [notes, setNotes] = useState('');
  const deferredAliasFilter = useDeferredValue(aliasFilter);
  const deferredPublicKeyFilter = useDeferredValue(publicKeyFilter);
  const deferredIpFilter = useDeferredValue(ipFilter);

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: (): Promise<Server[]> => serversApi.list(),
  });

  const peersQuery = useQuery({
    queryKey: ['peers', serverFilter],
    queryFn: () =>
      peersApi.list({
        serverId: serverFilter ? Number(serverFilter) : undefined,
      }),
  });

  const peers: GlobalPeer[] = peersQuery.data ?? [];

  const filteredPeers = useMemo(() => {
    const normalizedAlias = deferredAliasFilter.trim().toLowerCase();
    const normalizedPublicKey = deferredPublicKeyFilter.trim().toLowerCase();
    const normalizedIp = deferredIpFilter.trim().toLowerCase();

    return peers.filter((peer) => {
      const aliasMatch =
        normalizedAlias.length === 0 ||
        (peer.alias ?? '').toLowerCase().includes(normalizedAlias);
      const publicKeyMatch =
        normalizedPublicKey.length === 0 ||
        peer.publicKey.toLowerCase().includes(normalizedPublicKey);
      const ipMatch =
        normalizedIp.length === 0 ||
        matchesIpOrSubnet(normalizedIp, peer.allowedIps);
      const statusMatch =
        statusFilter === 'all' || peer.status === statusFilter;

      return aliasMatch && publicKeyMatch && ipMatch && statusMatch;
    });
  }, [deferredAliasFilter, deferredIpFilter, deferredPublicKeyFilter, peers, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [deferredAliasFilter, deferredIpFilter, deferredPublicKeyFilter, serverFilter, statusFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredPeers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedPeers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPeers.slice(start, start + pageSize);
  }, [currentPage, filteredPeers, pageSize]);

  const selectedPeers = useMemo(
    () => filteredPeers.filter((peer) => selectedKeys.has(getPeerKey(peer))),
    [filteredPeers, selectedKeys]
  );

  const updatePeerMutation = useMutation({
    mutationFn: (peer: GlobalPeer) =>
      peersApi.update(peer.id, {
        alias,
        notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('Peer metadata updated');
      setEditingPeer(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Peer update failed');
    },
  });

  const createPeerMutation = useMutation({
    mutationFn: (): Promise<CreatePeerResponse> =>
      peersApi.create({
        serverId: Number(createServerId),
        alias: createAlias || undefined,
        notes: createNotes || undefined,
        persistentKeepalive: 25,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setCreatedConfig(response.config);
      setIsCreateOpen(false);
      setCreateAlias('');
      setCreateNotes('');
      toast.success('Peer created successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Peer creation failed');
    },
  });

  const downloadConfigMutation = useMutation({
    mutationFn: (peer: GlobalPeer) => peersApi.downloadConfig(peer.id),
    onSuccess: (download) => {
      const blob = new Blob([download.config], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Peer config downloaded');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Config download failed');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (targets: GlobalPeer[]) =>
      peersApi.bulkRevoke(
        targets.map((peer) => ({
          serverId: peer.serverId,
          publicKey: peer.publicKey,
          alias: peer.alias ?? peer.username ?? undefined,
        }))
      ),
    onSuccess: (response) => {
      response.results.forEach((result) => {
        if (result.success) {
          toast.success(
            `Revoked ${result.peerAlias ?? result.publicKey} on ${result.serverName}`
          );
        } else {
          toast.error(
            `Failed on ${result.serverName}: ${result.error ?? 'Unknown error'}`
          );
        }
      });
      setSelectedKeys(new Set());
      setIsRevokeOpen(false);
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Bulk revoke failed');
    },
  });

  const handleTogglePeer = (peer: GlobalPeer) => {
    const key = getPeerKey(peer);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleToggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(paginatedPeers.map(getPeerKey)));
  };

  const openEditModal = (peer: GlobalPeer) => {
    setEditingPeer(peer);
    setAlias(peer.alias ?? '');
    setNotes(peer.notes ?? '');
  };

  const clearFilters = () => {
    setAliasFilter('');
    setPublicKeyFilter('');
    setServerFilter('');
    setIpFilter('');
    setStatusFilter('all');
  };

  const openCreateModal = () => {
    setCreateServerId(serverFilter || (serversQuery.data?.[0] ? String(serversQuery.data[0].id) : ''));
    setCreateAlias('');
    setCreateNotes('');
    setCreatedConfig(null);
    setIsCreateOpen(true);
  };

  const handleCreatePeer = () => {
    if (!createServerId) {
      toast.error('Select a server');
      return;
    }

    createPeerMutation.mutate();
  };

  const healthyCount = filteredPeers.filter((peer) => peer.status === 'healthy').length;
  const pageStart = filteredPeers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredPeers.length);
  const selectedServerName =
    serverFilter && serversQuery.data
      ? serversQuery.data.find((server) => String(server.id) === serverFilter)?.name
      : null;

  return (
    <div className="min-h-full bg-zinc-950 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.45fr,1fr]">
          <Card className="border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_24%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98))]">
            <CardHeader>
              <CardTitle className="text-2xl">Global Peer Directory</CardTitle>
              <CardDescription>
                Filtra, pagina y opera peers en todos los servidores desde una sola vista.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr,1.35fr,1fr,1fr,0.9fr,auto]">
                <div className="space-y-2">
                  <Label htmlFor="alias-filter">Alias</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="alias-filter"
                      value={aliasFilter}
                      onChange={(event) => setAliasFilter(event.target.value)}
                      placeholder="Buscar alias"
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="public-key-filter">Public key</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="public-key-filter"
                      value={publicKeyFilter}
                      onChange={(event) => setPublicKeyFilter(event.target.value)}
                      placeholder="Search public key"
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-filter">Server</Label>
                  <Select
                    id="server-filter"
                    value={serverFilter}
                    onChange={(event) => setServerFilter(event.target.value)}
                  >
                    <option value="">All servers</option>
                    {serversQuery.data?.map((server) => (
                      <option key={server.id} value={String(server.id)}>
                        {server.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip-filter">IP</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="ip-filter"
                      value={ipFilter}
                      onChange={(event) => setIpFilter(event.target.value)}
                      placeholder="10.8.0.2 or 10.8.0.0/24"
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status-filter">Status</Label>
                  <Select
                    id="status-filter"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value as 'all' | 'healthy' | 'quiet' | 'never-established' | 'unavailable'
                      )
                    }
                  >
                    <option value="all">All status</option>
                    <option value="healthy">Healthy</option>
                    <option value="quiet">Quiet</option>
                    <option value="never-established">Never established</option>
                    <option value="unavailable">Unavailable</option>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="ghost" onClick={clearFilters}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                  <span>
                    Showing <span className="text-zinc-100">{pageStart}-{pageEnd}</span> of{' '}
                    <span className="text-zinc-100">{filteredPeers.length}</span>
                  </span>
                  <span className="hidden text-zinc-700 lg:inline">|</span>
                  <span>
                    Page <span className="text-zinc-100">{currentPage}</span> of{' '}
                    <span className="text-zinc-100">{totalPages}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="page-size" className="text-xs text-zinc-500">
                      Rows
                    </Label>
                    <Select
                      id="page-size"
                      value={String(pageSize)}
                      onChange={(event) =>
                        setPageSize(Number(event.target.value) as 10 | 20 | 50)
                      }
                      className="w-24"
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => peersQuery.refetch()}
                    isLoading={peersQuery.isFetching}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                  <Button variant="outline" onClick={openCreateModal}>
                    <Plus className="h-4 w-4" />
                    Add peer
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setIsRevokeOpen(true)}
                    disabled={selectedPeers.length === 0}
                  >
                    <ShieldOff className="h-4 w-4" />
                    Revoke selected
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-blue-500/10 p-3 text-blue-400">
                  <Users className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Visible peers</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {filteredPeers.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
                  <Workflow className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Healthy now</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {healthyCount}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-red-500/10 p-3 text-red-400">
                  <ShieldOff className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Selected</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {selectedPeers.length}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {peersQuery.isLoading ? (
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="flex items-center gap-3 p-6 text-sm text-zinc-300">
              <LoaderCircle className="h-5 w-5 animate-spin text-blue-400" />
              <div>
                <p className="font-medium text-zinc-100">
                  {selectedServerName
                    ? `Loading peers from ${selectedServerName}...`
                    : 'Loading peers...'}
                </p>
                <p className="text-zinc-500">
                  Fetching the latest WireGuard peer inventory.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {peersQuery.isFetching && !peersQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Refreshing peer data...
          </div>
        ) : null}

        {peersQuery.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-400">
              {peersQuery.error instanceof Error
                ? peersQuery.error.message
                : 'Failed to load peers'}
            </CardContent>
          </Card>
        ) : peersQuery.isLoading ? null : (
          <PeerTable
            peers={paginatedPeers}
            selectedKeys={selectedKeys}
            onTogglePeer={handleTogglePeer}
            onToggleAll={handleToggleAll}
            onEditPeer={openEditModal}
            onDownloadPeer={(peer) => downloadConfigMutation.mutate(peer)}
            onRevokePeer={(peer) => {
              setSelectedKeys(new Set([getPeerKey(peer)]));
              setIsRevokeOpen(true);
            }}
          />
        )}

        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-400">
            Filters apply before pagination. Header selection applies to the current page.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <div className="min-w-24 text-center text-sm text-zinc-300">
              {currentPage} / {totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <RevokeModal
        open={isRevokeOpen}
        peers={selectedPeers}
        isSubmitting={revokeMutation.isPending}
        onClose={() => setIsRevokeOpen(false)}
        onConfirm={() => revokeMutation.mutate(selectedPeers)}
      />

      <Dialog
        open={editingPeer !== null}
        onOpenChange={(open) => !open && setEditingPeer(null)}
      >
        <DialogContent>
          <DialogHeader onClose={() => setEditingPeer(null)}>
            <DialogTitle>Edit peer metadata</DialogTitle>
            <DialogDescription>
              Aliases and notes are stored locally and never written back to the
              WireGuard server.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-xs text-zinc-500">
              <p className="truncate text-zinc-300">{editingPeer?.publicKey}</p>
              <p className="mt-1">{editingPeer?.serverName}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="peer-alias">Alias</Label>
              <Input
                id="peer-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="peer-notes">Notes</Label>
              <Textarea
                id="peer-notes"
                rows={4}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditingPeer(null)}
              disabled={updatePeerMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editingPeer && updatePeerMutation.mutate(editingPeer)}
              isLoading={updatePeerMutation.isPending}
              disabled={!editingPeer}
            >
              Save metadata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader onClose={() => setIsCreateOpen(false)}>
            <DialogTitle>Add peer</DialogTitle>
            <DialogDescription>
              Create a new WireGuard peer. The next available peer IP will be assigned automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-server">Server</Label>
              <Select
                id="create-server"
                value={createServerId}
                onChange={(event) => setCreateServerId(event.target.value)}
              >
                <option value="">Select server</option>
                {serversQuery.data?.map((server) => (
                  <option key={server.id} value={String(server.id)}>
                    {server.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-alias">Alias</Label>
              <Input
                id="create-alias"
                value={createAlias}
                onChange={(event) => setCreateAlias(event.target.value)}
                placeholder="Ana laptop"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-notes">Notes</Label>
              <Textarea
                id="create-notes"
                rows={3}
                value={createNotes}
                onChange={(event) => setCreateNotes(event.target.value)}
              />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              The dashboard will inspect existing peers on the selected server and assign the next available `/32` automatically.
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePeer} isLoading={createPeerMutation.isPending}>
              Create peer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdConfig !== null} onOpenChange={(open) => !open && setCreatedConfig(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader onClose={() => setCreatedConfig(null)}>
            <DialogTitle>Peer created</DialogTitle>
            <DialogDescription>
              This client configuration was saved securely and can be downloaded again later for peers created from this dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Textarea rows={14} value={createdConfig ?? ''} readOnly className="font-mono text-xs" />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreatedConfig(null)}>
              Close
            </Button>
            <Button
              onClick={async () => {
                if (!createdConfig) return;
                await navigator.clipboard.writeText(createdConfig);
                toast.success('Config copied to clipboard');
              }}
            >
              Copy config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
