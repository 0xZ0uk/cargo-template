import type { PayloadRequest } from "payload";
import type { NormalizedAssistantOptions } from "./normalizeOptions";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Whether the request was made to this machine (`localhost`, `*.localhost`, 127.0.0.1, ::1). */
export function isLoopbackRequest(req: Pick<PayloadRequest, "url">): boolean {
  if (!req.url) return false;
  let hostname: string;
  try {
    hostname = new URL(req.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/**
 * Whether this request's turn uses the scripted test model: the app turned `testModel` on **and**
 * the request was made to a loopback host. A deployed Worker is never reached as `localhost`,
 * so a `testModel` left on by mistake can't replace the real model there.
 */
export function usesTestModel(options: Pick<NormalizedAssistantOptions, "testModel">, req: Pick<PayloadRequest, "url">): boolean {
  return options.testModel && isLoopbackRequest(req);
}

/** Whether a turn can run for this request: an API key, or the test model on a loopback request. */
export function configuredFor(
  options: Pick<NormalizedAssistantOptions, "apiKey" | "testModel">,
  req: Pick<PayloadRequest, "url">
): boolean {
  return options.apiKey !== "" || usesTestModel(options, req);
}
