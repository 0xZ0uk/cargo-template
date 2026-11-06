import { beforeEach, describe, expect, it } from "vitest";
import { DO_HEADERS } from "../../src/conversations/types";
import { backend, bindings, newId, readEvents, turn } from "./helpers";

// Storage is shared between the tests of a file, so every test gets its own users.
let alice = "";
let mallory = "";

describe("ownership (Durable Object)", () => {
  beforeEach(() => {
    alice = newId("users");
    mallory = newId("users");
  });

  it("the first claim wins; another user can neither claim, read, resume, rename nor delete", async () => {
    const conversations = backend();
    const threadId = newId("thread");
    expect(await conversations.claim(alice, threadId)).toEqual({ ok: true, created: true });
    expect(await conversations.claim(alice, threadId)).toEqual({ ok: true, created: false });

    const start = turn(alice, threadId, { steps: 2, delayMs: 1, message: "secret draft" });
    const events = await readEvents(await conversations.startTurn(start));
    expect(events.at(-1)?.data.type).toBe("RUN_FINISHED");

    // Read.
    expect((await conversations.transcript(alice, threadId))?.messages[0]).toMatchObject({ content: "secret draft" });
    expect(await conversations.claim(mallory, threadId)).toEqual({ ok: false });
    expect(await conversations.transcript(mallory, threadId)).toBeNull();
    // Resume (rejoin the log) and a new turn on someone else's id.
    const join = new Request(`https://admin.example/api/assistant/chat?runId=${start.runId}`, {
      headers: { "Last-Event-ID": "-1" },
    });
    expect((await conversations.join(mallory, threadId, join)).status).toBe(404);
    expect((await conversations.startTurn(turn(mallory, threadId, { steps: 1 }))).status).toBe(404);
    // List, rename, delete.
    expect((await conversations.list(mallory)).entries).toEqual([]);
    expect(await conversations.rename(mallory, threadId, "mine now")).toBe(false);
    expect(await conversations.remove(mallory, threadId)).toBe(false);

    // Alice still has everything, and can rejoin her own run.
    expect((await readEvents(await conversations.join(alice, threadId, join))).at(-1)?.data.type).toBe("RUN_FINISHED");
    expect((await conversations.list(alice)).entries.map((entry) => entry.threadId)).toEqual([threadId]);
  });

  it("the object re-checks the owner on its own fetch routes, whatever the Worker sends", async () => {
    const threadId = newId("thread");
    await backend().claim(alice, threadId);
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    for (const user of ["", mallory]) {
      const response = await stub.fetch("https://assistant.internal/join?offset=-1&runId=x", {
        headers: { [DO_HEADERS.user]: user },
      });
      expect(response.status).toBe(404);
    }
  });

  it("an unclaimed id reads as missing, and the stores stay user-agnostic", async () => {
    const conversations = backend();
    const threadId = newId("thread");
    expect(await conversations.transcript(alice, threadId)).toBeNull();
    expect(await bindings.ASSISTANT_CONVERSATIONS.getByName(threadId).isOwner(alice)).toBe(false);
  });

  it("rename and delete by the owner update the index and drop the data", async () => {
    const conversations = backend();
    const threadId = newId("thread");
    await conversations.claim(alice, threadId);
    expect(await conversations.rename(alice, threadId, "Meta descriptions")).toBe(true);
    expect((await conversations.list(alice, { search: "meta" })).entries[0]).toMatchObject({ threadId, title: "Meta descriptions" });
    expect(await conversations.remove(alice, threadId)).toBe(true);
    expect(await conversations.transcript(alice, threadId)).toBeNull();
    expect((await conversations.list(alice)).entries).toEqual([]);
    // The id is free again: whoever claims it next starts an empty conversation.
    expect(await conversations.claim(mallory, threadId)).toEqual({ ok: true, created: true });
    expect((await conversations.transcript(mallory, threadId))?.messages).toEqual([]);
  });
});
