import type { Database } from '#server/db/database.js';

type IncrCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

/**
 * 限流计数存入数据库，替换默认的单实例内存实现：
 * 所有实例共享同一份桶，多实例部署下登录/全局限流仍然正确。
 * ttl 与 @fastify/rate-limit 内置 LocalStore 一致，单位毫秒。
 */
export function createDatabaseRateLimitStore(
  db: Database,
): new () => {
  incr: (key: string, callback: IncrCallback, timeWindow: number) => void;
  child: () => unknown;
} {
  return class DatabaseRateLimitStore {
    incr(key: string, callback: IncrCallback, timeWindow: number): void {
      db.incrementRateLimit(key, timeWindow).then(
        ({ count, resetAt }) => {
          const ttl = Math.max(1, Date.parse(resetAt) - Date.now());
          callback(null, { current: count, ttl });
        },
        (error: unknown) => callback(error as Error),
      );
    }
    child() {
      // 全部路由共用同一张表，按 key 区分即可。
      return this;
    }
  };
}
