export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  /** Retry only on these error messages (regex) */
  retryOn?: RegExp[];
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryOn: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /EPIPE/, /connection lost/i, /timeout/i],
};

/**
 * Execute an async function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  let lastError: Error | null = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const shouldRetry =
        attempt < opts.maxAttempts &&
        opts.retryOn.some((pattern) => pattern.test(lastError!.message));

      if (!shouldRetry) throw err;

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
