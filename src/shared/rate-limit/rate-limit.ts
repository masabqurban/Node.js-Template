import type { Request, RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';

export type RateLimitHit = { count: number; resetAt: number };

/**
 * Where counters live. The in-memory store suits one server process. With
 * several instances, implement this with Redis (INCR + PEXPIRE) so every
 * instance shares the same counters; the middleware does not change.
 */
export type RateLimitStore = {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
};

/** Fixed-window counters in a Map, swept as windows expire so memory stays bounded. */
export function createMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore {
  const counters = new Map<string, RateLimitHit>();
  let nextSweep = 0;

  function sweep(time: number) {
    if (time < nextSweep) return;
    for (const [key, counter] of counters) {
      if (counter.resetAt <= time) counters.delete(key);
    }
    nextSweep = time + 60_000;
  }

  return {
    hit(key, windowMs) {
      const time = now();
      sweep(time);
      const current = counters.get(key);
      const counter =
        current && current.resetAt > time
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: time + windowMs };
      counters.set(key, counter);
      return Promise.resolve(counter);
    },
  };
}

type RateLimitOptions = {
  store: RateLimitStore;
  /** Distinguishes limiters that share a store, e.g. "api" vs "auth". */
  name: string;
  limit: number;
  windowMs: number;
  key?: (req: Request) => string;
  now?: () => number;
};

/**
 * Rejects requests over `limit` per `windowMs` with 429 and `Retry-After`, and
 * reports the budget in the standard `RateLimit-*` headers.
 */
export function rateLimit({
  store,
  name,
  limit,
  windowMs,
  key = (req) => req.ip ?? 'unknown',
  now = Date.now,
}: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const { count, resetAt } = await store.hit(`${name}:${key(req)}`, windowMs);
    const resetSeconds = Math.max(0, Math.ceil((resetAt - now()) / 1000));

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (count > limit) throw AppError.tooManyRequests(Math.max(1, resetSeconds));
    next();
  };
}
