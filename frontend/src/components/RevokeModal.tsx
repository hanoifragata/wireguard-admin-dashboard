import { Fragment } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';
import type { GlobalPeer } from '@/lib/api.js';

interface RevokeModalProps {
  open: boolean;
  peers: GlobalPeer[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RevokeModal({
  open,
  peers,
  isSubmitting,
  onClose,
  onConfirm,
}: RevokeModalProps) {
  const groupedPeers = Array.from(
    peers
      .reduce((map, peer) => {
        const key = `${peer.serverId}:${peer.serverName ?? 'Unknown server'}`;
        const existing = map.get(key) ?? [];
        existing.push(peer);
        map.set(key, existing);
        return map;
      }, new Map<string, GlobalPeer[]>())
      .entries()
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Revoke selected peers</DialogTitle>
          <DialogDescription>
            This action is irreversible. WireGuard configs will be updated and persisted on each affected server.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {groupedPeers.length === 0 ? (
            <p className="text-sm text-zinc-400">No peers selected.</p>
          ) : (
            groupedPeers.map(([groupKey, groupPeers]) => (
              <Fragment key={groupKey}>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <p className="font-medium text-zinc-100">
                      {groupPeers[0]?.serverName ?? 'Unknown server'}
                    </p>
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {groupPeers.length} peer{groupPeers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {groupPeers.map((peer) => (
                      <div
                        key={`${peer.serverId}-${peer.publicKey}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-100">
                            {peer.alias || peer.username || 'Unnamed peer'}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{peer.publicKey}</p>
                        </div>
                        <p className="text-xs text-zinc-400">
                          {peer.allowedIps ?? 'No IP'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </Fragment>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            isLoading={isSubmitting}
            disabled={peers.length === 0}
          >
            Revoke {peers.length} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
