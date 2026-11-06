// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", async () => (await import("./payloadUiStub")).payloadUiStub);

/** The drawer's chat, as a stand-in that keeps the props the edit view passes it. */
const panel = vi.hoisted(() => ({ props: undefined as undefined | Record<string, any> }));
vi.mock("../../src/ui/ChatPanel", () => ({
  ChatPanel: (props: Record<string, any>) => {
    panel.props = props;
    return <section aria-label="Chat" />;
  },
}));

import type { DocumentReference } from "../../src/references";
import { AskAssistant } from "../../src/ui/AskAssistant";
import { Composer } from "../../src/ui/Composer";
import { collectToolResults, MessageView, type MessageLike } from "../../src/ui/MessageView";
import { uiState } from "./payloadUiStub";

const home: DocumentReference = { kind: "collection", slug: "pages", id: "12", title: "Home" };
const about: DocumentReference = { kind: "collection", slug: "pages", id: "13", title: "About us" };
const header: DocumentReference = { kind: "global", slug: "header", title: "Header" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  uiState.documentInfo = { id: undefined, setData: vi.fn() };
  uiState.title = "Home";
  uiState.depth = 0;
  uiState.modified = false;
  uiState.reset = vi.fn(async () => {});
  uiState.calls = { openModal: [], closeModal: [], toasts: [] };
  panel.props = undefined;
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/assistant/config")) {
      return Response.json({
        configured: true,
        models: [{ id: "m", label: "M" }],
        defaultModel: "m",
        maxSteps: 10,
        redactedTitles: { users: "User" },
      });
    }
    if (url.startsWith("/api/pages/12")) return Response.json({ id: 12, title: "Home (by the assistant)" });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("@ mentions in the composer", () => {
  /** The composer with its state, as ChatPanel holds it. */
  function Harness({ search, onSend = () => {} }: { search: (q: string, signal: AbortSignal) => Promise<DocumentReference[]>; onSend?: () => void }) {
    const [value, setValue] = useState("");
    const [refs, setRefs] = useState<DocumentReference[]>([]);
    return (
      <Composer
        model="m"
        models={[{ id: "m", label: "M" }]}
        onChange={setValue}
        onModelChange={() => {}}
        onReferencesChange={setRefs}
        onSend={onSend}
        onStop={() => {}}
        references={refs}
        searchDocuments={search}
        streaming={false}
        value={value}
      />
    );
  }

  const type = (input: HTMLTextAreaElement, text: string) => {
    input.focus();
    fireEvent.change(input, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
  };

  it("searches after @, moves with the arrow keys, picks with Enter: a chip, and the title in the text", async () => {
    const search = vi.fn(async (q: string) => (q === "Ho" || q === "" ? [home, about, header] : []));
    const onSend = vi.fn();
    render(<Harness onSend={onSend} search={search} />);
    const input = screen.getByLabelText("Message the assistant") as HTMLTextAreaElement;

    type(input, "Compare @Ho");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const list = await screen.findByRole("listbox", { name: "Documents" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(3));
    expect(search).toHaveBeenLastCalledWith("Ho", expect.any(AbortSignal));
    expect(within(list).getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(list).getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(within(list).getAllByRole("option")[1]!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" }); // wraps to the last
    expect(within(list).getAllByRole("option")[2]!.textContent).toContain("Header");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // back to the first
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("Compare Home ");
    expect(screen.queryByRole("listbox")).toBeNull();
    const chips = screen.getByRole("list", { name: "Mentioned documents" });
    expect(chips.textContent).toContain("pages");
    expect(chips.textContent).toContain("Home");

    // A document already mentioned isn't offered again.
    type(input, "Compare Home and @Ho");
    const again = await screen.findByRole("listbox", { name: "Documents" });
    await waitFor(() => expect(within(again).getAllByRole("option")).toHaveLength(2));
    expect(again.textContent).not.toContain("Home");

    // Escape closes the list without sending; Enter then sends.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("removes a chip with its button, and says when nothing matches", async () => {
    const search = vi.fn(async (q: string) => (q === "Ab" ? [about] : []));
    render(<Harness search={search} />);
    const input = screen.getByLabelText("Message the assistant") as HTMLTextAreaElement;

    type(input, "@Ab");
    const list = await screen.findByRole("listbox", { name: "Documents" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    fireEvent.mouseDown(within(list).getByRole("option"));
    expect(screen.getByRole("list", { name: "Mentioned documents" }).textContent).toContain("About us");
    fireEvent.click(screen.getByRole("button", { name: "Remove About us" }));
    expect(screen.queryByRole("list", { name: "Mentioned documents" })).toBeNull();

    type(input, "@zz");
    expect(await screen.findByText("No documents match “zz”.")).toBeTruthy();
  });

  it("an e-mail address is not a mention, and without a search @ is plain text", async () => {
    const search = vi.fn(async () => [home]);
    const { unmount } = render(<Harness search={search} />);
    type(screen.getByLabelText("Message the assistant") as HTMLTextAreaElement, "write to a@b.co");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    unmount();

    render(
      <Composer model="m" models={[]} onChange={() => {}} onModelChange={() => {}} onSend={() => {}} onStop={() => {}} streaming={false} value="@Ho" />
    );
    expect(screen.getByLabelText("Message the assistant").getAttribute("role")).toBeNull();
  });
});

describe("references on stored messages", () => {
  it("shows the context and the mentions as chips linking to their edit views", () => {
    const message: MessageLike = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", content: "Compare Home with About us" }],
      metadata: { assistant: { context: home, references: [about, header] } },
    };
    render(
      <MessageView
        adminRoute="/admin"
        hrefFor={(ref) => (ref.kind === "global" ? `/admin/globals/${ref.slug}` : `/admin/collections/${ref.slug}/${ref.id}`)}
        message={message}
        results={collectToolResults([message])}
        slugs={{ collections: new Set(["pages"]), globals: new Set(["header"]) }}
      />
    );
    const about_ = screen.getByRole("list", { name: "About" });
    expect(within(about_).getByRole("link").getAttribute("href")).toBe("/admin/collections/pages/12");
    const mentioned = screen.getByRole("list", { name: "Mentioned" });
    expect(within(mentioned).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/admin/collections/pages/13",
      "/admin/globals/header",
    ]);
    // The text is the user's own words: no note.
    expect(screen.getByText("Compare Home with About us")).toBeTruthy();
  });
});

describe("Ask the assistant (edit view)", () => {
  const updateCall = (id: number | string) => ({ id: `call-${id}`, name: "updateDocument", input: { slug: "pages", id, data: { title: "x" } } });
  const okResult = (callId: string) => ({ toolCallId: callId, content: "Document updated" });

  const openDrawer = async () => {
    fireEvent.click(screen.getByTestId("assistant-ask"));
    await waitFor(() => expect(panel.props).toBeDefined());
  };

  it("is hidden on a create view (no saved document) and shown once there is an id", () => {
    const { rerender } = render(<AskAssistant kind="collection" slug="pages" />);
    expect(screen.queryByTestId("assistant-ask")).toBeNull();
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    rerender(<AskAssistant kind="collection" slug="pages" />);
    expect(screen.getByTestId("assistant-ask").textContent).toBe("Ask the assistant");
  });

  it("a global needs no id", () => {
    render(<AskAssistant kind="global" slug="header" />);
    expect(screen.getByTestId("assistant-ask")).toBeTruthy();
  });

  it("opens the drawer on a new conversation about this saved document", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    render(<AskAssistant kind="collection" slug="pages" />);
    await openDrawer();
    expect(uiState.calls.openModal).toEqual(["assistant-collection-pages-12-0"]);
    expect(panel.props!.context).toEqual({ kind: "collection", slug: "pages", id: "12", title: "Home" });
    expect(panel.props!.threadId).toMatch(/^thread_/);
    expect(panel.props!.isNew).toBe(true);
    expect(screen.getByRole("dialog", { name: "Assistant" }).textContent).toContain("reads the saved version");
  });

  it("an unmodified form reloads when the assistant changed this document", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    render(<AskAssistant kind="collection" slug="pages" />);
    await openDrawer();

    await act(async () => panel.props!.onAppliedWrite(updateCall(12), okResult("call-12")));
    await waitFor(() => expect(uiState.reset).toHaveBeenCalledWith({ id: 12, title: "Home (by the assistant)" }));
    const url = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/pages/12"))!;
    expect(url).toContain("draft=true");
    expect(url).toContain("depth=0");
    expect(url).toContain("locale=en");
    expect(uiState.documentInfo.setData).toHaveBeenCalledWith({ id: 12, title: "Home (by the assistant)" });
    expect(uiState.calls.openModal).not.toContain("assistant-reload-collection-pages-12-0");
    expect(uiState.calls.toasts).toContain("success: Reloaded with the assistant’s change.");
  });

  it("ignores writes to other documents", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    render(<AskAssistant kind="collection" slug="pages" />);
    await openDrawer();
    await act(async () => panel.props!.onAppliedWrite(updateCall(13), okResult("call-13")));
    expect(uiState.reset).not.toHaveBeenCalled();
    expect(uiState.calls.openModal).toEqual(["assistant-collection-pages-12-0"]);
  });

  it("a modified form asks first; keeping the edits shows the overwrite warning until the form is saved", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    uiState.modified = true;
    const { rerender } = render(<AskAssistant kind="collection" slug="pages" />);
    await openDrawer();

    await act(async () => panel.props!.onAppliedWrite(updateCall(12), okResult("call-12")));
    expect(uiState.reset).not.toHaveBeenCalled();
    expect(uiState.calls.openModal).toContain("assistant-reload-collection-pages-12-0");
    const dialog = screen.getByRole("heading", { name: "The assistant changed this document" }).parentElement!;
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(uiState.reset).not.toHaveBeenCalled();
    // Once in the edit view, once in the drawer.
    expect(screen.getAllByText(/Saving will overwrite its change/)).toHaveLength(2);

    // Saved: the edits no longer stand against the assistant's change.
    uiState.modified = false;
    rerender(<AskAssistant kind="collection" slug="pages" />);
    expect(screen.queryByText(/Saving will overwrite its change/)).toBeNull();
  });

  it("nested document drawers of the same collection each have their own confirmation modal and drawer", async () => {
    // A page whose link field opens another page in a drawer (depth 1), itself in a drawer (depth 2).
    const slugsAt = async (depth: number, id: number) => {
      cleanup();
      uiState.depth = depth;
      uiState.documentInfo = { ...uiState.documentInfo, id };
      uiState.modified = true;
      uiState.calls.openModal = [];
      render(<AskAssistant kind="collection" slug="pages" />);
      await openDrawer();
      await act(async () => panel.props!.onAppliedWrite({ id: "c", name: "updateDocument", input: { slug: "pages", id, data: { title: "x" } } }, okResult("c")));
      const [drawer, confirm] = uiState.calls.openModal;
      expect(screen.getByRole("dialog", { name: "Assistant" }).getAttribute("data-drawer")).toBe(drawer);
      expect(document.querySelector("[data-slug]")!.getAttribute("data-slug")).toBe(confirm);
      return { drawer, confirm };
    };
    const outer = await slugsAt(0, 12);
    const inner = await slugsAt(1, 13);
    const sameDocDeeper = await slugsAt(1, 12);
    const all = [outer, inner, sameDocDeeper];
    expect(new Set(all.map((s) => s.confirm)).size).toBe(3);
    expect(new Set(all.map((s) => s.drawer)).size).toBe(3);
    expect(inner.confirm).toBe("assistant-reload-collection-pages-13-1");
  });

  it("a collection whose title is redacted is named by its label and id, never by the document's title", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 3 };
    uiState.title = "editor@example.com";
    render(<AskAssistant kind="collection" slug="users" />);
    await openDrawer();
    expect(panel.props!.context).toEqual({ kind: "collection", slug: "users", id: "3", title: "User #3" });
    expect(screen.getByRole("dialog", { name: "Assistant" }).textContent).toContain("User #3");
    expect(screen.getByRole("dialog", { name: "Assistant" }).textContent).not.toContain("editor@example.com");
  });

  it("a modified form reloads when the editor chooses to lose the edits", async () => {
    uiState.documentInfo = { ...uiState.documentInfo, id: 12 };
    uiState.modified = true;
    render(<AskAssistant kind="collection" slug="pages" />);
    await openDrawer();
    await act(async () => panel.props!.onAppliedWrite(updateCall(12), okResult("call-12")));
    const dialog = screen.getByRole("heading", { name: "The assistant changed this document" }).parentElement!;
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Reload and lose my edits" })));
    await waitFor(() => expect(uiState.reset).toHaveBeenCalledWith({ id: 12, title: "Home (by the assistant)" }));
  });
});
