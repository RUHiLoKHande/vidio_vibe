type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const CACHE_PREFIX = 'vibeai-cache:';

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readFromStorage<T>(key: string): CacheEntry<T> | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return parsed;
  } catch {
    return null;
  }
}

function writeToStorage<T>(key: string, value: CacheEntry<T>) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Ignore storage quota issues and continue with memory cache only.
  }
}

export function buildAICacheKey(namespace: string, payload: unknown): string {
  return `${namespace}:${hashString(JSON.stringify(payload))}`;
}

export async function withAICache<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const stored = readFromStorage<T>(key);
  if (stored && stored.expiresAt > now) {
    memoryCache.set(key, stored);
    return stored.value;
  }

  const value = await factory();
  const entry: CacheEntry<T> = {
    value,
    expiresAt: now + ttlMs
  };
  memoryCache.set(key, entry);
  writeToStorage(key, entry);
  return value;
}
