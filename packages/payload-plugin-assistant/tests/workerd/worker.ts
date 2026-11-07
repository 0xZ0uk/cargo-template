import { createMCPClient } from "@tanstack/ai-mcp";
import type { StreamChunk } from "@tanstack/ai";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { assistantConversation, AssistantConversationIndex } from "../../src/do";
import type { TurnContext, TurnRunner } from "../../src/conversations/types";
import { createTurnRunner } from "../../src/server/turn";
import { lifecycleTurn } from "../lifecycle/runner";
import { withFakeCost } from "../../src/server/testModel";
import type { AssistantAuditEvent } from "../../src/audit";

export { AssistantConversationIndex };

/** What the stand-in `/api/mcp` accepts, like Payload with `csrf: [ADMIN_ORIGIN]`. */
export const GOOD_COOKIE = "payload-token=good";
export const ADMIN_ORIGIN = "https://admin.example";

export interface Env {
  ASSISTANT_CONVERSATIONS: DurableObjectNamespace<TestConversation>;
  ASSISTANT_INDEX: DurableObjectNamespace<AssistantConversationIndex>;
  ASSISTANT_SELF: Fetcher;
}

const chunk = (value: Record<string, unknown>) => ({ timestamp: Date.now(), ...value }) as unknown as StreamChunk;

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
  const { script, tokensPerSecond } = context.input.body as { script?: FakeResponseStep[]; tokensPerSecond?: number };
  // No script: the default adapter, i.e. the plugin's test model when `settings.testModel` is set.
  if (!script) return createTurnRunner()(context);
  return createTurnRunner({
    createAdapter: () => {
      const model = fakeText(tokensPerSecond ? { tokensPerSecond } : {});
      model.setResponses(script);
      // A cost on every call, as OpenRouter reports it (#68: budgets, conversation cost).
      return withFakeCost(model);
    },
  })(context);
};

/** Audit events the conversation objects reported (read back through `GET /test/audit`). */
const audited: AssistantAuditEvent[] = [];

/**
 * The conversation class as the app builds it (`assistantConversation(factory)`), with a spy audit
 * sink instead of `analyticsEngineAuditSink(env.ASSISTANT_AUDIT)` and the model swapped:
 * `mode: "chat"` is the real turn, `"mcp"` the transport prototype, anything else the
 * lifecycle suite's turn (`lifecycleTurn`, plain text deltas).
 */
export const TestConversation = assistantConversation<Env>(() => ({
  audit: (event) => {
    audited.push(event);
  },
  turnRunner: (context) => {
    const { mode } = context.input.body;
    return mode === "chat" ? chatTurn(context) : mode === "mcp" ? mcpTurn(context) : lifecycleTurn(context);
  },
}));
export type TestConversation = InstanceType<typeof TestConversation>;

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
          : args.slug === "authored"
            ? // A page read with depth 1: its author and Payload 4's createdBy populated with the user.
              {
                content: [
                  {
                    type: "text",
                    text: `Document from collection "authored":\n${JSON.stringify({ id: 7, title: "Authored", author: USER, createdBy: { relationTo: "users", value: USER } })}`,
                  },
                ],
              }
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
