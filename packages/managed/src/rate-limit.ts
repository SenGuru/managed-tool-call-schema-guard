import type { Principal } from './types.js';
import { ManagedError } from './store.js';

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { started: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}
  consume(principal: Principal, currentTime = Date.now()): void {
    const existing = this.windows.get(principal.keyId);
    if (!existing || currentTime - existing.started >= this.windowMs) {
      this.windows.set(principal.keyId, { started: currentTime, count: 1 });
      return;
    }
    if (existing.count >= this.limit)
      throw new ManagedError(429, 'rate_limit_exceeded', 'per-key rate limit exceeded');
    existing.count += 1;
  }
}
