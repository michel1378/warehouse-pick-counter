import { createHash, timingSafeEqual } from "node:crypto";

const buckets = new Map<string, { started: number; count: number }>();
const WINDOW_MS = 60_000;
const LIMIT = 120;

export function validAgentToken(value: string | null, expected: string) {
  if (!value) return false;
  const actualHash = createHash("sha256").update(value).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function agentRateLimited(key: string) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.started >= WINDOW_MS) {
    buckets.set(key, { started: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LIMIT;
}
