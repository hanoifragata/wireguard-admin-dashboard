/**
 * Seed script: inserts a test server with mock peer data.
 * Run with: npm run seed
 */
import { db } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { servers, peers, auditLogs } from './db/schema.js';
import { encrypt } from './lib/crypto.js';

await runMigrations();

console.log('[Seed] Inserting test data...');

// Insert a mock server (SSH won't actually work without a real host)
const [server] = db
  .insert(servers)
  .values({
    name: 'Demo WireGuard Server',
    host: '10.0.0.1',
    port: 22,
    sshUser: 'root',
    authMethod: 'password',
    sshPassword: encrypt('demo-password'),
    wgInterface: 'wg0',
    description: 'Demo server for testing — not a real SSH host',
  })
  .returning()
  .all();

if (!server) {
  console.error('[Seed] Failed to insert server');
  process.exit(1);
}

console.log(`[Seed] Created server: ${server.name} (id=${server.id})`);

// Insert mock peers
const mockPeers = [
  {
    publicKey: 'JI69RMApBNwQPMFSopKVEz4W3mIKkHJWBiQi99r3Hws=',
    alias: 'alice-laptop',
    username: 'alice',
  },
  {
    publicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
    alias: 'alice-phone',
    username: 'alice',
  },
  {
    publicKey: 'bfLYB0bwl0PszdmTnzN/EQKTY4v1OyjYN9tEI05xRAI=',
    alias: 'bob-laptop',
    username: 'bob',
    notes: 'Bob from DevOps team',
  },
  {
    publicKey: 'OE9JAlMuGh5mR4CIqxnA6dvv3Ue8ZRvb8hOw5Pw2cSI=',
    alias: 'carol-workstation',
    username: 'carol',
  },
  {
    publicKey: 'N7vkiN2qfnPXdp5vlDpW3kR2f1J0vb2kBmqTfhWsVzY=',
    alias: null,
    username: null,
    notes: 'Unknown device — investigate',
  },
];

for (const p of mockPeers) {
  db.insert(peers)
    .values({ serverId: server.id, ...p })
    .run();
}

console.log(`[Seed] Inserted ${mockPeers.length} mock peers`);

// Insert some audit log entries
db.insert(auditLogs)
  .values([
    {
      action: 'SERVER_ADD',
      serverId: server.id,
      performedBy: 'admin',
      result: 'success',
    },
    {
      action: 'PEER_UPDATE_METADATA',
      serverId: server.id,
      peerPublicKey: mockPeers[0]!.publicKey,
      peerAlias: 'alice-laptop',
      performedBy: 'admin',
      result: 'success',
    },
  ])
  .run();

console.log('[Seed] Done!');
