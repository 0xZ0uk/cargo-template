import { createMCPClient } from "@tanstack/ai-mcp";
import type { StreamChunk } from "@tanstack/ai";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { AssistantConversation, AssistantConversationIndex } from "../../src/do";
import type { TurnContext, TurnRunner } from "../../src/conversations/types";
import { createTurnRunner } from "../../src/server/turn";
import { withFakeCost } from "../../src/server/testModel";
import type { AssistantAuditEvent, AssistantAuditSink } from "../../src/audit";

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

/**
 * The real turn runner (`createTurnRunner`, the one `AssistantConversation` uses) with a scripted
 * `fakeText()` model instead of OpenRouter: the script travels in the test's turn body.
 */
const chatTurn: TurnRunner = (context) => {
  const { script, tokensPerSecond } = context.input.body as { script: FakeResponseStep[]; tokensPerSecond?: number };
  return createTurnRunner({
    createAdapter: () => {
      const model = fakeText(tokensPerSecond ? { tokensPerSecond } : {});
      model.setResponses(script);
      // A cost on every call, as OpenRouter reports it (#68: budgets, conversation cost).
      return withFakeCost(model);
    },
  })(context);
};

/** The conversation class with the model swapped: `mode: "chat"` is the real turn, the others are stand-ins. */
/** Audit events the conversation objects reported (read back through `GET /test/audit`). */
const audited: AssistantAuditEvent[] = [];

export class TestConversation extends AssistantConversation<Env> {
  /** The app's override (#68): here a spy instead of `analyticsEngineAuditSink(env.ASSISTANT_AUDIT)`. */
  protected override auditSink(): AssistantAuditSink {
    return (event) => {
      audited.push(event);
    };
  }

  protected override async turnRunner(): Promise<TurnRunner> {
    return (context) => {
      const { mode } = context.input.body;
      return mode === "chat" ? chatTurn(context) : mode === "mcp" ? mcpTurn(context) : slowTurn(context);
    };
  }
}

/** The stand-in's user, with what redaction must hide (#68). */
export const USER = { id: "u1", name: "Ann", email: "ann-secret@example.com", sessions: [{ id: "session-secret" }] };

/** What the stand-in `updateDocument` wrote, per document id (read back through `GET /test/titles`). */
const titles = new Map<string, string>([["1", "Home"]]);

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
    // Like plugin-mcp's: a read tool (runs without asking) and a write tool (needs approval).
    server.registerTool(
      "findDocuments",
      {
        description: "Find documents.",
        inputSchema: fromJsonSchema<{ slug?: string }>({ type: "object", properties: { slug: { type: "string" } } }),
        annotations: { readOnlyHint: true },
      },
      async (args) =>
        args.slug === "users"
          ? // Like plugin-mcp's text: a header, then each document as fenced JSON.
            { content: [{ type: "text", text: `Collection: "users"\n\n\`\`\`json\n${JSON.stringify(USER)}\n\`\`\`` }] }
          : { content: [{ type: "text", text: JSON.stringify({ docs: [...titles].map(([id, title]) => ({ id, title })) }) }] }
    );
    server.registerTool(
      "updateDocument",
      {
        description: "Update a document.",
        inputSchema: fromJsonSchema<{ id: string; title: string }>({
          type: "object",
          properties: { id: { type: "string" }, title: { type: "string" } },
          required: ["id", "title"],
        }),
        annotations: { readOnlyHint: false },
      },
      async (args) => {
        titles.set(args.id, args.title);
        return { content: [{ type: "text", text: "Document updated successfully" }] };
      }
    );
  }
  return server;
});

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/mcp") return mcp.fetch(request);
    if (url.pathname === "/test/titles") return Response.json(Object.fromEntries(titles));
    if (url.pathname === "/test/audit") return Response.json(audited);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
