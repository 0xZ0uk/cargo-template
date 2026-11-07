import type { SessionIndexStore } from "@tanstack/ai-persistence";
import type { UsageSnapshot } from "../usage";
import type { ConversationCaps } from "./caps";
import type { ClaimInput } from "./storage";
import type { ClaimResult, ConversationBackend, ConversationTranscript, TurnInput } from "./types";

/**
 * One conversation as the backend reaches it: a `Conversation` in this process (Node), or the
 * conversation's Durable Object over RPC (Workers). Each method checks ownership on its side.
 */
export interface ConversationHandle {
  claim(input: ClaimInput): Promise<ClaimResult>;
  transcript(userKey: string): Promise<ConversationTranscript | null>;
  /** Start a turn in a conversation already claimed by `input.userKey`. */
  startTurn(input: TurnInput): Promise<Response>;
  join(userKey: string, request: Request): Promise<Response>;
  stop(userKey: string, runId: string): Promise<boolean>;
  hydrate(userKey: string, request: Request): Promise<Response>;
  destroy(userKey: string): Promise<boolean>;
}

export interface BackendOverOptions {
  /** The handle of one conversation. */
  open(threadId: string): ConversationHandle;
  /** The owners' conversation lists (`tenantId` = user key). */
  sessions: SessionIndexStore;
  /** The user's usage on `day`, and the conversation's total from its entry when `threadId` is given. */
  usage(userKey: string, day: string, threadId?: string): Promise<UsageSnapshot>;
  /** Idle time before a conversation is deleted, and its size limits: stored on each claim. */
  retentionMs: number;
  caps: Partial<ConversationCaps>;
  /** Runs before every call (Node's lazy retention sweep). */
  beforeEach?: () => Promise<void>;
}

/**
 * The endpoint's `ConversationBackend` over conversation handles and the owners' index: the part
 * both storages share, written once (claim then start, the list, rename, usage).
 */
export function backendOver(options: BackendOverOptions): ConversationBackend {
  const { open, sessions, retentionMs, caps } = options;
  const ready = options.beforeEach ?? (async () => {});
  const claim = async (userKey: string, threadId: string, title?: string) => {
    await ready();
    return open(threadId).claim({ threadId, userKey, retentionMs, caps, ...(title ? { title } : {}) });
  };

  return {
    claim,
    async transcript(userKey, threadId) {
      await ready();
      return open(threadId).transcript(userKey);
    },
    async startTurn(input) {
      const claimed = await claim(input.userKey, input.threadId, input.title);
      if (!claimed.ok) return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
      return open(input.threadId).startTurn(input);
    },
    async join(userKey, threadId, request) {
      await ready();
      return open(threadId).join(userKey, request);
    },
    async stop(userKey, threadId, runId) {
      await ready();
      return open(threadId).stop(userKey, runId);
    },
    async hydrate(userKey, threadId, request) {
      await ready();
      return open(threadId).hydrate(userKey, request);
    },
    async list(userKey, listOptions = {}) {
      await ready();
      return sessions.list({ ...listOptions, tenantId: userKey, memberId: userKey, parentThreadId: null });
    },
    /**
     * Only the owner's entry, read and written with its revision, so a usage write racing the
     * rename isn't overwritten (the rename retries instead).
     */
    async rename(userKey, threadId, title) {
      await ready();
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await sessions.getVersioned({ tenantId: userKey, threadId });
        if (!current || !current.entry.members.some((m) => m.userId === userKey && m.role === "owner")) return false;
        const result = await sessions.upsertIf({
          entry: { ...current.entry, title, updatedAt: Date.now() },
          revision: current.revision,
        });
        if (result.ok) return true;
      }
      throw new Error("[payload-plugin-assistant] rename lost three write races in a row");
    },
    // The conversation checks the owner, deletes its data and its index entry.
    async remove(userKey, threadId) {
      await ready();
      return open(threadId).destroy(userKey);
    },
    // The user's own index: their day, and the conversation's total from its entry there
    // (another user's conversation has no entry under this user, so it reads `null`).
    async usage(userKey, day, threadId) {
      await ready();
      return options.usage(userKey, day, threadId);
    },
  };
}
