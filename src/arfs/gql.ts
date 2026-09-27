/**
 * Arweave GraphQL client.
 *
 * Measured against mainnet, a single GraphQL page costs 1.4–3.7s on every gateway tried, and that
 * latency — not parsing, not rendering — is the dominant cost of listing a drive. Three mitigations
 * live here:
 *
 *   1. Hedged requests. Ask the primary gateway; if it hasn't answered within `hedgeAfterMs`, ask a
 *      second one too and take whichever returns first. Turns a slow gateway into a fast one without
 *      doubling load in the common case.
 *   2. Failover + backoff retry, because public gateways are individually flaky.
 *   3. Block-sharded pagination, so a drive's history can be walked in parallel instead of as a
 *      serial cursor chase.
 */

import type { GqlEdge } from './types';

/** Verified GraphQL-compatible during planning. Order matters: index 0 is the primary. */
export const DEFAULT_GATEWAYS = ['https://arweave.net', 'https://permagate.io'] as const;

/**
 * Gateways that actually serve transaction *data*, which is a strictly smaller set than those
 * serving GraphQL — `permagate.io` answers GraphQL fine but times out on `/{txId}`.
 *
 * Keeping these lists separate is load-bearing. Round-robining data fetches across a gateway that
 * cannot serve them means every other request burns the full fetch timeout before failing over,
 * which is far slower than simply using one good gateway.
 */
export const DEFAULT_DATA_GATEWAYS = ['https://arweave.net'] as const;

/**
 * Data gateways for single, correctness-critical fetches that must not fail just because
 * `arweave.net` doesn't have the transaction.
 *
 * `arweave.net` genuinely 404s on some transactions it has *indexed* in GraphQL — confirmed live
 * against a real private drive whose metadata tx returned 404 on `arweave.net` while Turbo's own
 * gateway (where it was originally uploaded) served it immediately. That is fatal for a private
 * drive: its metadata and `drive-signature` bridge are each a single tx with no alternative source,
 * so one 404 means the drive simply cannot be opened.
 *
 * Deliberately *not* the default for bulk body fetches: `turbo-gateway.com` has been observed
 * taking 5–17s (or timing out) on transactions `arweave.net` serves instantly, and `fetchBodyAs`
 * rotates its starting gateway to spread load — which at drive-listing scale would put a large
 * share of thousands of requests on the slower host. One-shot unlock fetches have no such volume,
 * so there correctness wins over latency.
 */
export const RESILIENT_DATA_GATEWAYS = ['https://arweave.net', 'https://turbo-gateway.com'] as const;

/** Gateway-enforced ceiling: asking for more than 100 silently returns 100. */
export const MAX_PAGE_SIZE = 100;

