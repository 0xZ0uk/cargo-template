import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@cargo/payload-plugin-mcp";
import { chat, type StreamChunk } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { createMCPClient } from "@tanstack/ai-mcp";
import { buildConfig, getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssistantNotSignedInError,
  AssistantToolDiscoveryError,
  authHeadersFrom,
  createPayloadToolSource,
  needsApproval,
  payloadToolsMcpOptions,
  payloadToolsSystemPrompt,
  type PayloadToolSource,
  type PayloadToolSourceOptions,
} from "../../src/tools/payloadToolSource";
import { DEFAULT_MAX_TOOL_CALLS, MCP_REQUESTS_PER_RUN, MCP_SETUP_REQUESTS } from "../../src/constants";
import { inProcessDispatch } from "../../src/tools/inProcess";

/**
 * Real Payload 4 on SQLite with plugin-mcp, MCP requests going through Payload's router in
 * process (as on the Worker). `locked` can be read but not written; `hidden` can't be read.
 * plugin-mcp's auth tools are switched on for `users` and `media` is an upload collection, so
 * the tools the assistant drops are really advertised.
 */
const KEY = "assistant-tools";
const ORIGIN = "http://localhost:3000";
const ENDPOINT = `${ORIGIN}/api/mcp`;

let payload: Payload;
let config: SanitizedConfig;
let cookie: string;
let tmpDir: string;
let pageId: number | string;
let lockedId: number | string;
const sources: PayloadToolSource[] = [];

const dispatch = () => inProcessDispatch(config, { payloadInstanceCacheKey: KEY });

/** A tool source as the signed-in editor (cookie auth, like the admin panel). */
const source = (overrides: Partial<PayloadToolSourceOptions> = {}) => {
  const created = createPayloadToolSource({
    endpoint: ENDPOINT,
    headers: authHeadersFrom(
      new Request(`${ORIGIN}/api/assistant/chat`, { method: "POST", headers: { cookie } })
    ),
    dispatch: dispatch(),
    ...overrides,
  });
  sources.push(created);
  return created;
};

const byName = async (s: PayloadToolSource) =>
  new Map((await s.tools()).map((tool) => [tool.name, tool]));

