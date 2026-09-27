/**
 * Large-drive stress test. Gated behind SWIFTDRIVE_STRESS=1 — hits mainnet and is slow.
 *
 *     SWIFTDRIVE_STRESS=1 npx vitest run src/arfs/stress.test.ts
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ArfsClient } from './sync';
import { buildTree } from './tree';
import { cache } from '../cache/db';

const STRESS = process.env.SWIFTDRIVE_STRESS === '1';

const DRIVE_ID = 'e0307ae3-3c88-410f-bd6b-8632511c4515';
const OWNER = 'Jw8RIR014jxYo62rHAazyfVhJ-BFO0WnF3hK09gpnyQ';

describe.skipIf(!STRESS)('large drive cold sync', () => {
  it('completes and builds a tree', async () => {
    await cache.clear();

    let fetches = 0;
    const counting: typeof fetch = (input, init) => {
      if (!String(input).includes('/graphql')) fetches++;
      return globalThis.fetch(input as RequestInfo, init);
    };

    const t0 = Date.now();
    let lastLog = 0;
    const client = new ArfsClient({ fetchImpl: counting });
    const entities = await client.syncDrive(DRIVE_ID, OWNER, {
      onProgress: (p) => {
        // Time-throttled, not count-throttled: a count filter hides exactly the stalls we're
        // looking for, because a stalled sync never reaches the next milestone.
        const now = Date.now();
        if (now - lastLog > 3000) {
          lastLog = now;
          console.log(`  ${Math.round((now - t0) / 1000)}s phase=${p.phase} found=${p.found} resolved=${p.resolved} fetches=${fetches}`);
        }
      },
    });
    const elapsed = (Date.now() - t0) / 1000;
    const tree = buildTree(entities);

    console.log(
      `cold: ${elapsed.toFixed(1)}s, ${entities.length} revisions, ${fetches} body fetches, ` +
        `${tree.foldersById.size} folders, ${tree.filesById.size} files, ${tree.orphans.length} orphans`,
    );

    expect(entities.length).toBeGreaterThan(500);
    expect(tree.filesById.size).toBeGreaterThan(100);
  }, 900_000);
});
