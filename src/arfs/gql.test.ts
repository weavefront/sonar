import { describe, expect, it, vi } from 'vitest';
import { ArweaveGql, buildQuery, DEFAULT_GATEWAYS, MAX_PAGE_SIZE, paginate, queryAll, queryFirst } from './gql';

const okResponse = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const page = (ids: string[], hasNextPage = false) => ({
  transactions: {
    edges: ids.map((id) => ({
      cursor: `cursor-${id}`,
      node: { id, owner: { address: 'OWNER' }, block: { height: 1, timestamp: 1 }, tags: [] },
    })),
    pageInfo: { hasNextPage },
  },
});

describe('buildQuery', () => {
  it('emits owners, tag filters, block range, paging and sort', () => {
    const q = buildQuery({
      tags: [{ name: 'Entity-Type', values: ['folder', 'file'] }],
      owners: ['ADDR'],
      minHeight: 10,
      maxHeight: 20,
      after: 'CUR',
      sort: 'HEIGHT_ASC',
    });
    expect(q).toContain('owners:["ADDR"]');
    expect(q).toContain('tags:[{name:"Entity-Type",values:["folder","file"]}]');
    expect(q).toContain('block:{min:10,max:20}');
    expect(q).toContain('after:"CUR"');
    expect(q).toContain('sort:HEIGHT_ASC');
  });

  it('clamps page size to the gateway maximum', () => {
    // Gateways silently cap at 100; asking for more just wastes the request.
    expect(buildQuery({ tags: [], first: 5000 })).toContain(`first:${MAX_PAGE_SIZE}`);
  });

  it('escapes values that would otherwise break out of the query string', () => {
    const q = buildQuery({ tags: [{ name: 'X', values: ['a"b\\c'] }] });
    expect(q).toContain(String.raw`values:["a\"b\\c"]`);
  });

  it('omits the block filter entirely when no range is given', () => {
    expect(buildQuery({ tags: [] })).not.toContain('block:');
  });
});

describe('ArweaveGql', () => {
  it('falls over to the next gateway when the first fails', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('bad')) throw new Error('network down');
      return okResponse(page(['tx1']));
    }) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://bad', 'https://good'], fetchImpl, hedgeAfterMs: 10 });
    const data = await gql.query<ReturnType<typeof page>>('{}');
    expect(data.transactions.edges[0]?.node.id).toBe('tx1');
  });

  it('surfaces GraphQL-level errors', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl, retries: 0 });
    await expect(gql.query('{}')).rejects.toThrow(/bad query/);
  });

  it('retries and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('flaky');
      return okResponse(page(['tx1']));
    }) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl, retries: 2 });
    await expect(gql.query('{}')).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it('rejects when every gateway is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const gql = new ArweaveGql({ gateways: ['https://a', 'https://b'], fetchImpl, retries: 0, hedgeAfterMs: 5 });
    await expect(gql.query('{}')).rejects.toThrow();
  });

  it('takes the fast gateway when the primary is slow (hedging)', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('slow')) {
        await new Promise((r) => setTimeout(r, 500));
        return okResponse(page(['slow-tx']));
      }
      return okResponse(page(['fast-tx']));
    }) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://slow', 'https://fast'], fetchImpl, hedgeAfterMs: 20 });
    const data = await gql.query<ReturnType<typeof page>>('{}');
    expect(data.transactions.edges[0]?.node.id).toBe('fast-tx');
  });
});

describe('paginate', () => {
  it('follows cursors until hasNextPage is false', async () => {
    const pages = [page(['a'], true), page(['b'], true), page(['c'], false)];
    let i = 0;
    const fetchImpl = vi.fn(async () => okResponse(pages[i++])) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl });
    const edges = await queryAll(gql, { tags: [] });
    expect(edges.map((e) => e.node.id)).toEqual(['a', 'b', 'c']);
  });

  it('passes the last cursor of a page as the next page marker', async () => {
    const queries: string[] = [];
    const pages = [page(['a', 'b'], true), page(['c'], false)];
    let i = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      queries.push(JSON.parse(String(init?.body)).query);
      return okResponse(pages[i++]);
    }) as unknown as typeof fetch;

    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl });
    await queryAll(gql, { tags: [] });
    expect(queries[1]).toContain('after:"cursor-b"');
  });

  it('queryFirst issues exactly one request even when more pages exist', async () => {
    // Regression: probing a drive's start height with queryAll({first:1}) paginated the entire
    // drive one transaction per round-trip — 200+ requests and no progress on a 1500-file drive.
    const fetchImpl = vi.fn(async () => okResponse(page(['a'], true))) as unknown as typeof fetch;
    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl });

    const edge = await queryFirst(gql, { tags: [] });

    expect(edge?.node.id).toBe('a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('queryFirst asks the gateway for a single record', async () => {
    let query = '';
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      query = JSON.parse(String(init?.body)).query;
      return okResponse(page(['a'], false));
    }) as unknown as typeof fetch;

    await queryFirst(new ArweaveGql({ gateways: ['https://a'], fetchImpl }), { tags: [], first: 100 });
    expect(query).toContain('first:1');
  });

  it('stops when an abort signal is set', async () => {
    const fetchImpl = vi.fn(async () => okResponse(page(['a'], true))) as unknown as typeof fetch;
    const gql = new ArweaveGql({ gateways: ['https://a'], fetchImpl });

    const signal = { aborted: false };
    const seen: string[] = [];
    for await (const p of paginate(gql, { tags: [] }, signal)) {
      seen.push(p[0]!.node.id);
      signal.aborted = true;
    }
    expect(seen).toHaveLength(1);
  });
});