const collect = async (stream: AsyncIterable<StreamChunk>) => {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const findChunk = (chunks: StreamChunk[], type: string) =>
  chunks.filter((c) => (c as { type: string }).type === type) as Array<Record<string, any>>;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-tools-"));
  config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "tools.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      {
        slug: "pages",
        versions: { drafts: true },
        fields: [{ name: "title", type: "text" }],
      },
      {
        slug: "locked",
        access: { read: () => true, create: () => false, update: () => false, delete: () => false },
        fields: [{ name: "title", type: "text" }],
      },
      {
        slug: "hidden",
        access: { read: () => false },
        fields: [{ name: "title", type: "text" }],
      },
      { slug: "media", upload: { staticDir: join(tmpDir, "media") }, fields: [] },
    ],
    plugins: [
      mcpPlugin({
        collections: {
          users: { tools: { auth: true, login: true, forgotPassword: true } },
          pages: {},
          locked: {},
          hidden: {},
          media: {},
        },
      }),
    ],
  });
  payload = await getPayload({ config, key: KEY });
  await payload.create({
    collection: "users" as CollectionSlug,
    data: { email: "editor@example.com", password: "test-password" } as never,
    overrideAccess: true,
  });
  const { token } = await payload.login({
    collection: "users" as never,
    data: { email: "editor@example.com", password: "test-password" },
  });
  cookie = `payload-token=${token}`;
  pageId = (
    await payload.create({
      collection: "pages" as CollectionSlug,
      data: { title: "Home" } as never,
      overrideAccess: true,
    })
  ).id;
  lockedId = (
    await payload.create({
      collection: "locked" as CollectionSlug,
      data: { title: "Untouchable" } as never,
      overrideAccess: true,
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(sources.map((s) => s.close()));
  await (payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("the tool list", () => {
  it("is plugin-mcp's list minus the auth tools and getUploadInstructions", async () => {
    // What plugin-mcp really advertises to this user, with no filter.
    const raw = await createMCPClient({
      transport: {
        type: "http",
        url: ENDPOINT,
        headers: { cookie, origin: ORIGIN },
        fetch: (input, init) => dispatch()(new Request(input, init)),
      },
    });
    const advertised = (await raw.tools()).map((t) => t.name);
    await raw.close();
    expect(advertised).toEqual(
      expect.arrayContaining(["auth", "login", "forgotPassword", "getUploadInstructions"])
    );

    const names = [...(await byName(source())).keys()];
    for (const dropped of ["auth", "login", "forgotPassword", "getUploadInstructions"]) {
      expect(names).not.toContain(dropped);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        "getConfigInfo",
        "findDocuments",
        "countDocuments",
        "getCollectionSchema",
        "createDocuments",
        "updateDocument",
        "deleteDocuments",
      ])
    );
    expect(names.sort()).toEqual(
      advertised
        .filter((n) => !["auth", "login", "forgotPassword", "getUploadInstructions"].includes(n))
        .sort()
    );
  });

  it("applies the plugin's toolFilter on top", async () => {
    const seen: string[] = [];
    const names = [
      ...(
        await byName(
          source({
            toolFilter: (tool) => {
              seen.push(tool.name);
              return !["deleteDocuments", "findDistinct"].includes(tool.name);
            },
          })
        )
      ).keys(),
    ];
    expect(names).not.toContain("deleteDocuments");
    expect(names).not.toContain("findDistinct");
    expect(names).toContain("findDocuments");
    // The built-in filter runs first: toolFilter never sees the auth tools.
    expect(seen).not.toContain("login");
  });
});

describe("approval", () => {
  it("is required for write tools and not for read tools, from plugin-mcp's annotations", async () => {
    const tools = await byName(source());
    for (const name of ["createDocuments", "updateDocument", "deleteDocuments"]) {
      expect(Boolean(tools.get(name)?.needsApproval), name).toBe(true);
    }
    for (const name of ["findDocuments", "countDocuments", "getConfigInfo", "getCollectionSchema"]) {
      expect(Boolean(tools.get(name)?.needsApproval), name).toBe(false);
    }
    // And every tool follows the rule, whatever plugin-mcp adds.
    for (const tool of tools.values()) {
      expect(Boolean(tool.needsApproval), tool.name).toBe(
        tool.metadata.mcp.annotations?.readOnlyHint !== true
      );
    }
  });

  it("is required for a tool without annotations", () => {
    expect(needsApproval({})).toBe(true);
    expect(needsApproval({ annotations: { readOnlyHint: false } })).toBe(true);
    expect(needsApproval({ annotations: { readOnlyHint: true } })).toBe(false);
  });
});

describe("calls run as the user", () => {
  it("reads what the user can read", async () => {
    const find = (await byName(source())).get("findDocuments")!;
    const result = await find.execute!(
      { slug: "pages", select: { title: true }, limit: 5, depth: 0 },
      undefined as never
    );
    expect(JSON.stringify(result)).toContain("Home");
  });

  it("a write the user isn't allowed returns a tool error and changes nothing", async () => {
    const update = (await byName(source())).get("updateDocument")!;
    await expect(
      update.execute!(
        { slug: "locked", id: String(lockedId), data: { title: "Changed" } },
        undefined as never
      )
    ).rejects.toThrow(/MCP tool "updateDocument" returned an error: .*locked/);
    const doc = await payload.findByID({
      collection: "locked" as CollectionSlug,
      id: lockedId,
      overrideAccess: true,
    });
    expect((doc as { title?: string }).title).toBe("Untouchable");
  });
});

describe("discovery failures", () => {
  it("not signed in: a clear error, not an empty tool list", async () => {
    await expect(source({ headers: { origin: ORIGIN } }).tools()).rejects.toBeInstanceOf(
      AssistantNotSignedInError
    );
    await expect(
      source({ headers: { cookie: "payload-token=expired", origin: ORIGIN } }).tools()
    ).rejects.toThrow(/not signed in/);
  });

  it("the endpoint failing: a clear error", async () => {
    const failing = source({
      dispatch: async () => new Response("upstream exploded", { status: 500 }),
    });
    await expect(failing.tools()).rejects.toBeInstanceOf(AssistantToolDiscoveryError);
    const unreachable = source({
      dispatch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(unreachable.tools()).rejects.toThrow(/could not list Payload's tools/);
  });

  it("fails the chat run instead of running with no tools", async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: "I have no tools, but here is an answer anyway." }]);
    const failing = source({ headers: { origin: ORIGIN } });
    const run = collect(
      chat({
        adapter,
        threadId: "t-discovery",
        messages: [{ role: "user", content: "List the pages" }],
        mcp: payloadToolsMcpOptions(failing),
      }) as AsyncIterable<StreamChunk>
    );
    const outcome = await run.then(
      (chunks) => ({ chunks, error: undefined as unknown }),
      (error: unknown) => ({ chunks: [] as StreamChunk[], error })
    );
    const message =
      outcome.error instanceof Error
        ? outcome.error.message
        : findChunk(outcome.chunks, "RUN_ERROR")[0]?.error?.message ??
          findChunk(outcome.chunks, "RUN_ERROR")[0]?.message;
    expect(message).toMatch(/not signed in/);
    expect(adapter.state.callCount).toBe(0);
  });
});

describe("in chat()", () => {
  it("runs a read tool without asking", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        toolCalls: [
          {
            name: "findDocuments",
            input: { slug: "pages", select: { title: true }, limit: 5, depth: 0 },
          },
        ],
      },
      { text: "There is one page: Home." },
    ]);
    const chunks = await collect(
      chat({
        adapter,
        threadId: "t-read",
        systemPrompts: [payloadToolsSystemPrompt()],
        messages: [{ role: "user", content: "List the pages" }],
        mcp: payloadToolsMcpOptions(source()),
      }) as AsyncIterable<StreamChunk>
    );
    const results = findChunk(chunks, "TOOL_CALL_RESULT");
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain("Home");
    expect(findChunk(chunks, "RUN_FINISHED").at(-1)?.outcome?.type).not.toBe("interrupt");
    expect(adapter.state.callCount).toBe(2);
  });

  it("shows an access denial to the model as a tool error", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      { toolCalls: [{ name: "findDocuments", input: { slug: "hidden", limit: 5 } }] },
      ({ request }) => {
        const toolMessage = request.messages.find((m) => m.role === "tool");
        return { text: `Tool said: ${JSON.stringify(toolMessage?.content)}` };
      },
    ]);
    const chunks = await collect(
      chat({
        adapter,
        threadId: "t-denied",
        messages: [{ role: "user", content: "What is in hidden?" }],
        mcp: payloadToolsMcpOptions(source()),
      }) as AsyncIterable<StreamChunk>
    );
    const text = findChunk(chunks, "TEXT_MESSAGE_CONTENT")
      .map((c) => c.delta)
      .join("");
    expect(text).toMatch(/hidden/);
    expect(text).toMatch(/error/i);
    // Once: an access error is not retried.
    expect(adapter.state.callCount).toBe(2);
  });

  it("pauses a write tool with an approval interrupt and changes nothing", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        toolCalls: [
          {
            name: "updateDocument",
            input: { slug: "pages", id: String(pageId), draft: true, data: { title: "Renamed" } },
          },
        ],
      },
      { text: "Done." },
    ]);
    const chunks = await collect(
      chat({
        adapter,
        threadId: "t-write",
        messages: [{ role: "user", content: "Rename the home page" }],
        mcp: payloadToolsMcpOptions(source()),
      }) as AsyncIterable<StreamChunk>
    );
    const outcome = findChunk(chunks, "RUN_FINISHED").at(-1)?.outcome;
    expect(outcome?.type).toBe("interrupt");
    expect(outcome?.interrupts).toHaveLength(1);
    expect(outcome?.interrupts[0].metadata).toMatchObject({
      kind: "approval",
      toolName: "updateDocument",
      input: { slug: "pages", data: { title: "Renamed" } },
    });
    expect(findChunk(chunks, "TOOL_CALL_RESULT")).toHaveLength(0);
    const page = await payload.findByID({
      collection: "pages" as CollectionSlug,
      id: pageId,
      draft: true,
      overrideAccess: true,
    });
    expect((page as { title?: string }).title).toBe("Home");
  });
});

