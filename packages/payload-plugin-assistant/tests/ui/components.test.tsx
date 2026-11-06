// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", async () => (await import("./payloadUiStub")).payloadUiStub);

import { ApprovalControl, type PendingApproval } from "../../src/ui/ApprovalControl";
import { AssistantNavLinkClient } from "../../src/ui/AssistantNavLinkClient";
import { Composer, type ComposerProps } from "../../src/ui/Composer";
import { ConversationList } from "../../src/ui/ConversationList";
import { chatBodyState, EmptyConversation, EXAMPLE_PROMPTS } from "../../src/ui/EmptyConversation";
import { collectToolResults, MessageView, type MessageLike } from "../../src/ui/MessageView";

afterEach(cleanup);

const slugs = { collections: new Set(["pages"]), globals: new Set<string>() };
const hrefFor = (ref: { slug: string; id?: string }) => `/admin/collections/${ref.slug}/${ref.id}`;

const renderMessage = (message: MessageLike, all: MessageLike[] = [message]) =>
  render(
    <MessageView
      adminRoute="/admin"
      hrefFor={hrefFor}
      message={message}
      results={collectToolResults(all)}
      slugs={slugs}
    />
  );

const assistantText = (content: string): MessageLike => ({
  id: "m",
  role: "assistant",
  parts: [{ type: "text", content }],
});

