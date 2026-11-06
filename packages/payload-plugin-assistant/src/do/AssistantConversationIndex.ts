import { DurableObject } from "cloudflare:workers";
import type { SessionIndexEntry, SessionIndexStore } from "@tanstack/ai-persistence";
import { run, type SqlStorageLike } from "./sql";
import type { UsageAmount, UsageSnapshot } from "../usage";
import { SESSION_INDEX_SCHEMA, sqlSessionIndexStore } from "./sqlSessions";
import { addUsage, readUsage, USAGE_SCHEMA } from "./sqlUsage";

export type SessionIndexMethod = keyof SessionIndexStore;
const METHODS = new Set<SessionIndexMethod>(["get", "getVersioned", "upsert", "upsertIf", "list", "delete"]);

/**
 * One user's conversation index: `SessionIndexStore` over this object's SQLite, one object per
 * user (`idFromName(userKey)`). Listing, renaming and deleting stay inside one small object;
 * nothing goes to D1, and no global object becomes a hot spot.
 *
 * Only the Worker and the conversation objects call it; it holds titles, timestamps and usage
 * (#68: the user's daily totals and each conversation's cost), never messages. Being the user's
 * single writer, it is where the budget is counted: `addUsage` is one SQLite transaction, never
 * a read-modify-write in a Worker.
 */
export class AssistantConversationIndex<Env = unknown> extends DurableObject<Env> {
  private readonly storage: SqlStorageLike;
  private readonly store: SessionIndexStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = { sql: ctx.storage.sql, transactionSync: (fn) => ctx.storage.transactionSync(fn) };
    for (const statement of [...SESSION_INDEX_SCHEMA, ...USAGE_SCHEMA]) run(this.storage, statement);
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

  /**
   * Add one model call's usage to the user's UTC `day` and to the conversation's index entry
   * (#68). Called by the conversation object from inside the run.
   */
  async addUsage(tenantId: string, threadId: string | undefined, day: string, amount: UsageAmount): Promise<void> {
    addUsage(this.storage, { tenantId, day, amount, ...(threadId ? { threadId } : {}) });
  }

  /** The user's usage on `day`, plus the conversation's total when `threadId` is given. */
  async usage(tenantId: string, day: string, threadId?: string): Promise<UsageSnapshot> {
    return readUsage(this.storage, { tenantId, day, ...(threadId !== undefined ? { threadId } : {}) });
  }
}
