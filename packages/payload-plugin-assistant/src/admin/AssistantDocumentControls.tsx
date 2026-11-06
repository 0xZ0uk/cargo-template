import type { PayloadRequest, ServerProps } from "payload";
import { AskAssistant } from "@cargo/payload-plugin-assistant/client";
import type { AssistantAccess } from "../types/options";
import { canSeeAssistant } from "../utils/viewAccess";

interface AssistantDocumentControlsProps extends Partial<ServerProps> {
  /** From the plugin, server-side: the same `access` the view and the endpoints ask. */
  access?: AssistantAccess;
  /** From the plugin (`clientProps`): which collection or global this edit view is. */
  kind?: "collection" | "global";
  slug?: string;
}

/**
 * "Ask the assistant" in an edit view (`admin.components.edit.beforeDocumentControls` of every
 * collection and global the assistant reaches, #69). A server component, like the nav link: it asks
 * the plugin's `access` and renders nothing for users it refuses. The client part hides itself on a
 * create view (no saved document to talk about).
 *
 * `access` gets a request built from the server props (no headers, cookies or URL), as for the nav
 * link; if it throws, the button is hidden. The endpoints always ask with the real request.
 */
export const AssistantDocumentControls = async ({ access, payload, user, i18n, locale, kind, slug }: AssistantDocumentControlsProps) => {
  if (!payload || !user || !kind || !slug) return null;
  const req = { payload, user, i18n, locale: locale?.code, headers: new Headers() } as unknown as PayloadRequest;
  if (!(await canSeeAssistant(req, access))) return null;
  return <AskAssistant kind={kind} slug={slug} />;
};

export default AssistantDocumentControls;