describe("Markdown in assistant messages", () => {
  it("renders Markdown", () => {
    const { container } = renderMessage(assistantText("**Two** pages:\n\n- Home\n- Pricing\n\n`code`"));
    expect(container.querySelector("strong")?.textContent).toBe("Two");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("never renders raw HTML from the model", () => {
    const { container } = renderMessage(
      assistantText(
        'Hi <script>window.__pwned = 1</script> <img src=x onerror="window.__pwned = 2"> <b onclick="x()">bold</b>'
      )
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror], [onclick]")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    // Shown as text instead.
    expect(container.textContent).toContain("<script>");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("drops executable link targets", () => {
    const { container } = renderMessage(
      assistantText(
        "[click](javascript:alert(1)) [data](data:text/html,<script>alert(1)</script>) [vb](vbscript:msgbox)"
      )
    );
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href") ?? "").not.toMatch(/^(javascript|data|vbscript):/i);
    }
  });

  it("keeps admin links in the admin and opens other links in a new tab without an opener", () => {
    renderMessage(assistantText("[the page](/admin/collections/pages/1) and [docs](https://payloadcms.com/docs)"));
    const internal = screen.getByRole("link", { name: "the page" });
    expect(internal.getAttribute("href")).toBe("/admin/collections/pages/1");
    expect(internal.hasAttribute("data-payload-link")).toBe(true);
    expect(internal.getAttribute("target")).toBeNull();
    const external = screen.getByRole("link", { name: "docs" });
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not turn a bare document id or URL-looking text into a link", () => {
    const { container } = renderMessage(assistantText("Updated pages 12 (slug pricing)."));
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows the user's own message as plain text", () => {
    const { container } = renderMessage({
      id: "u",
      role: "user",
      parts: [{ type: "text", content: "**not bold** <i>x</i>" }],
    });
    expect(container.querySelector("strong, i")).toBeNull();
    expect(container.textContent).toBe("**not bold** <i>x</i>");
  });

  it("collapses reasoning", () => {
    renderMessage({ id: "m", role: "assistant", parts: [{ type: "thinking", content: "Let me think about pages." }] });
    const toggle = screen.getByRole("button", { name: "Reasoning" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Let me think about pages.")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Let me think about pages.")).toBeTruthy();
  });
});

describe("tool rows", () => {
  const call = {
    type: "tool-call",
    id: "call_1",
    name: "createDocuments",
    arguments: '{"slug":"pages"}',
    input: { slug: "pages" },
    state: "complete",
  };
  const result = {
    type: "tool-result",
    toolCallId: "call_1",
    state: "complete",
    content:
      'Created 1 of 1 documents in collection "pages".\n```json\n{"docs":[{"doc":{"id":2,"title":"Pricing"},"index":0}],"errors":[]}\n```',
  };

  it("shows tool, collection, status and a link to the document; the result stays collapsed", () => {
    renderMessage({ id: "m", role: "assistant", parts: [call, result] });
    const row = document.querySelector(".assistant-tool") as HTMLElement;
    expect(within(row).getByText("createDocuments")).toBeTruthy();
    expect(within(row).getByText("pages")).toBeTruthy();
    expect(within(row).getByText("Done")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/admin/collections/pages/2");
    const toggle = within(row).getByRole("button", { name: "Result" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(row.querySelector("pre")?.textContent).toContain("Created 1 of 1 documents");
  });

  it("finds a result that arrived in a later message, and shows rejected and running calls", () => {
    const later: MessageLike = {
      id: "r",
      role: "assistant",
      parts: [{ ...result, state: "error", outcome: "denied", content: '{"error":"User declined tool execution"}' }],
    };
    const first: MessageLike = { id: "m", role: "assistant", parts: [call] };
    renderMessage(first, [first, later]);
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    renderMessage({
      id: "s",
      role: "assistant",
      parts: [{ ...call, state: "input-streaming", input: undefined, arguments: '{"slug":"pa' }],
    });
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("doesn't render tool results on their own", () => {
    const { container } = renderMessage({ id: "r", role: "assistant", parts: [result] });
    expect(container.textContent).toBe("");
  });
});

describe("composer", () => {
  const setup = (props: Partial<ComposerProps> = {}) => {
    const handlers = { onSend: vi.fn(), onStop: vi.fn(), onChange: vi.fn(), onModelChange: vi.fn() };
    render(
      <Composer
        model="a"
        models={[
          { id: "a", label: "Model A" },
          { id: "b", label: "Model B" },
        ]}
        streaming={false}
        value="Hello"
        {...handlers}
        {...props}
      />
    );
    return { ...handlers, textarea: screen.getByLabelText("Message the assistant") };
  };

  it("sends on Enter and keeps Shift+Enter for a new line", () => {
    const { onSend, textarea } = setup();
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true); // not prevented: newline
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter while an IME is composing", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("doesn't send an empty message", () => {
    const { onSend, textarea } = setup({ value: "   " });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Stop while streaming, and Enter doesn't send then", () => {
    const { onSend, onStop, textarea } = setup({ streaming: true });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Model") as HTMLSelectElement).disabled).toBe(true);
  });

  it("explains why it is disabled", () => {
    const { onSend, textarea } = setup({
      disabled: true,
      disabledReason: "Approve or reject the pending change first.",
    });
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText("Approve or reject the pending change first.")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("picks a model from the allowlist", () => {
    const { onModelChange } = setup();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "b" } });
    expect(onModelChange).toHaveBeenCalledWith("b");
  });
});

describe("approval control", () => {
  const approval = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
    id: "a",
    toolName: "updateDocument",
    toolCallId: "c",
    input: { slug: "pages", id: 4, data: { title: "New" } },
    target: "pages",
    canAnswer: true,
    approve: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  });

  it("says what would change and answers both ways", () => {
    const value = approval();
    render(<ApprovalControl approval={value} />);
    expect(screen.getByText(/wants to update a document in/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(value.approve).toHaveBeenCalledTimes(1);
    expect(value.reject).toHaveBeenCalledTimes(1);
  });

  it("disables the answers while one is being sent", () => {
    render(<ApprovalControl approval={approval({ canAnswer: false })} />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("conversation list", () => {
  const conversations = [
    { threadId: "t1", title: "Pricing page" },
    { threadId: "t2", title: "" },
  ];
  const setup = () => {
    const handlers = {
      onNew: vi.fn(),
      onSelect: vi.fn(),
      onRename: vi.fn(async () => {}),
      onDelete: vi.fn(async () => {}),
    };
    render(<ConversationList activeThreadId="t1" conversations={conversations} loading={false} {...handlers} />);
    return handlers;
  };

  it("marks the open conversation and switches", () => {
    const { onSelect, onNew } = setup();
    expect(screen.getByRole("button", { name: "Pricing page" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Untitled" }));
    expect(onSelect).toHaveBeenCalledWith("t2");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(onNew).toHaveBeenCalled();
  });

  it("renames inline: Enter saves the trimmed title, Escape cancels", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Rename “Pricing page”" }));
    const input = screen.getByLabelText("Conversation title");
    fireEvent.change(input, { target: { value: "  Pricing  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("t1", "Pricing");

    fireEvent.click(screen.getByRole("button", { name: "Rename “Pricing page”" }));
    fireEvent.change(screen.getByLabelText("Conversation title"), { target: { value: "Nope" } });
    fireEvent.keyDown(screen.getByLabelText("Conversation title"), { key: "Escape" });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("deletes only after the confirmation", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Pricing page”" }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/“Pricing page” and its history will be deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("t1");
  });
});

describe("nav link (client half)", () => {
  it("links to the view and marks it current there", () => {
    render(<AssistantNavLinkClient />);
    const link = screen.getByRole("link", { name: "Chat" });
    expect(link.getAttribute("href")).toBe("/admin/assistant");
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

describe("internal links in answers (#116)", () => {
  it("payload://<collection>/<id> navigates to the document in the admin", () => {
    const { container } = renderMessage(assistantText("See [About us](payload://pages/12)."));
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/admin/collections/pages/12");
    expect(link.hasAttribute("data-payload-link")).toBe(true);
  });
});

describe("an empty conversation (#116)", () => {
  it("shows what the assistant does and example prompts; picking one fills the composer", () => {
    const onPick = vi.fn();
    render(<EmptyConversation onPick={onPick} />);
    expect(screen.getByRole("heading", { name: "What can I help with?" })).toBeTruthy();
    const examples = within(screen.getByRole("list", { name: "Example questions" })).getAllByRole("button");
    expect(examples.map((b) => b.textContent)).toEqual([...EXAMPLE_PROMPTS]);
    fireEvent.click(examples[1]!);
    expect(onPick).toHaveBeenCalledWith(EXAMPLE_PROMPTS[1]);
    // Payload components, no placeholders.
    expect(document.querySelector(".shimmer-effect")).toBeNull();
  });

  it("no examples when sending isn't possible", () => {
    render(<EmptyConversation examples={false} onPick={() => {}} />);
    expect(screen.queryByRole("list", { name: "Example questions" })).toBeNull();
  });

  it("placeholders only while an existing conversation loads", () => {
    expect(chatBodyState({ isHydrating: true, isNew: true, messageCount: 0 })).toBe("empty");
    expect(chatBodyState({ isHydrating: false, isNew: false, messageCount: 0 })).toBe("empty");
    expect(chatBodyState({ isHydrating: true, isNew: false, messageCount: 0 })).toBe("loading");
    expect(chatBodyState({ isHydrating: true, isNew: false, messageCount: 2 })).toBe("messages");
  });
});
