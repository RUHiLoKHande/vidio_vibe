export interface ProviderExecutionMetadata {
  primaryProvider: string;
  finalProvider: string;
  fallbackUsed: boolean;
  attempts: number;
  warnings: string[];
}

interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  retryLabel?: string;
}

interface ProviderCandidate<T> extends RetryOptions {
  name: string;
  run: () => Promise<T>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number, label: string = 'provider call'): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function runWithRetries<T>(candidate: ProviderCandidate<T>): Promise<{ value: T; attempts: number }> {
  const retries = candidate.retries ?? 1;
  let attempts = 0;
  let lastError: unknown;

  while (attempts < retries) {
    attempts += 1;
    try {
      const value = await withTimeout(
        candidate.run(),
        candidate.timeoutMs,
        candidate.retryLabel || `${candidate.name} request`
      );
      return { value, attempts };
    } catch (error) {
      lastError = error;
      if (attempts >= retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempts * 500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${candidate.name} failed`);
}

export async function runWithProviderFallback<T>(candidates: ProviderCandidate<T>[]): Promise<{
  value: T;
  metadata: ProviderExecutionMetadata;
}> {
  if (candidates.length === 0) {
    throw new Error('No provider candidates configured');
  }

  const warnings: string[] = [];
  let totalAttempts = 0;
  const primaryProvider = candidates[0].name;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      const { value, attempts } = await runWithRetries(candidate);
      totalAttempts += attempts;
      return {
        value,
        metadata: {
          primaryProvider,
          finalProvider: candidate.name,
          fallbackUsed: index > 0,
          attempts: totalAttempts,
          warnings
        }
      };
    } catch (error: any) {
      totalAttempts += candidate.retries ?? 1;
      warnings.push(`${candidate.name}: ${error?.message || 'unknown error'}`);
      if (index === candidates.length - 1) {
        throw new Error(warnings.join(' | '));
      }
    }
  }

  throw new Error('Provider fallback exhausted');
}
