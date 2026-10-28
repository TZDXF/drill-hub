import type { Database } from '#server/db/database.js';

type IncrCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

interface RateLimitChildOptions {
  url?: string;
  method?: string | string[];
}

/**
 * 限流计数存入数据库，替换默认的单实例内存实现：
 * 所有实例共享同一份桶，多实例部署下登录/全局限流仍然正确。
 * ttl 与 @fastify/rate-limit 内置 LocalStore 一致，单位毫秒。
 * 路由级限流配置经 child() 获得独立键前缀，避免与全局计数互相污染
 * （内置实现同样是每个路由一份独立计数）。
 */
export function createDatabaseRateLimitStore(db: Database): new () => {
  incr: (key: string, callback: IncrCallback, timeWindow: number) => void;
  child: (options: RateLimitChildOptions) => unknown;
} {
  const childIds = new WeakMap<object, string>();
  let nextChildId = 1;
  return class DatabaseRateLimitStore {
    constructor(private readonly keyPrefix = '') {}
    incr(key: string, callback: IncrCallback, timeWindow: number): void {
      db.incrementRateLimit(this.keyPrefix + key, timeWindow).then(
        ({ count, resetAt }) => {
          const ttl = Math.max(1, Date.parse(resetAt) - Date.now());
          callback(null, { current: count, ttl });
        },
        (error: unknown) => callback(error as Error),
      );
    }
    child(options: RateLimitChildOptions): unknown {
      const method = Array.isArray(options.method)
        ? options.method.join('|')
        : (options.method ?? '');
      const known = childIds.get(options);
      if (known !== undefined) return new DatabaseRateLimitStore(`${known}#`);
      const identity = options.url ? `${method} ${options.url}` : `instance-${nextChildId++}`;
      childIds.set(options, identity);
      return new DatabaseRateLimitStore(`${identity}#`);
    }
  };
}
