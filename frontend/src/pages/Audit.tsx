import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Filter } from 'lucide-react';
import { auditApi, serversApi, type AuditLog, type Server } from '@/lib/api.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Select } from '@/components/ui/select.js';
import { Badge } from '@/components/ui/badge.js';

export function AuditPage() {
  const [serverId, setServerId] = useState('');
  const [result, setResult] = useState('');
  const [action, setAction] = useState('');

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: (): Promise<Server[]> => serversApi.list(),
  });

  const auditQuery = useQuery({
    queryKey: ['audit', serverId, result, action],
    queryFn: () =>
      auditApi.list({
        limit: 100,
        serverId: serverId ? Number(serverId) : undefined,
        result: result === 'success' || result === 'fail' ? result : undefined,
        action: action || undefined,
      }),
  });

  const logs: AuditLog[] = auditQuery.data?.data ?? [];
  const totals = useMemo(
    () => ({
      success: logs.filter((log) => log.result === 'success').length,
      fail: logs.filter((log) => log.result === 'fail').length,
    }),
    [logs]
  );

  return (
    <div className="min-h-full bg-zinc-950 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-4 xl:grid-cols-[1.3fr,1fr]">
          <Card className="border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_30%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98))]">
            <CardHeader>
              <CardTitle className="text-3xl">Audit Log</CardTitle>
              <CardDescription>
                Review every administrative action, including server changes, SSH
                tests, metadata edits, and peer revocations.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Input
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="Filter by action"
              />
              <Select
                value={serverId}
                onChange={(event) => setServerId(event.target.value)}
              >
                <option value="">All servers</option>
                {serversQuery.data?.map((server: Server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </Select>
              <Select
                value={result}
                onChange={(event) => setResult(event.target.value)}
              >
                <option value="">All results</option>
                <option value="success">Success</option>
                <option value="fail">Fail</option>
              </Select>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-zinc-800 p-3 text-zinc-300">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Entries loaded</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {logs.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
                  <Filter className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Success</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {totals.success}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="mb-3 inline-flex rounded-2xl bg-red-500/10 p-3 text-red-400">
                  <Filter className="h-5 w-5" />
                </div>
                <p className="text-sm text-zinc-400">Failures</p>
                <p className="text-2xl font-semibold text-zinc-100">
                  {totals.fail}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-950/70">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Peer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Result
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-zinc-500"
                    >
                      No audit entries matched the current filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-950/50">
                      <td className="px-4 py-3 text-sm text-zinc-300">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-100">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-300">
                        {log.performedBy}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {log.peerAlias || log.peerPublicKey || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            log.result === 'success' ? 'success' : 'destructive'
                          }
                        >
                          {log.result}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-red-300">
                        {log.errorMessage || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
