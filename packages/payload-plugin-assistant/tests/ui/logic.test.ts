import { describe, expect, it } from "vitest";
import { pendingApprovalFrom } from "../../src/ui/ApprovalControl";
import { recorded } from "../fixtures/pluginMcp";
import { assistantUrl, chatUrl, isValidThreadId, newThreadId, readApiError, recordingFetch } from "../../src/ui/api";
import { noticeForClientError, noticeForHttpError, noticeForRunError } from "../../src/ui/errors";
import { adminPathOf, withInternalLinksAsAdminPaths } from "../../src/ui/MessageView";
import {
  documentRefs,
  formatToolResult,
  MAX_DOCUMENT_LINKS,
  toolStatus,
  toolTarget,
} from "../../src/ui/tools";

const slugs = { collections: new Set(["pages", "media"]), globals: new Set(["header"]) };

/** plugin-mcp's answer shape: text with the data in a fenced JSON block. */
const fenced = (summary: string, data: unknown) => `${summary}\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;

describe("error mapping", () => {
  it.each([
    ["stopped", "stopped", "default"],
    ["openrouter_invalid_key", "invalid_key", "danger"],
    ["openrouter_out_of_credits", "out_of_credits", "danger"],
    ["openrouter_rate_limited", "rate_limited", "warning"],
    ["model_unavailable", "model_unavailable", "danger"],
    ["context_overflow", "context_overflow", "warning"],
    ["not_signed_in", "not_signed_in", "danger"],
    ["tools_unavailable", "tools_unavailable", "warning"],
    ["run_failed", "failed", "danger"],
  ])("RUN_ERROR %s → %s", (code, kind, type) => {
    expect(noticeForRunError(code)).toMatchObject({ kind, type });
  });

  it("keeps the server's message for an unknown run error code", () => {
    expect(noticeForRunError("brand_new", "The thing broke.")).toEqual({
      kind: "failed",
      type: "danger",
      message: "The thing broke.",
    });
  });

  it.each([
    [503, "not_configured", "not_configured"],
    [429, "rate_limited", "rate_limited"],
    [400, "model_not_allowed", "model_unavailable"],
    [400, "invalid_body", "invalid_request"],
    [401, "unauthorized", "not_signed_in"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [502, "tools_unavailable", "tools_unavailable"],
    [402, "budget_exceeded", "budget_exceeded"],
  ])("HTTP %i %s → %s", (status, code, kind) => {
    expect(noticeForHttpError(status, code).kind).toBe(kind);
  });

  it("falls back to the status when the body has no code", () => {
    expect(noticeForHttpError(503).kind).toBe("not_configured");
    expect(noticeForHttpError(500).kind).toBe("failed");
  });

  it("names the missing key without echoing any value", () => {
    expect(noticeForHttpError(503, "not_configured").message).toMatch(/OPENROUTER_API_KEY/);
  });

  it("reads the code of a StreamHttpError from the recorded body of the same status", () => {
    const streamHttpError = Object.assign(new Error("HTTP error! status: 429"), { status: 429 });
    expect(noticeForClientError(streamHttpError, { status: 429, code: "rate_limited" }).kind).toBe("rate_limited");
    // A recorded body from another request (other status) is not used.
    expect(noticeForClientError(streamHttpError, { status: 503, code: "not_configured" }).kind).toBe("rate_limited");
    expect(noticeForClientError(new Error("socket hang up"))).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("socket hang up"),
    });
  });
});

describe("endpoint helpers", () => {
  it("builds the documented URLs", () => {
    expect(assistantUrl("/api", "/config")).toBe("/api/assistant/config");
    expect(assistantUrl("/cms-api/", "/chat/stop")).toBe("/cms-api/assistant/chat/stop");
    expect(chatUrl("/api", "thread_a:b")).toBe("/api/assistant/chat?threadId=thread_a%3Ab");
  });

  it("makes thread ids the endpoint accepts", () => {
    const id = newThreadId();
    expect(isValidThreadId(id)).toBe(true);
    expect(newThreadId()).not.toBe(id);
    expect(isValidThreadId("../etc")).toBe(false);
    expect(isValidThreadId(null)).toBe(false);
  });

  it("reads { error, code } from a failed response, and survives a non-JSON body", async () => {
    const json = await readApiError(
      Response.json({ error: "not configured", code: "not_configured" }, { status: 503 })
    );
    expect(json).toMatchObject({ status: 503, code: "not_configured", message: "not configured" });
    const html = await readApiError(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(html).toMatchObject({ status: 502, code: undefined });
  });

  it("recordingFetch remembers the last failure's code and leaves the response readable", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 })) as typeof fetch;
    try {
      const recorder = recordingFetch();
      const response = await recorder.fetch("/api/assistant/chat", { method: "POST" });
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "rate_limited" });
      expect(recorder.lastError()).toMatchObject({ status: 429, code: "rate_limited" });
      recorder.reset();
      expect(recorder.lastError()).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("tool calls", () => {
  it("reads the target collection from the (possibly still streaming) input", () => {
    expect(toolTarget({ id: "1", name: "findDocuments", input: { slug: "pages" } })).toBe("pages");
    expect(toolTarget({ id: "1", name: "findDocuments", arguments: '{"slug":"media"}' })).toBe("media");
    expect(toolTarget({ id: "1", name: "findDocuments", arguments: '{"slu' })).toBeUndefined();
  });

  it("derives a status from the call and its result", () => {
    const call = { id: "c", name: "updateDocument", state: "input-complete" };
    expect(toolStatus(call)).toBe("running");
    expect(toolStatus({ ...call, state: "approval-requested" })).toBe("awaiting-approval");
    expect(toolStatus(call, { toolCallId: "c", content: fenced("Updated.", { id: 1 }), state: "complete" })).toBe(
      "done"
    );
    expect(
      toolStatus(call, {
        toolCallId: "c",
        content: '{"error":"User declined tool execution"}',
        state: "error",
        outcome: "denied",
      })
    ).toBe("denied");
    // An approved call that the collection's access then refuses: a result, not a failed run.
    expect(
      toolStatus(call, {
        toolCallId: "c",
        content: '{"error":"MCP access to \\"updateDocument\\" is not enabled"}',
        state: "complete",
      })
    ).toBe("error");
  });

  it("links the documents a tool returned or touched, only in known collections", () => {
    const created = documentRefs(
      { id: "c", name: "createDocuments", input: { slug: "pages" } },
      {
        toolCallId: "c",
        content: fenced("Created 1 of 1 documents.", {
          docs: [{ doc: { id: 2, title: "Pricing" }, index: 0 }],
          errors: [],
        }),
      },
      slugs
    );
    expect(created).toEqual([{ kind: "collection", slug: "pages", id: "2", label: "Pricing" }]);

    const updated = documentRefs(
      { id: "u", name: "updateDocument", input: { slug: "pages", id: 7 } },
      undefined,
      slugs
    );
    expect(updated).toEqual([{ kind: "collection", slug: "pages", id: "7", label: "7" }]);

    // A slug the admin doesn't know (or that the model made up) is never linked.
    expect(
      documentRefs(
        { id: "x", name: "findDocuments", input: { slug: "secrets" } },
        { toolCallId: "x", content: '{"docs":[{"id":1}]}' },
        slugs
      )
    ).toEqual([]);

    expect(documentRefs({ id: "g", name: "findGlobal", input: { slug: "header" } }, undefined, slugs)).toEqual([
      { kind: "global", slug: "header", label: "header" },
    ]);
  });

  it("links every document of a recorded findDocuments page; a versions read links no version as a document", () => {
    const page = recorded("find, a page");
    expect(documentRefs({ id: "f", name: page.name, input: page.args }, { toolCallId: "f", content: page.result }, slugs)).toEqual([
      { kind: "collection", slug: "pages", id: "2", label: "About" },
      { kind: "collection", slug: "pages", id: "1", label: "Home" },
    ]);
    for (const label of ["find versions", "find a version"]) {
      const call = recorded(label);
      expect(documentRefs({ id: "v", name: call.name, input: call.args }, { toolCallId: "v", content: call.result }, slugs), label).toEqual([]);
    }
    // A restore links the restored document, not the version its `id` names.
    const restore = recorded("restore a version");
    expect(
      documentRefs({ id: "r", name: restore.name, input: { ...restore.args, id: "v9" } }, { toolCallId: "r", content: restore.result }, slugs)
    ).toEqual([{ kind: "collection", slug: "pages", id: "1", label: "Home" }]);
  });

  it("the target is plugin-mcp's slug argument, the same rule as the server's", () => {
    expect(toolTarget({ id: "1", name: "findDocuments", input: { collection: "pages" } })).toBeUndefined();
  });

  it("never links the documents of a delete: they no longer exist", () => {
    for (const name of ["deleteDocuments"]) {
      expect(
        documentRefs(
          { id: "d", name, input: { slug: "pages", id: 7 } },
          { toolCallId: "d", content: fenced('Document deleted successfully from collection "pages"!', { id: 7, title: "Old" }) },
          slugs
        )
      ).toEqual([]);
    }
  });

  it("caps the links and skips failed calls' results", () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
    expect(
      documentRefs(
        { id: "f", name: "findDocuments", input: { slug: "pages" } },
        { toolCallId: "f", content: JSON.stringify({ docs }) },
        slugs
      )
    ).toHaveLength(MAX_DOCUMENT_LINKS);
    expect(
      documentRefs(
        { id: "f", name: "findDocuments", input: { slug: "pages" } },
        { toolCallId: "f", content: '{"docs":[{"id":1}]}', outcome: "denied", state: "error" },
        slugs
      )
    ).toEqual([]);
  });

  it("pretty-prints and truncates results", () => {
    expect(formatToolResult('{"a":1}').text).toBe('{\n  "a": 1\n}');
    const long = formatToolResult("x".repeat(10_000), 100);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThan(110);
    expect(formatToolResult([{ type: "text", text: "Hello" }]).text).toBe("Hello");
  });
});

describe("admin links in model text", () => {
  it("keeps admin paths and same-origin admin URLs in the admin, nothing else", () => {
    expect(adminPathOf("/admin/collections/pages/1", "/admin", "https://cms.test")).toBe("/admin/collections/pages/1");
    expect(adminPathOf("https://cms.test/admin/collections/pages/1?x=1", "/admin", "https://cms.test")).toBe(
      "/admin/collections/pages/1?x=1"
    );
    expect(adminPathOf("https://evil.test/admin/collections/pages/1", "/admin", "https://cms.test")).toBeUndefined();
    expect(adminPathOf("//evil.test/admin", "/admin", "https://cms.test")).toBeUndefined();
    expect(adminPathOf("/pricing", "/admin", "https://cms.test")).toBeUndefined();
    expect(adminPathOf("/administrator", "/admin", "https://cms.test")).toBeUndefined();
    // An internal link copied from rich text (#116) opens the document's edit view.
    expect(withInternalLinksAsAdminPaths("[A](payload://pages/12) and [B](payload://posts/ab-1)", "/admin")).toBe(
      "[A](/admin/collections/pages/12) and [B](/admin/collections/posts/ab-1)"
    );
    expect(withInternalLinksAsAdminPaths("[A](payload://pages/12)", "/")).toBe("[A](/collections/pages/12)");
    expect(withInternalLinksAsAdminPaths("[A](payload://pages/1/../x) payload://pages/3", "/admin")).toBe("[A](payload://pages/1/../x) payload://pages/3");
  });
});

describe("approvals", () => {
  const input = { slug: "pages", draft: true, documents: [{ data: { title: "Hello" } }] };

  it("answers a generic-bound approval (the browser has no tool definitions) with { approved }", () => {
    const answers: unknown[] = [];
    const approval = pendingApprovalFrom({
      id: "approval_call_1",
      kind: "generic",
      toolCallId: "call_1",
      status: "pending",
      canResolve: true,
      metadata: { kind: "approval", toolName: "createDocuments", input },
      resolveInterrupt: (answer: unknown) => answers.push(answer),
    })!;
    expect(approval).toMatchObject({
      id: "approval_call_1",
      toolName: "createDocuments",
      target: "pages",
      input,
      canAnswer: true,
    });
    approval.approve();
    approval.reject();
    expect(answers).toEqual([{ approved: true }, { approved: false }]);
  });

  it("finds the tool call of a generic snapshot (which has no toolCallId) in its binding; a reject carries the reason", () => {
    const answers: unknown[] = [];
    // The shape @tanstack/ai-client gives a generic interrupt: the descriptor's toolCallId is dropped.
    const approval = pendingApprovalFrom({
      id: "approval_call_9",
      kind: "generic",
      status: "pending",
      canResolve: true,
      metadata: { kind: "approval", toolName: "updateDocument", input, "tanstack:interruptBinding": { kind: "tool-approval", toolCallId: "call_9" } },
      resolveInterrupt: (answer: unknown) => answers.push(answer),
    })!;
    expect(approval.toolCallId).toBe("call_9");
    approval.reject("Not now");
    expect(answers).toEqual([{ approved: false, reason: "Not now" }]);
  });

  it("answers a tool-approval-bound interrupt with a boolean", () => {
    const answers: unknown[] = [];
    const approval = pendingApprovalFrom({
      id: "a",
      kind: "tool-approval",
      toolName: "updateDocument",
      toolCallId: "c",
      originalArgs: { slug: "pages", id: 1 },
      status: "pending",
      resolveInterrupt: (answer: unknown) => answers.push(answer),
    })!;
    approval.approve();
    expect(answers).toEqual([true]);
    expect(approval.target).toBe("pages");
  });

  it("ignores interrupts that aren't approvals, and can't be answered while submitting", () => {
    expect(pendingApprovalFrom({ kind: "unbound", id: "u" })).toBeNull();
    expect(
      pendingApprovalFrom({ kind: "generic", id: "g", metadata: { kind: "question" }, resolveInterrupt: () => {} })
    ).toBeNull();
    const submitting = pendingApprovalFrom({
      kind: "generic",
      id: "g",
      status: "submitting",
      metadata: { kind: "approval" },
      resolveInterrupt: () => {},
    });
    expect(submitting?.canAnswer).toBe(false);
  });
});
