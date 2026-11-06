import { describe, expect, it } from "vitest";
import { backend, newId, readEvents, turn } from "./helpers";
import { ADMIN_ORIGIN, GOOD_COOKIE } from "./worker";

/**
 * Prototype for the transport question: inside the conversation object there is no Worker
 * `req` and no `handleEndpoints`. The object reaches `/api/mcp` through `ASSISTANT_SELF`, a
 * service binding to its own Worker, with the admin's Cookie and Origin. The stand-in MCP
 * server (real `@modelcontextprotocol/server`, like plugin-mcp) only lists tools to a request
 * carrying both, like plugin-mcp + Payload with `csrf` set.
 */
async function mcpResult(auth: { cookie: string; origin: string }) {
  const conversations = backend();
  const user = newId("users");
  const threadId = newId("thread");
  const events = await readEvents(await conversations.startTurn(turn(user, threadId, { mode: "mcp" }, auth)));
  return events.find((event) => event.data.type === "CUSTOM" && event.data.name === "mcp-result")?.data.value;
}

describe("MCP transport from inside the Durable Object (service binding to the same Worker)", () => {
  it("lists and calls tools as the admin: Cookie and Origin arrive intact", async () => {
    const result = await mcpResult({ cookie: GOOD_COOKIE, origin: ADMIN_ORIGIN });
    expect(result.tools).toEqual(["whoami"]);
    expect(JSON.parse(result.call.content[0].text)).toEqual({ cookie: GOOD_COOKIE, origin: ADMIN_ORIGIN });
  });

  it("without the admin's cookie there are no tools (plugin-mcp's unauthenticated answer)", async () => {
    const result = await mcpResult({ cookie: "", origin: ADMIN_ORIGIN });
    expect(result.error).toMatch(/Method not found|-32601/);
  });

  it("with a foreign Origin there are no tools (Payload's CSRF check)", async () => {
    const result = await mcpResult({ cookie: GOOD_COOKIE, origin: "https://evil.example" });
    expect(result.error).toMatch(/Method not found|-32601/);
  });
});
