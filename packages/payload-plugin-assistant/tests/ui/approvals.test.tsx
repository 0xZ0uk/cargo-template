// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", async () => (await import("./payloadUiStub")).payloadUiStub);

/**
 * A stand-in for `useChat`: a store the test drives (messages, interrupts, resuming), with the
 * real connection options captured so the chat's own `recordingFetch` sees the HTTP errors.
 */
const fakeChat = vi.hoisted(() => {
  type State = {
    messages: Array<Record<string, unknown>>;
    interrupts: Array<Record<string, unknown>>;
    resuming: boolean;
    isLoading: boolean;
  };
  const listeners = new Set<() => void>();
  let version = 0;
  const store = {
    state: { messages: [], interrupts: [], resuming: false, isLoading: false } as State,
    options: undefined as undefined | (() => { fetchClient: typeof fetch }),
    resolved: [] as Array<{ id: string; payload: unknown }>[],
    set(patch: Partial<State>) {
      store.state = { ...store.state, ...patch };
      version += 1;
      for (const l of listeners) l();
    },
    reset() {
      store.state = { messages: [], interrupts: [], resuming: false, isLoading: false };
      store.resolved = [];
      version += 1;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
  return store;
});

vi.mock("@tanstack/ai-react", () => ({
  fetchServerSentEvents: (_url: string, options: () => { fetchClient: typeof fetch }) => {
    fakeChat.options = options;
    return {};
  },
  useChat: () => {
    useSyncExternalStore(fakeChat.subscribe, fakeChat.version);
    const s = fakeChat.state;
    return {
      ...s,
      isHydrating: false,
      error: undefined,
      interruptErrors: [],
      setMessages: (messages: Array<Record<string, unknown>>) => fakeChat.set({ messages: [...messages] }),
      stop: () => {},
      // Like @tanstack/ai-client: the message is added before the request; a refused request
      // leaves it there.
      sendMessage: async (text: string) => {
        fakeChat.set({ messages: [...fakeChat.state.messages, { id: `u${Date.now()}`, role: "user", parts: [{ type: "text", content: text }] }] });
        await fakeChat.options!().fetchClient("/api/assistant/chat?threadId=t", { method: "POST" });
      },
      resolveInterrupts: (resolver: (interrupt: unknown) => void) => {
        const batch: Array<{ id: string; payload: unknown }> = [];
        for (const interrupt of fakeChat.state.interrupts) {
          resolver({ ...interrupt, resolveInterrupt: (payload: unknown) => batch.push({ id: String(interrupt.id), payload }) });
        }
        fakeChat.resolved.push(batch);
        fakeChat.set({ resuming: true });
      },
    };
  },
}));

import { ApprovalCard } from "../../src/ui/approvals/ApprovalCard";
import type { PendingApproval } from "../../src/ui/ApprovalControl";
import type { ApprovalProposal } from "../../src/approvals/types";
import { ChatPanel } from "../../src/ui/ChatPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const proposal = (over: Partial<ApprovalProposal> = {}): ApprovalProposal => ({
  interruptId: "i1",
  toolCallId: "c1",
  toolName: "updateDocument",
  action: "update",
  target: { kind: "collection", slug: "pages", label: "Page" },
  draft: true,
  items: [
    {
      document: { id: "7", title: "Home", updatedAt: "2026-11-01T00:00:00.000Z", status: "draft" },
      changes: [
        { path: "title", label: "Title", kind: "changed", format: "text", before: "Home", after: "Welcome" },
        { path: "content", label: "Content", kind: "changed", format: "richText", before: "Old intro.", after: "# New\n\nNew intro." },
      ],
    },
  ],
  ...over,
});

const approval = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  id: "i1",
  toolName: "updateDocument",
  toolCallId: "c1",
  input: { slug: "pages", id: "7", data: { title: "Welcome" } },
  target: "pages",
  canAnswer: true,
  approve: vi.fn(),
  reject: vi.fn(),
  status: "pending",
  proposal: proposal(),
  documentHref: (id) => `/admin/collections/pages/${id}`,
  ...over,
});

