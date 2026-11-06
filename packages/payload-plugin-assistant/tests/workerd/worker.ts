import { createMCPClient } from "@tanstack/ai-mcp";
import type { StreamChunk } from "@tanstack/ai";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { AssistantConversation, AssistantConversationIndex } from "../../src/do";
import type { TurnContext, TurnRunner } from "../../src/conversations/types";

export { AssistantConversationIndex };

/** What the stand-in `/api/mcp` accepts, like Payload with `csrf: [ADMIN_ORIGIN]`. */
export const GOOD_COOKIE = "payload-token=good";
export const ADMIN_ORIGIN = "https://admin.example";

export interface Env {
  ASSISTANT_CONVERSATIONS: DurableObjectNamespace<TestConversation>;
  ASSISTANT_INDEX: DurableObjectNamespace<AssistantConversationIndex>;
  ASSISTANT_SELF: Fetcher;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (value: Record<string, unknown>) => ({ timestamp: Date.now(), ...value }) as unknown as StreamChunk;

/** A turn without a model: text deltas with a delay, then the transcript save `withPersistence` would do. */
async function* slowTurn({ input, persistence }: TurnContext): AsyncIterable<StreamChunk> {
  const { threadId, runId } = input;
  const steps = Number(input.body.steps ?? 8);
  const delayMs = Number(input.body.delayMs ?? 40);
  await persistence.stores.runs.createOrResume({ runId, threadId, startedAt: Date.now() });
  yield chunk({ type: "RUN_STARTED", threadId, runId });
  let text = "";
  for (let i = 0; i < steps; i++) {
    await sleep(delayMs);
    text += `part${i} `;
    yield chunk({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: `part${i} ` });
  }
  const history = await persistence.stores.messages.loadThread(threadId);
  await persistence.stores.messages.saveThread(threadId, [
    ...history,
    { role: "user", content: String(input.body.message ?? "hi") },
    { role: "assistant", content: text.trim() },
  ]);
  await persistence.stores.runs.update(runId, { status: "completed", finishedAt: Date.now() });
  yield chunk({ type: "RUN_FINISHED", threadId, runId });
}

/** The transport prototype: a real MCP client over `mcpFetch` (the service binding to this Worker). */
async function* mcpTurn({ input, mcpFetch }: TurnContext): AsyncIterable<StreamChunk> {
  const { threadId, runId } = input;
  yield chunk({ type: "RUN_STARTED", threadId, runId });
  let result: unknown;
  try {
    const client = await createMCPClient({
      // The host is irrelevant to a service binding; the path reaches the Worker's /api/mcp.
      transport: { type: "http", url: `${ADMIN_ORIGIN}/api/mcp`, fetch: mcpFetch },
    });
    const tools = await client.tools();
    const call = await client.callTool("whoami", {});
    result = { tools: tools.map((tool) => tool.name), call };
    await client.close();
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  yield chunk({ type: "CUSTOM", name: "mcp-result", value: result });
  yield chunk({ type: "RUN_FINISHED", threadId, runId });
}

/** The conversation class with a stand-in turn runner (#63 overrides `turnRunner` for real). */
export class TestConversation extends AssistantConversation<Env> {
  protected override async turnRunner(): Promise<TurnRunner> {
    return (context) => (context.input.body.mode === "mcp" ? mcpTurn(context) : slowTurn(context));
  }
}

/**
 * Stand-in for Payload's `POST /api/mcp`: a real MCP server (`@modelcontextprotocol/server`,
 * the SDK plugin-mcp builds on) that, like plugin-mcp, advertises no tools to an unauthenticated
 * request. "Authenticated" = the forwarded cookie, and the Origin Payload's CSRF check would want.
 */
const mcp = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: "stand-in-payload", version: "0.0.0" });
  const cookie = requestInfo?.headers.get("Cookie") ?? "";
  const origin = requestInfo?.headers.get("Origin") ?? "";
  if (cookie === GOOD_COOKIE && origin === ADMIN_ORIGIN) {
    server.registerTool("whoami", { description: "Echo the identity this request carried." }, async () => ({
      content: [{ type: "text", text: JSON.stringify({ cookie, origin }) }],
    }));
  }
  return server;
});

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/mcp") return mcp.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
