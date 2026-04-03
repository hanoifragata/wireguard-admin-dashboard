import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Server as ServerIcon, Wifi, WifiOff, Trash2, TestTube2, Users, Pencil } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent } from './ui/card.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  serversApi,
  type ConnectionTestResult,
  type Server,
} from '@/lib/api.js';

interface ServerCardProps {
  server: Server;
  canDeleteServer?: boolean;
  onEdit?: (server: Server) => void;
}

export function ServerCard({ server, canDeleteServer = false, onEdit }: ServerCardProps) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<boolean | null>(null);

  const testMutation = useMutation({
    mutationFn: (): Promise<ConnectionTestResult> => serversApi.testSaved(server.id),
    onSuccess: (data: ConnectionTestResult) => {
      setTestResult(data.success);
      if (data.success) {
        toast.success(`SSH connected to ${server.name}`);
      } else {
        toast.error(`Connection failed: ${data.message}`);
      }
    },
    onError: (err) => {
      setTestResult(false);
      toast.error(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (): Promise<void> => serversApi.delete(server.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success(`Server "${server.name}" removed`);
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const handleDelete = () => {
    if (!confirm(`Remove server "${server.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate();
  };

  return (
    <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/70 transition-colors hover:border-zinc-700">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/80">
              <ServerIcon className="h-5 w-5 text-zinc-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="truncate text-base font-semibold text-zinc-100">{server.name}</h3>
                {testResult === true && (
                  <Badge variant="success">
                    <Wifi className="h-3 w-3 mr-1" />
                    Reachable
                  </Badge>
                )}
                {testResult === false && (
                  <Badge variant="destructive">
                    <WifiOff className="h-3 w-3 mr-1" />
                    Unreachable
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-zinc-400">
                {server.sshUser}@{server.host}:{server.port}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{server.wgInterface}</Badge>
                {server.endpointHost ? (
                  <Badge variant="outline">
                    Endpoint: {server.endpointHost}:{server.endpointPort ?? 51820}
                  </Badge>
                ) : null}
                <Badge variant="outline">
                  {server.executionMode === 'docker'
                    ? `Docker: ${server.dockerContainer ?? 'container'}`
                    : 'Host runtime'}
                </Badge>
                <Badge variant="outline">
                  {server.authMethod === 'key' ? 'SSH Key' : 'Password'}
                </Badge>
                {server.peerLimit ? (
                  <Badge variant="outline">Limit: {server.peerLimit} peers</Badge>
                ) : null}
              </div>
              {server.description && (
                <p className="mt-3 line-clamp-2 text-sm text-zinc-500">{server.description}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
            <Button
              variant="outline"
              size="sm"
              className="justify-center px-3"
              isLoading={testMutation.isPending}
              onClick={() => testMutation.mutate()}
              title="Test SSH connection"
            >
              <TestTube2 className="h-3.5 w-3.5" />
              Test
            </Button>
            <Link to="/peers" search={{ serverId: String(server.id) }}>
              <Button variant="ghost" size="sm" className="justify-center px-3" title="View peers">
                <Users className="h-4 w-4" />
                Peers
              </Button>
            </Link>
            {onEdit ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-center px-3"
                onClick={() => onEdit(server)}
                title="Edit server"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {canDeleteServer ? (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={handleDelete}
                isLoading={deleteMutation.isPending}
                title="Delete server"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
