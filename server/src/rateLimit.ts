/**
 * Fixed-window limiter kept in memory: at most `max` hits per key per window.
 * shortcut: memory is per process, so it resets on restart and isn't shared across servers; use Redis if we scale out.
 */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return (key: string, nowMs: number) => {
    const entry = hits.get(key)
    if (!entry || nowMs >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: nowMs + windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= max
  }
}
