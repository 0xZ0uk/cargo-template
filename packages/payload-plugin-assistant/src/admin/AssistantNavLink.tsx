import type { PayloadRequest, ServerProps } from "payload";
import { AssistantNavLinkClient } from "@cargo/payload-plugin-assistant/client";
import type { AssistantAccess } from "../types/options";
import { canSeeAssistant } from "../utils/viewAccess";

interface AssistantNavLinkProps extends Partial<ServerProps> {
  /** From the plugin, server-side: the same `access` the view and the endpoints ask. */
  access?: AssistantAccess;
}

/**
 * The sidebar link to `/admin/assistant` (`admin.components.afterNavLinks`). A server component,
 * so it can ask the plugin's `access` (a server function the client bundle never sees) and render
 * nothing for users it refuses: the link shows exactly when the view would render.
 *
 * Payload renders nav components with `payload`, `user`, `i18n` and `locale` but no request, so
 * `access` gets a request built from those (no headers, cookies or URL). The default `access`
 * only reads `req.payload.config`. A custom one that needs headers must cope with their absence;
 * if it throws, the link is hidden (the view still asks with the real request).
 */
export const AssistantNavLink = async ({ access, payload, user, i18n, locale }: AssistantNavLinkProps) => {
  if (!payload || !user) return null;
  const req = { payload, user, i18n, locale: locale?.code, headers: new Headers() } as unknown as PayloadRequest;
  if (!(await canSeeAssistant(req, access))) return null;
  return <AssistantNavLinkClient />;
};

export default AssistantNavLink;
