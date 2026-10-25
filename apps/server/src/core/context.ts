import type { FastifyRequest } from 'fastify';
import type { Scope, Role, Attempt, AttemptItemSnapshot } from '@drill-hub/contracts';
import type { Database } from '../db/database.js';
import type { SecretVault } from './security.js';
export interface Actor {
  id: string;
  userId: string;
  role: Role;
  channel: 'web' | 'mobile' | 'agent' | 'public';
  scopes: Scope[];
  sessionId?: string;
  tokenId?: string;
  /** 内置助手内部令牌执行 drill_hub_api 时的 turn 标识；存在时禁止管理员端点。 */
  assistantTurnId?: string;
}
export interface ServerConfig {
  databasePath: string;
  host: string;
  port: number;
  encryptionKey: string;
  production: boolean;
  publicUrl?: string;
  trustedProxies: string[];
  allowPrivateModelUrls: boolean;
  allowPrivateSearchUrls: boolean;
  accessLogRetentionDays: number;
}
export interface GradingService {
  gradeLockedItem(db: Database, attempt: Attempt, item: AttemptItemSnapshot): Promise<void>;
  runOnce(): Promise<void>;
  start(): void;
  stop(): void;
}
export interface AssistantService {
  /** 立即执行一个已入队的 turn（测试与同步驱动）；生产由内部并发槽调度。 */
  runTurnNow(turnId: string): Promise<void>;
  cancelTurn(ownerId: string, turnId: string): Promise<boolean>;
  /** 管理员变更模型连接/设置后调用，使缓存的 Pi 运行时失效。 */
  invalidateRuntime(): void;
  start(): void;
  stop(): void;
}
export interface AppContext {
  db: Database;
  config: ServerConfig;
  vault: SecretVault;
  grading: GradingService;
  assistant: AssistantService;
  requireUser(request: FastifyRequest): Promise<Actor>;
  requireAdmin(request: FastifyRequest): Promise<Actor>;
  requireAgent(request: FastifyRequest, scope?: Scope): Promise<Actor>;
  audit(
    actor: Actor,
    action: string,
    resourceType: string,
    resourceId: string,
    summary?: Record<string, unknown>,
    db?: Database,
  ): Promise<void>;
}