export interface GqlOptions {
  gateways?: readonly string[];
  /** Delay before a second gateway is raced against the first. */
  hedgeAfterMs?: number;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export class GqlError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ArweaveGql {
  readonly gateways: readonly string[];
  private readonly hedgeAfterMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GqlOptions = {}) {
    this.gateways = opts.gateways?.length ? opts.gateways : DEFAULT_GATEWAYS;
    // Normal page latency is 1.4–3.7s, so hedging must sit above that band; otherwise almost
    // every query spawns a second request and doubles gateway load for nothing.
    this.hedgeAfterMs = opts.hedgeAfterMs ?? 4000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 2;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async postTo<T>(gateway: string, query: string, signal: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`${gateway}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!res.ok) throw new GqlError(`${gateway} responded ${res.status}`);
    const body = (await res.json()) as GqlResponse<T>;
    if (body.errors?.length) throw new GqlError(body.errors.map((e) => e.message).join('; '));
    if (!body.data) throw new GqlError(`${gateway} returned no data`);
    return body.data;
  }

  /** Run a query, hedging across gateways and retrying with backoff. */
  async query<T>(query: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      // Rotate the primary on retry so a single sick gateway can't stall every attempt.
      const ordered = this.gateways.map((_, i) => this.gateways[(i + attempt) % this.gateways.length]!);

      try {
        return await this.hedge<T>(ordered, query, controller.signal);
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) await sleep(300 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }
    throw lastError instanceof Error ? lastError : new GqlError(String(lastError));
  }

  /**
   * Issue to the first gateway; if it is still silent after `hedgeAfterMs`, add the next one and
   * take the first success. Resolves as soon as any gateway succeeds; rejects only if all fail.
   */
  private hedge<T>(gateways: readonly string[], query: string, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let failures = 0;
      let launched = 0;
      const errors: unknown[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        fn();
      };

      const launch = (gateway: string) => {
        if (settled) return;
        launched++;
        this.postTo<T>(gateway, query, signal)
          .then((data) => finish(() => resolve(data)))
          .catch((err) => {
            errors.push(err);
            failures++;
            // A failure is a reason to bring the next gateway forward immediately.
            if (failures === launched && launched < gateways.length) launch(gateways[launched]!);
            else if (failures === gateways.length) {
              finish(() => reject(new GqlError(errors.map((e) => (e as Error).message).join(' | '))));
            }
          });
      };

      launch(gateways[0]!);
      for (let i = 1; i < gateways.length; i++) {
        timers.push(setTimeout(() => launch(gateways[i]!), this.hedgeAfterMs * i));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

export interface TagFilter {
  name: string;
  values: string[];
}

export interface QuerySpec {
  tags: TagFilter[];
  owners?: string[];
  minHeight?: number;
  maxHeight?: number;
  after?: string | null;
  first?: number;
  /** ASC is required for incremental sync: we record progress as we advance through history. */
  sort?: 'HEIGHT_ASC' | 'HEIGHT_DESC';
}

/** JSON.stringify gives us correct GraphQL string escaping for free. */
const str = (s: string) => JSON.stringify(s);

export function buildQuery(spec: QuerySpec): string {
  const args: string[] = [];

  if (spec.owners?.length) args.push(`owners:[${spec.owners.map(str).join(',')}]`);

  const tags = spec.tags.map((t) => `{name:${str(t.name)},values:[${t.values.map(str).join(',')}]}`);
  if (tags.length) args.push(`tags:[${tags.join(',')}]`);

  if (spec.minHeight !== undefined || spec.maxHeight !== undefined) {
    const parts: string[] = [];
    if (spec.minHeight !== undefined) parts.push(`min:${spec.minHeight}`);
    if (spec.maxHeight !== undefined) parts.push(`max:${spec.maxHeight}`);
    args.push(`block:{${parts.join(',')}}`);
  }

  args.push(`first:${Math.min(spec.first ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)}`);
  args.push(`sort:${spec.sort ?? 'HEIGHT_ASC'}`);
  if (spec.after) args.push(`after:${str(spec.after)}`);

  return `{transactions(${args.join(',')}){edges{cursor node{id owner{address} block{height timestamp} tags{name value}}}pageInfo{hasNextPage}}}`;
}

interface TransactionsResult {
  transactions: {
    edges: GqlEdge[];
    pageInfo: { hasNextPage: boolean };
  };
}

/**
 * Walk every page of a query, yielding each page as it arrives so callers can render
 * progressively rather than waiting for the full history.
 */
export async function* paginate(
  gql: ArweaveGql,
  spec: QuerySpec,
  signal?: { aborted: boolean },
): AsyncGenerator<GqlEdge[]> {
  let after = spec.after ?? null;

  while (!signal?.aborted) {
    const data = await gql.query<TransactionsResult>(buildQuery({ ...spec, after }));
    const { edges, pageInfo } = data.transactions;
    if (edges.length) yield edges;
    if (!pageInfo.hasNextPage || !edges.length) return;
    after = edges[edges.length - 1]!.cursor;
  }
}

/** Collect every edge of a query into one array. */
export async function queryAll(gql: ArweaveGql, spec: QuerySpec): Promise<GqlEdge[]> {
  const out: GqlEdge[] = [];
  for await (const page of paginate(gql, spec)) out.push(...page);
  return out;
}

/**
 * Fetch only the first matching transaction, with no pagination.
 *
 * Deliberately not `queryAll(..., { first: 1 })`: that paginates, so it would walk an entire
 * drive one transaction per round-trip. Used to probe a drive's earliest block.
 */
export async function queryFirst(gql: ArweaveGql, spec: QuerySpec): Promise<GqlEdge | null> {
  const data = await gql.query<TransactionsResult>(buildQuery({ ...spec, first: 1, after: null }));
  return data.transactions.edges[0] ?? null;
}

/** Current network height, used to bound sync ranges. */
export async function currentHeight(gql: ArweaveGql): Promise<number> {
  const data = await gql.query<{ blocks: { edges: { node: { height: number } }[] } }>(
    '{blocks(first:1,sort:HEIGHT_DESC){edges{node{height}}}}',
  );
  return data.blocks.edges[0]?.node.height ?? 0;
}