describe('empty results get a second opinion', () => {
  // An incomplete gateway index answers with a valid, empty result rather than an error, so
  // failover alone never notices. Seen live: arweave.net returned 0 transactions for a drive
  // that permagate.io and goldsky both returned 10 for.
  const byGateway = (answers: Record<string, () => Response>) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const gateway = new URL(String(url)).origin;
      calls.push(gateway);
      const answer = answers[gateway];
      if (!answer) throw new Error(`unexpected gateway ${gateway}`);
      return answer();
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it('takes the next gateway’s non-empty answer when the primary finds nothing', async () => {
    const { calls, fetchImpl } = byGateway({
      'https://incomplete': () => okResponse(page([])),
      'https://complete': () => okResponse(page(['a', 'b'])),
    });
    const gql = new ArweaveGql({ gateways: ['https://incomplete', 'https://complete'], fetchImpl });

    const edges = await queryAll(gql, { tags: [] });

    expect(edges.map((e) => e.node.id)).toEqual(['a', 'b']);
    expect(calls).toEqual(['https://incomplete', 'https://complete']);
  });

  it('does the same for queryFirst', async () => {
    const { fetchImpl } = byGateway({
      'https://incomplete': () => okResponse(page([])),
      'https://complete': () => okResponse(page(['first'])),
    });
    const gql = new ArweaveGql({ gateways: ['https://incomplete', 'https://complete'], fetchImpl });

    expect((await queryFirst(gql, { tags: [] }))?.node.id).toBe('first');
  });

  it('never asks a second gateway when the primary found something', async () => {
    const { calls, fetchImpl } = byGateway({
      'https://a': () => okResponse(page(['x'])),
      'https://b': () => okResponse(page(['y'])),
    });
    const gql = new ArweaveGql({ gateways: ['https://a', 'https://b'], fetchImpl });

    await queryAll(gql, { tags: [] });

    expect(calls).toEqual(['https://a']);
  });

  it('accepts empty once every gateway agrees', async () => {
    const { calls, fetchImpl } = byGateway({
      'https://a': () => okResponse(page([])),
      'https://b': () => okResponse(page([])),
    });
    const gql = new ArweaveGql({ gateways: ['https://a', 'https://b'], fetchImpl });

    expect(await queryAll(gql, { tags: [] })).toEqual([]);
    expect(calls).toEqual(['https://a', 'https://b']);
  });

  it('keeps the empty answer instead of failing when the fallback is down', async () => {
    const { fetchImpl } = byGateway({
      'https://a': () => okResponse(page([])),
      'https://b': () => {
        throw new Error('down');
      },
    });
    const gql = new ArweaveGql({ gateways: ['https://a', 'https://b'], fetchImpl, retries: 0 });

    await expect(queryAll(gql, { tags: [] })).resolves.toEqual([]);
  });

  it('leaves plain query() callers without isEmpty untouched', async () => {
    const { calls, fetchImpl } = byGateway({
      'https://a': () => okResponse(page([])),
      'https://b': () => okResponse(page(['y'])),
    });
    const gql = new ArweaveGql({ gateways: ['https://a', 'https://b'], fetchImpl });

    const data = await gql.query<ReturnType<typeof page>>('{}');

    expect(data.transactions.edges).toEqual([]);
    expect(calls).toEqual(['https://a']);
  });

  it('uses permagate.io as the primary GraphQL gateway, arweave.net as fallback', () => {
    expect(DEFAULT_GATEWAYS).toEqual(['https://permagate.io', 'https://arweave.net']);
  });
});
