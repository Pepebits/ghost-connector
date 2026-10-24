export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return e?.status ?? e?.statusCode ?? e?.response?.status;
}

/**
 * By default: retries 5xx/408/429 and network errors without status (timeouts,
 * DNS, socket). Exception: a `QuotaExhaustedError` (hourly quota exhausted
 * on Unsplash/Pexels) is never retried even if its status is 429 -- a
 * seconds-long backoff does not free a quota that resets in minutes/hours.
 */
function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof Error && err.name === 'QuotaExhaustedError') return false;
  const status = statusOf(err);
  if (status === undefined) return true;
  return status >= 500 || status === 408 || status === 429;
}

/** Exponential backoff with jitter. Used for Ghost (axios) and Unsplash (fetch), which do not retry on their own. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
      await sleep(delay);
    }
  }
  // Unreachable (the last loop iteration always returns or throws).
  throw new Error('withRetry: attempts exhausted');
}
