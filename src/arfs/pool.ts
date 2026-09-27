/**
 * A concurrency gate shared across independent callers.
 *
 * `mapPool` bounds one call site; this bounds the whole process. That distinction matters: the
 * cold sync runs six block shards in parallel, and if each opened its own pool of 48 the browser
 * would try ~288 simultaneous requests to one host, exhaust its connection pool, and wedge — which
 * is exactly what happened before this existed.
 */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  protected limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  get inFlight(): number {
    return this.active;
  }

  get width(): number {
    return this.limit;
  }
}

/**
 * A gate that discovers the server's rate limit instead of assuming one.
 *
 * arweave.net rate-limits hard and without warning: measured from a browser, a sustained 24-way
 * fetch got HTTP 429 on 48% of requests, and 48-way was no better. But a fixed low limit wastes
 * throughput when the gateway is healthy. So this uses AIMD — the same control law TCP uses:
 * add one slot after a run of successes, halve on a 429. It converges on whatever the gateway is
 * currently willing to serve.
 */
export class AdaptiveGate extends Gate {
  private readonly min: number;
  private readonly max: number;
  private consecutiveOk = 0;
  private cooldownUntil = 0;

  constructor(opts: { initial: number; min: number; max: number }) {
    super(opts.initial);
    this.min = opts.min;
    this.max = opts.max;
  }

  /** Called after a request the server accepted. */
  reward(): void {
    this.consecutiveOk++;
    if (this.consecutiveOk >= this.limit * 2 && this.limit < this.max) {
      this.limit++;
      this.consecutiveOk = 0;
    }
  }

  /** Called on a 429. Halves capacity and pauses new work briefly. */
  penalise(cooldownMs: number): void {
    this.consecutiveOk = 0;
    this.limit = Math.max(this.min, Math.floor(this.limit / 2));
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + cooldownMs);
  }

  /** Resolves once the current cooldown (if any) has elapsed. */
  async waitForCooldown(): Promise<void> {
    const remaining = this.cooldownUntil - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/** Bounded-concurrency map. Results keep input order; failures surface as `undefined`. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R | undefined, item: T, index: number) => void,
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length);
  if (!items.length) return results;

  let next = 0;
  const width = Math.max(1, Math.min(concurrency, items.length));

  const run = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      let value: R | undefined;
      try {
        value = await worker(item, i);
      } catch {
        value = undefined;
      }
      results[i] = value;
      onSettled?.(value, item, i);
    }
  };

  await Promise.all(Array.from({ length: width }, run));
  return results;
}

/**
 * Bounded-concurrency map that *streams* results to the consumer as each item finishes, instead of
 * resolving only once the whole batch is done. `mapPool` is the right tool when a caller needs
 * every result, index-aligned with the input, before it can proceed; this is for the opposite case
 * — batch download needs to start writing a file into the zip while later files are still being
 * fetched, without ever holding more than `concurrency` files' worth of bytes in memory at once.
 * That memory bound is the actual point: it's what keeps a large batch download from becoming the
 * same "buffer everything" problem that makes JSZip crash on big archives (see
 * `arfs/download.ts`'s module comment for the full reasoning).
 *
 * Yields in **completion order, not input order** — deliberately. An earlier version awaited each
 * index in turn (`await inFlight.get(i)`), which meant one slow item at position 0 blocked every
 * later item from being yielded even after they'd already finished — real head-of-line blocking,
 * since a ZIP's entries don't need to appear in any particular order (each carries its own name in
 * its local header) and `download.ts`'s caller never relied on input order either. This version
 * yields whichever item finishes first, so a batch download's actual wall-clock time tracks the
 * slowest item overall, not "the slowest item that happened to be queued early."
 *
 * A failed item is silently skipped (not yielded, not thrown) — the caller sees fewer results than
 * inputs and is expected to track failures itself via its own `worker`, same "don't let one bad
 * item take down the whole batch" philosophy as `sync.ts`'s unresolved-entity handling.
 */
export interface StreamPoolLimits<T> {
  /** Relative cost of holding one item's result in memory — batch download passes its byte size. */
  weight: (item: T) => number;
  /**
   * Maximum total weight held at once, counting both running items and finished results the
   * consumer hasn't taken yet. An item heavier than the whole budget still runs — alone — so a
   * single oversized item can never deadlock the pool.
   */
  budget: number;
}

export async function* streamPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  limits?: StreamPoolLimits<T>,
): AsyncGenerator<R> {
  if (!items.length) return;
  const width = Math.max(1, Math.min(concurrency, items.length));
  const weightOf = (i: number) => (limits ? Math.max(0, limits.weight(items[i]!)) : 0);

  // A finished result keeps occupying its slot (and its weight) until the consumer has actually
  // taken it and asked for the next one. An earlier version of this function launched the next
  // item the moment any worker *finished*, regardless of whether its result had been consumed — so
  // with a consumer slower than the workers (a zip writer slower than the network), finished
  // results piled up without limit. Measured before this fix: concurrency 4, slow consumer, and all
  // 40 of 40 results were sitting in memory at once — the whole batch, exactly the "buffer
  // everything" failure this function exists to prevent.
  let next = 0;
  let active = 0;
  let consuming = 0;
  let heldWeight = 0;
  let settled = 0;
  const ready: { value: R; weight: number }[] = [];
  let wake: (() => void) | null = null;

  const canLaunch = () => {
    if (next >= items.length) return false;
    if (active + ready.length + consuming >= width) return false;
    if (!limits) return true;
    return heldWeight === 0 || heldWeight + weightOf(next) <= limits.budget;
  };

  const launch = () => {
    const i = next++;
    const weight = weightOf(i);
    active++;
    heldWeight += weight;
    worker(items[i]!, i)
      .then(
        (value) => {
          ready.push({ value, weight });
        },
        () => {
          heldWeight -= weight;
        },
      )
      .finally(() => {
        active--;
        settled++;
        fill();
        const resume = wake;
        wake = null;
        resume?.();
      });
  };

  const fill = () => {
    while (canLaunch()) launch();
  };

  fill();
  while (settled < items.length || ready.length > 0) {
    if (ready.length > 0) {
      const { value, weight } = ready.shift()!;
      consuming = 1;
      yield value;
      // Execution resumes here only when the consumer asks for the next item — i.e. once it's done
      // with this one — so that's the earliest point its memory can honestly be counted as freed.
      consuming = 0;
      heldWeight -= weight;
      fill();
    } else {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
}
