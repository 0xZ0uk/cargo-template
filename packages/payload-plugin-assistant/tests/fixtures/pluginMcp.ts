import { readFileSync } from "node:fs";

/**
 * plugin-mcp's tool calls and results as recorded by `tests/integration/toolFixtures.test.ts`
 * (`plugin-mcp.json`): what `describeCall` / `parseResult` and the modules built on them are
 * tested against.
 */
export interface ToolFixtures {
  recordedWith: string;
  /** Every tool the assistant offers, with the approval its annotations give. */
  tools: Record<string, { needsApproval: boolean }>;
  calls: Array<{ label: string; name: string; args: Record<string, unknown>; result: unknown }>;
}

export const PLUGIN_MCP_FIXTURES = new URL("./plugin-mcp.json", import.meta.url);

export const fixtures = JSON.parse(readFileSync(PLUGIN_MCP_FIXTURES, "utf8")) as ToolFixtures;

/** A recorded call by its label. */
export function recorded(label: string): ToolFixtures["calls"][number] {
  const call = fixtures.calls.find((c) => c.label === label);
  if (!call) throw new Error(`no recorded call "${label}"`);
  return call;
}
