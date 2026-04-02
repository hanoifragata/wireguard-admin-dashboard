import { useMemo } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Download, PencilLine, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import type { GlobalPeer } from '@/lib/api.js';

interface PeerTableProps {
  peers: GlobalPeer[];
  selectedKeys: Set<string>;
  onTogglePeer: (peer: GlobalPeer) => void;
  onToggleAll: (checked: boolean) => void;
  onEditPeer: (peer: GlobalPeer) => void;
  onDownloadPeer: (peer: GlobalPeer) => void;
  onRevokePeer: (peer: GlobalPeer) => void;
}

const columnHelper = createColumnHelper<GlobalPeer>();

function formatRelativeHandshake(value: number): string {
  if (!value) return 'Never';

  const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - value);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function getPeerKey(peer: GlobalPeer): string {
  return `${peer.serverId}:${peer.publicKey}`;
}

export function PeerTable({
  peers,
  selectedKeys,
  onTogglePeer,
  onToggleAll,
  onEditPeer,
  onDownloadPeer,
  onRevokePeer,
}: PeerTableProps) {
  const allSelected =
    peers.length > 0 && peers.every((peer) => selectedKeys.has(getPeerKey(peer)));

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all peers"
            checked={allSelected}
            onChange={(event) => onToggleAll(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.alias ?? row.original.publicKey}`}
            checked={selectedKeys.has(getPeerKey(row.original))}
            onChange={() => onTogglePeer(row.original)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
        ),
      }),
      columnHelper.accessor('alias', {
        header: 'Alias',
        cell: ({ row, getValue }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-100">
              {getValue() || row.original.username || 'Unnamed peer'}
            </p>
            <p className="truncate text-xs text-zinc-500">{row.original.publicKey}</p>
          </div>
        ),
      }),
      columnHelper.accessor('serverName', {
        header: 'Server',
        cell: ({ row }) => (
          <div>
            <p className="text-sm text-zinc-200">{row.original.serverName ?? 'Unknown'}</p>
            <p className="text-xs text-zinc-500">{row.original.wgInterface ?? 'wg?'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('allowedIps', {
        header: 'IP',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-zinc-300">{getValue() ?? 'N/A'}</span>
        ),
      }),
      columnHelper.accessor('latestHandshakeUnix', {
        header: 'Last Handshake',
        cell: ({ getValue }) => (
          <span className="text-sm text-zinc-300">
            {formatRelativeHandshake(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ row }) => {
          if (row.original.status === 'healthy') {
            return (
              <Badge
                variant="success"
                title="Healthy: the server has seen a recent WireGuard handshake from this peer."
              >
                Healthy
              </Badge>
            );
          }
          if (row.original.status === 'quiet') {
            return (
              <Badge
                variant="warning"
                title="Quiet: this peer was seen before, but not recently."
              >
                Quiet
              </Badge>
            );
          }
          if (row.original.status === 'never-established') {
            return (
              <Badge
                variant="outline"
                title="Never established: no WireGuard handshake has ever been recorded for this peer."
              >
                Never established
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              title="Unavailable: live peer status could not be fetched from the WireGuard server."
            >
              Unavailable
            </Badge>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onEditPeer(row.original)}>
              <PencilLine className="h-4 w-4" />
              Edit
            </Button>
            {row.original.hasConfig ? (
              <Button variant="ghost" size="sm" onClick={() => onDownloadPeer(row.original)}>
                <Download className="h-4 w-4" />
                Config
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => onRevokePeer(row.original)}>
              <ShieldOff className="h-4 w-4 text-red-400" />
              Revoke
            </Button>
          </div>
        ),
      }),
    ],
    [allSelected, onDownloadPeer, onEditPeer, onRevokePeer, onToggleAll, onTogglePeer, selectedKeys]
  );

  const table = useReactTable({
    data: peers,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-800">
          <thead className="bg-zinc-950/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-zinc-500"
                >
                  No peers matched the current filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-950/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