describe("Cloudflare's Worker invocation limit (#116)", () => {
  /** A dispatcher that records each MCP request (`POST <JSON-RPC method>`) before sending it. */
  const counting = () => {
    const seen: string[] = [];
    const inner = dispatch();
    const fetch = async (request: Request) => {
      const body = request.method === "POST" ? await request.clone().text() : "";
      seen.push(`${request.method} ${/"method":"([^"]+)"/.exec(body)?.[1] ?? ""}`.trim());
      return inner(request);
    };
    return { seen, fetch };
  };
  const toolResults = (chunks: StreamChunk[]) => findChunk(chunks, "TOOL_CALL_RESULT").map((c) => String(c.content));

  it("one MCP session per run: 3 requests to connect, then one per tool call, none to close", async () => {
    const { seen, fetch } = counting();
    const adapter = fakeText();
    adapter.setResponses([
      { toolCalls: [{ name: "findDocuments", input: { slug: "pages", limit: 1, depth: 0 } }, { name: "countDocuments", input: { slug: "pages" } }] },
      { toolCalls: [{ name: "getConfigInfo", input: {} }] },
      { text: "Done." },
    ]);
    await collect(
      chat({ adapter, threadId: "t-session", messages: [{ role: "user", content: "Look around" }], mcp: payloadToolsMcpOptions(source({ dispatch: fetch })) }) as AsyncIterable<StreamChunk>
    );
    expect(seen).toEqual(["POST server/discover", "POST subscriptions/listen", "POST tools/list", "POST tools/call", "POST tools/call", "POST tools/call"]);
    expect(MCP_SETUP_REQUESTS).toBe(3);
    // The defaults fit: the Worker, the Durable Object, the setup and every allowed tool call.
    expect(2 + MCP_SETUP_REQUESTS + DEFAULT_MAX_TOOL_CALLS).toBeLessThanOrEqual(MCP_REQUESTS_PER_RUN + 2);
    expect(MCP_REQUESTS_PER_RUN + 2).toBeLessThan(32);
  });

  it("past maxToolCalls a call sends nothing and tells the model to stop and answer", async () => {
    const { seen, fetch } = counting();
    const adapter = fakeText();
    let toolMessages: unknown[] = [];
    adapter.setResponses([
      // Three parallel calls in one step, then one more in the next: only the first two run.
      { toolCalls: [0, 1, 2].map(() => ({ name: "countDocuments", input: { slug: "pages" } })) },
      { toolCalls: [{ name: "getConfigInfo", input: {} }] },
      ({ request }) => {
        toolMessages = request.messages.filter((m) => m.role === "tool").map((m) => m.content);
        return { text: "Here is what I found." };
      },
    ]);
    const chunks = await collect(
      chat({ adapter, threadId: "t-cap", messages: [{ role: "user", content: "Count" }], mcp: payloadToolsMcpOptions(source({ dispatch: fetch, maxToolCalls: 2 })) }) as AsyncIterable<StreamChunk>
    );
    expect(seen.filter((r) => r === "POST tools/call")).toHaveLength(2);
    const results = toolResults(chunks);
    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.includes("Tool call limit reached"))).toHaveLength(2);
    expect(JSON.stringify(toolMessages)).toContain("Do not call any more tools in this turn");
    expect(findChunk(chunks, "TEXT_MESSAGE_CONTENT").map((c) => c.delta).join("")).toBe("Here is what I found.");
  });

  it("maxRequests is a backstop on every MCP request, connecting included", async () => {
    const { seen, fetch } = counting();
    const adapter = fakeText();
    adapter.setResponses([
      { toolCalls: [{ name: "countDocuments", input: { slug: "pages" } }] },
      { toolCalls: [{ name: "countDocuments", input: { slug: "pages" } }] },
      { text: "Stopped calling tools." },
    ]);
    const chunks = await collect(
      chat({ adapter, threadId: "t-budget", messages: [{ role: "user", content: "Count twice" }], mcp: payloadToolsMcpOptions(source({ dispatch: fetch, maxRequests: 4 })) }) as AsyncIterable<StreamChunk>
    );
    expect(seen).toHaveLength(4); // connect (3) + the first call
    const results = toolResults(chunks);
    expect(results[1]).toContain("limit of 4 requests");
  });
});

describe("authHeadersFrom", () => {
  it("forwards Cookie, Authorization and Origin, defaulting Origin to the request's", () => {
    const headers = authHeadersFrom(
      new Request("https://cms.example/api/assistant/chat", {
        headers: { cookie: "payload-token=x", authorization: "JWT y", "x-other": "no" },
      })
    );
    expect(headers).toEqual({
      cookie: "payload-token=x",
      authorization: "JWT y",
      origin: "https://cms.example",
    });
  });

  it("keeps the admin request's own Origin", () => {
    const headers = authHeadersFrom(
      new Request("https://internal.example/api/assistant/chat", {
        headers: { origin: "https://cms.example" },
      })
    );
    expect(headers.origin).toBe("https://cms.example");
  });
});
