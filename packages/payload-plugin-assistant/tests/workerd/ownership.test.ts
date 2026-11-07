import { beforeEach, describe, expect, it } from "vitest";
import { DO_HEADERS } from "../../src/conversations/types";
import { backend, bindings, newId } from "./helpers";

// Storage is shared between the tests of a file, so every test gets its own users.
let alice = "";
let mallory = "";

// Ownership through the backend is in the lifecycle suite (tests/workerd/lifecycle.test.ts);
// these reach the object directly.
describe("ownership (Durable Object)", () => {
  beforeEach(() => {
    alice = newId("users");
    mallory = newId("users");
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


});
