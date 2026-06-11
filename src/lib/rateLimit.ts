// Minimal in-memory rate limiter for API routes. Per-IP sliding window.
// Good enough for a single-node deployment; swap for Redis/edge KV at scale.

const hits = new Map<string, number[]>();

export function rateLimit(
  ip: string,
  bucket: string,
  limit: number,
  windowMs = 60_000,
): { allowed: boolean } {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return { allowed: false };
  }
  arr.push(now);
  hits.set(key, arr);
  return { allowed: true };
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}