describe("approval card", () => {
  it("shows the action, the document linked to its edit view, and the diff with rich text as text", () => {
    const { container } = render(<ApprovalCard approval={approval()} />);
    expect(screen.getByRole("heading", { name: "Update Page" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/admin/collections/pages/7");
    const title = container.querySelector('[data-kind="changed"]')!;
    expect(within(title as HTMLElement).getByText("Home")).toBeTruthy();
    expect(within(title as HTMLElement).getByText("Welcome")).toBeTruthy();
    expect(container.textContent).toContain("# New\n\nNew intro.");
    expect(container.textContent).toContain("rich text");
    expect(container.textContent).not.toMatch(/"root"|"children"/);
    // Long values scroll instead of being cut: each value is a focusable region.
    expect(screen.getAllByRole("region").length).toBe(4);
  });

  it("create lists the proposed fields; delete says what will be lost", () => {
    const create = proposal({
      action: "create",
      items: [{ changes: [{ path: "title", label: "Title", kind: "added", format: "text", after: "About" }] }],
    });
    const { container, unmount } = render(<ApprovalCard approval={approval({ proposal: create })} />);
    expect(screen.getByRole("heading", { name: "Create a Page" })).toBeTruthy();
    expect(container.textContent).toContain("About");
    expect(container.querySelector(".assistant-diff__side--before")).toBeNull();
    unmount();

    const del = proposal({
      action: "delete",
      draft: undefined,
      items: [{ document: { id: "7", title: "Old" }, changes: [{ path: "title", label: "Title", kind: "removed", format: "text", before: "Old" }] }],
    });
    render(<ApprovalCard approval={approval({ proposal: del })} />);
    expect(screen.getByText("This document and its values will be deleted:")).toBeTruthy();
    expect(screen.getByText("Will be lost")).toBeTruthy();
  });

  it("says when a value was shortened, and shows the whole input when the proposal couldn't load", () => {
    const shortened = proposal({
      items: [{ changes: [{ path: "body", label: "Body", kind: "added", format: "text", after: "x…", truncated: true }], omittedChanges: 3 }],
    });
    const { unmount } = render(<ApprovalCard approval={approval({ proposal: shortened })} />);
    expect(screen.getByText(/Shortened for display/)).toBeTruthy();
    expect(screen.getByText("And 3 more fields not shown.")).toBeTruthy();
    unmount();

    const long = "y".repeat(6000);
    const { container } = render(<ApprovalCard approval={approval({ proposal: null, input: { slug: "pages", data: { body: long } } })} />);
    expect(container.querySelector("pre")!.textContent).toContain(long);
    expect(container.textContent).not.toContain("…");
  });

  it("approves, and rejects with an optional reason", () => {
    const approve = vi.fn();
    const reject = vi.fn();
    render(<ApprovalCard approval={approval({ approve, reject })} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approve).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText(/Why not/), { target: { value: "  Keep the old title  " } });
    fireEvent.click(screen.getByRole("button", { name: "Reject change" }));
    expect(reject).toHaveBeenCalledWith("Keep the old title");
  });

  it("asks again before approving a document that changed since the proposal", () => {
    const approve = vi.fn();
    render(<ApprovalCard approval={approval({ approve, proposal: proposal({ changedSinceProposal: true }) })} />);
    expect(screen.getByText(/changed after the assistant proposed this/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("answered while others wait: says so, with Undo", () => {
    const undo = vi.fn();
    render(<ApprovalCard approval={approval({ status: "decided", decision: { approved: true }, waitingFor: 1, undo })} />);
    expect(screen.getByText("Approved: sent with the other answers once 1 more change has one.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalled();
  });

  it("shows the outcome: applied, rejected with the reason, failed with the error", () => {
    const { unmount } = render(<ApprovalCard approval={approval({ status: "applied", canAnswer: false, decision: { approved: true } })} />);
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText("Applied, saved as a draft.")).toBeTruthy();
    unmount();

    const rejected = render(
      <ApprovalCard approval={approval({ status: "rejected", canAnswer: false, decision: { approved: false, reason: "No" }, outcomeMessage: "No" })} />
    );
    expect(rejected.container.textContent).toContain("Rejected: nothing was written.");
    expect(rejected.container.textContent).toContain("“No”");
    rejected.unmount();

    render(
      <ApprovalCard
        approval={approval({
          status: "failed",
          canAnswer: false,
          decision: { approved: true },
          outcomeMessage: 'MCP access to "updateDocument" is not enabled for collection "pages"',
        })}
      />
    );
    expect(screen.getByText(/approved but could not be applied: MCP access/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------

const userMessage = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", content: text }] });
const toolCallMessage = (calls: Array<{ id: string; input: Record<string, unknown> }>) => ({
  id: "a1",
  role: "assistant",
  parts: calls.map((c) => ({ type: "tool-call", id: c.id, name: "updateDocument", arguments: JSON.stringify(c.input), input: c.input, state: "approval-requested" })),
});
const interrupt = (id: string, toolCallId: string, input: Record<string, unknown>) => ({
  id,
  kind: "generic",
  status: "pending",
  canResolve: true,
  // As @tanstack/ai-client snapshots a generic interrupt: no toolCallId, it's in the binding.
  metadata: { kind: "approval", toolName: "updateDocument", input, "tanstack:interruptBinding": { toolCallId } },
  resolveInterrupt: () => {},
});

const proposalsBody = (stale = false) => ({
  approvals: [
    proposal({ interruptId: "i1", toolCallId: "c1", ...(stale ? { changedSinceProposal: true } : {}) }),
    proposal({
      interruptId: "i2",
      toolCallId: "c2",
      items: [{ document: { id: "8", title: "About", updatedAt: "2026-11-02T00:00:00.000Z" }, changes: [{ path: "title", label: "Title", kind: "changed", format: "text", before: "About", after: "About us" }] }],
    }),
  ],
});

function renderPanel() {
  return render(
    <ChatPanel
      adminRoute="/admin"
      apiRoute="/api"
      ApprovalComponent={ApprovalCard}
      configured
      hrefFor={(ref) => `/admin/collections/${ref.slug}/${ref.id}`}
      model="m"
      models={[{ id: "m", label: "M" }]}
      onActivity={() => {}}
      onModelChange={() => {}}
      slugs={{ collections: new Set(["pages"]), globals: new Set() }}
      threadId="t"
    />
  );
}

describe("chat panel", () => {
  beforeEach(() => fakeChat.reset());

  it("a refused send puts the text back in the composer and removes its bubble", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 })));
    fakeChat.set({ messages: [userMessage("old", "Earlier"), { id: "a0", role: "assistant", parts: [{ type: "text", content: "Hi" }] }] });
    renderPanel();
    const box = screen.getByLabelText("Message the assistant") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Rename the home page" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await waitFor(() => expect(box.value).toBe("Rename the home page"));
    expect(fakeChat.state.messages.map((m) => m.id)).toEqual(["old", "a0"]);
    expect(screen.queryByText("Rename the home page", { selector: "p" })).toBeNull();
  });

  describe("several approvals", () => {
    const setUp = (fetchImpl?: (url: string) => Response | undefined) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return fetchImpl?.(url) ?? Response.json(proposalsBody());
      });
      vi.stubGlobal("fetch", fetchMock);
      fakeChat.set({
        messages: [
          userMessage("u1", "Rename both"),
          toolCallMessage([
            { id: "c1", input: { slug: "pages", id: "7", data: { title: "Welcome" } } },
            { id: "c2", input: { slug: "pages", id: "8", data: { title: "About us" } } },
          ]),
        ],
        interrupts: [interrupt("i1", "c1", { slug: "pages", id: "7" }), interrupt("i2", "c2", { slug: "pages", id: "8" })],
      });
      renderPanel();
      return fetchMock;
    };

    const card = (title: string) => screen.getByRole("link", { name: title }).closest("article") as HTMLElement;

    it("answered one by one: nothing is sent until the last answer, then once, together", async () => {
      setUp();
      await screen.findByRole("link", { name: "Home" });
      expect(screen.getByText(/2 changes are waiting for you \(0 answered\)/)).toBeTruthy();

      fireEvent.click(within(card("Home")).getByRole("button", { name: "Approve" }));
      expect(fakeChat.resolved).toHaveLength(0);
      expect(within(card("Home")).getByText(/sent with the other answers once 1 more change has one/)).toBeTruthy();

      // Undo, then answer again.
      fireEvent.click(within(card("Home")).getByRole("button", { name: "Undo" }));
      fireEvent.click(within(card("Home")).getByRole("button", { name: "Approve" }));

      fireEvent.click(within(card("About")).getByRole("button", { name: "Reject" }));
      fireEvent.change(within(card("About")).getByLabelText(/Why not/), { target: { value: "Keep it short" } });
      fireEvent.click(within(card("About")).getByRole("button", { name: "Reject change" }));

      expect(fakeChat.resolved).toEqual([
        [
          { id: "i1", payload: { approved: true, seenUpdatedAt: "2026-11-01T00:00:00.000Z" } },
          { id: "i2", payload: { approved: false, reason: "Keep it short" } },
        ],
      ]);
    });

    it("Approve all answers the rest at once; the cards then show each outcome in place", async () => {
      setUp();
      await screen.findByRole("link", { name: "About" });
      fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
      expect(fakeChat.resolved).toEqual([
        [
          { id: "i1", payload: { approved: true, seenUpdatedAt: "2026-11-01T00:00:00.000Z" } },
          { id: "i2", payload: { approved: true, seenUpdatedAt: "2026-11-02T00:00:00.000Z" } },
        ],
      ]);

      // Sent: the interrupts leave, the tool results arrive.
      act(() => fakeChat.set({ interrupts: [], isLoading: true }));
      expect(screen.getAllByText("Applying…")).toHaveLength(2);
      act(() =>
        fakeChat.set({
          resuming: false,
          isLoading: false,
          messages: [
            ...fakeChat.state.messages,
            {
              id: "a2",
              role: "assistant",
              parts: [
                { type: "tool-result", toolCallId: "c1", content: 'Document updated successfully in collection "pages"!' },
                { type: "tool-result", toolCallId: "c2", content: JSON.stringify({ error: 'MCP access to "updateDocument" is not enabled for collection "pages"' }), state: "output-error" },
              ],
            },
          ],
        })
      );
      expect(within(card("Home")).getByText("Applied, saved as a draft.")).toBeTruthy();
      expect(screen.getByText(/approved but could not be applied: MCP access/)).toBeTruthy();
    });

    it("a stale refusal: that answer is dropped, the change reloaded and asked again; the other answer is kept", async () => {
      let proposalLoads = 0;
      const fetchMock = setUp((url) => {
        if (url.includes("/approvals")) {
          proposalLoads += 1;
          return Response.json(proposalsBody(proposalLoads > 1));
        }
        return undefined;
      });
      await screen.findByRole("link", { name: "Home" });
      fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
      expect(fakeChat.resolved).toHaveLength(1);

      // The resume is refused with a 409 (recorded by the chat's fetch), and the interrupts come back.
      await act(async () => {
        fetchMock.mockImplementationOnce(async () =>
          Response.json({ code: "stale", error: "changed", interruptIds: ["i1"] }, { status: 409 })
        );
        await fakeChat.options!().fetchClient("/api/assistant/chat?threadId=t", { method: "POST" });
        fakeChat.set({ resuming: false });
      });

      await waitFor(() => expect(proposalLoads).toBe(2));
      expect(screen.getByText(/changed after you reviewed the change, so nothing was sent/)).toBeTruthy();
      await waitFor(() => expect(within(card("Home")).getByText(/changed after you reviewed the change\. The diff below/)).toBeTruthy());
      expect(within(card("Home")).getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(within(card("About")).getByText(/^Approved/)).toBeTruthy();

      // Confirm again: sent with the kept answer.
      fireEvent.click(within(card("Home")).getByRole("button", { name: "Approve" }));
      fireEvent.click(within(card("Home")).getByRole("button", { name: "Approve anyway" }));
      expect(fakeChat.resolved).toHaveLength(2);
      expect(fakeChat.resolved[1]!.map((r) => r.id)).toEqual(["i1", "i2"]);
    });
  });
});
