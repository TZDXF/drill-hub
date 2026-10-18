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
}
export interface ServerConfig {
  databasePath: string;
  host: string;
  port: number;
  encryptionKey: string;
  production: boolean;
  publicUrl?: string;
}
export interface GradingService {
  gradeLockedItem(db: Database, attempt: Attempt, item: AttemptItemSnapshot): Promise<void>;
  runOnce(): Promise<void>;
  start(): void;
  stop(): void;
}
export interface AppContext {
  db: Database;
  config: ServerConfig;
  vault: SecretVault;
  grading: GradingService;
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
