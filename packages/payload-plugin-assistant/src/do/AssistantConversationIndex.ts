import { DurableObject } from "cloudflare:workers";
import type { SessionIndexEntry, SessionIndexStore } from "@tanstack/ai-persistence";
import { run, type SqlStorageLike } from "./sql";
import { SESSION_INDEX_SCHEMA, sqlSessionIndexStore } from "./sqlSessions";

export type SessionIndexMethod = keyof SessionIndexStore;
const METHODS = new Set<SessionIndexMethod>(["get", "getVersioned", "upsert", "upsertIf", "list", "delete"]);

/**
 * One user's conversation index: `SessionIndexStore` over this object's SQLite, one object per
 * user (`idFromName(userKey)`). Listing, renaming and deleting stay inside one small object;
 * nothing goes to D1, and no global object becomes a hot spot.
 *
 * Only the Worker and the conversation objects call it; it holds titles and timestamps, never
 * messages.
 */
export class AssistantConversationIndex<Env = unknown> extends DurableObject<Env> {
  private readonly storage: SqlStorageLike;
  private readonly store: SessionIndexStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = { sql: ctx.storage.sql, transactionSync: (fn) => ctx.storage.transactionSync(fn) };
    for (const statement of SESSION_INDEX_SCHEMA) run(this.storage, statement);
    this.store = sqlSessionIndexStore(this.storage);
  }

  /** `SessionIndexStore` over RPC: `call("list", [options])`. */
  async call(method: SessionIndexMethod, args: unknown[]): Promise<unknown> {
    if (!METHODS.has(method)) throw new Error(`Unknown session index method: ${String(method)}`);
    return (this.store[method] as (...a: unknown[]) => Promise<unknown>)(...args);
  }

  /** Bump `updatedAt` after a turn, keeping the rest of the entry. A no-op for an unknown entry. */
  async touch(tenantId: string, threadId: string, updatedAt: number): Promise<void> {
    const current = await this.store.get({ tenantId, threadId });
    if (current) await this.store.upsert({ ...current, updatedAt } satisfies SessionIndexEntry);
  }
}
