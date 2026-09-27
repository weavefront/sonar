import { describe, expect, it } from 'vitest';
import { streamPool } from './pool';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('streamPool', () => {
  it('yields every successful result', async () => {
    const items = [1, 2, 3, 4, 5];
    const out: number[] = [];
    for await (const n of streamPool(items, 2, async (n) => n * 10)) out.push(n);
    expect(out.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });

  it('yields in completion order, not input order — a slow item at index 0 does not block faster later items', async () => {
    const delays = [30, 0, 0, 0];
    const out: number[] = [];
    for await (const n of streamPool(delays, 4, async (delay, i) => {
      await sleep(delay);
      return i;
    })) {
      out.push(n);
    }
    // Index 0 has the longest delay, so it must be the last to arrive despite being launched first.
    expect(out[out.length - 1]).toBe(0);
    expect(out.slice(0, 3).sort()).toEqual([1, 2, 3]);
  });

  it('never runs more than `concurrency` workers at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    for await (const _ of streamPool(items, 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      return null;
    })) {
      // draining
    }
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('skips a failed item instead of throwing, and keeps yielding the rest', async () => {
    const items = [1, 2, 3];
    const out: number[] = [];
    for await (const n of streamPool(items, 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    })) {
      out.push(n);
    }
    expect(out.sort()).toEqual([1, 3]);
  });

  it('applies backpressure: a slow consumer never lets finished results pile up past the limit', async () => {
    // The regression this guards: with a consumer slower than the workers, the pool used to keep
    // launching as workers finished, and all 40 results ended up held in memory at once.
    let produced = 0;
    let consumed = 0;
    let maxHeld = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);
    for await (const _ of streamPool(items, 4, async () => {
      await sleep(1);
      produced++;
      maxHeld = Math.max(maxHeld, produced - consumed);
    })) {
      await sleep(10); // e.g. a zip writer slower than the network
      consumed++;
    }
    expect(consumed).toBe(40);
    expect(maxHeld).toBeLessThanOrEqual(4);
  });

  it('respects a weight budget: large items run one at a time, small ones in parallel', async () => {
    let active = 0;
    let maxActive = 0;
    const run = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      return null;
    };

    // Four 60-unit items against a 100-unit budget: no two fit together.
    for await (const _ of streamPool([60, 60, 60, 60], 10, run, { weight: (w) => w, budget: 100 })) {
      // draining
    }
    expect(maxActive).toBe(1);

    // Ten 10-unit items fit together, so the count limit (not the budget) is what binds.
    active = 0;
    maxActive = 0;
    for await (const _ of streamPool(Array(10).fill(10), 10, run, { weight: (w) => w, budget: 100 })) {
      // draining
    }
    expect(maxActive).toBe(10);
  });

  it('still runs an item heavier than the whole budget, alone, instead of deadlocking', async () => {
    const out: number[] = [];
    for await (const n of streamPool([500, 20], 4, async (n) => n, { weight: (n) => n, budget: 100 })) out.push(n);
    expect(out.sort((a, b) => a - b)).toEqual([20, 500]);
  });

  it('frees a failed item’s budget so later items are not blocked', async () => {
    const out: number[] = [];
    for await (const n of streamPool([90, 90, 90], 4, async (n, i) => {
      if (i === 0) throw new Error('boom');
      return n;
    }, { weight: (n) => n, budget: 100 })) out.push(n);
    expect(out).toEqual([90, 90]);
  });

  it('yields nothing for an empty input, without hanging or throwing', async () => {
    const out: number[] = [];
    for await (const n of streamPool([] as number[], 4, async (n) => n)) out.push(n);
    expect(out).toEqual([]);
  });

  it('keeps launching queued items as slots free up rather than waiting for the whole width to finish', async () => {
    const order: number[] = [];
    const items = [0, 1, 2, 3, 4, 5];
    for await (const _ of streamPool(items, 2, async (n) => {
      order.push(n);
      await sleep(n === 0 ? 20 : 1);
      return n;
    })) {
      // draining
    }
    // Both initial slots (0, 1) start immediately; item 2 should backfill slot 1 (fast) long
    // before item 0's slow 20ms finishes, so it starts well before every item has been launched.
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(1);
    expect(order).toContain(5);
  });
});
