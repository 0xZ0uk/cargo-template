import { env } from "cloudflare:test";
import { defineAIPersistence } from "@tanstack/ai-persistence";
import { runPersistenceConformance } from "@tanstack/ai-persistence/testkit";
import { conversationPersistence, durableSessionIndexStore } from "../../src/conversations/durableObject";
import type { Env } from "./worker";

const bindings = env as unknown as Env;

// The four chat stores of a conversation object, over RPC into its SQLite. One object per run
// of the suite: the stores key on thread id, so the suite's many threads share it.
runPersistenceConformance(
  "AssistantConversation (Durable Object SQLite, over RPC)",
  () => conversationPersistence(bindings.ASSISTANT_CONVERSATIONS.getByName(`conformance-${crypto.randomUUID()}`)),
  {
    skip: ["activities", "generationRuns", "artifacts", "blobs", "log"],
    checks: ["messages.metadata", "runs.listByThread.state"],
  }
);

// The per-user index, routed to one index object per tenant.
runPersistenceConformance(
  "AssistantConversationIndex (one Durable Object per tenant)",
  () => defineAIPersistence({ stores: { sessions: durableSessionIndexStore(bindings.ASSISTANT_INDEX) } }),
  { skip: ["messages", "activities", "runs", "interrupts", "metadata", "generationRuns", "artifacts", "blobs", "log"] }
);
