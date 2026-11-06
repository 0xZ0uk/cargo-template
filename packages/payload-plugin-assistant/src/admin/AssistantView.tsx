import type { AdminViewServerProps } from "payload";
import { DefaultTemplate } from "@payloadcms/ui/rsc";
import { AssistantChat } from "@cargo/payload-plugin-assistant/client";
import type { AssistantAccess } from "../types/options";
import { assistantViewRedirectTarget } from "../utils/viewAccess";

interface AssistantViewProps extends AdminViewServerProps {
  /** From the plugin: `false` when no API key is set. */
  configured?: boolean;
  /** From the plugin, server-side: the same `access` the chat endpoint enforces. */
  access?: AssistantAccess;
}

/**
 * `/admin/assistant`. Server component, because `DefaultTemplate` is: Payload 4 renders custom
 * root views without the admin template, so the view wraps itself. It gates on `access` and
 * renders the chat, a client component from the package's `./client` entry (imported by package
 * path, so the bundler keeps the client boundary and none of this file reaches the browser).
 * Styling rules: see `packages/payload-seo-analyzer/src/ui/README.md`.
 */
export const AssistantView = async ({
  initPageResult,
  params,
  searchParams,
  server,
  user,
  configured = true,
  access,
}: AssistantViewProps) => {
  const { req, visibleEntities, permissions, locale } = initPageResult;

  // Not just `!req.user`: a session on another auth collection also fills it, and a declared
  // custom view skips Payload's own canAccessAdmin redirect, so the admin shell (with the whole
  // client config) would reach it. Same `access` as the chat endpoint.
  const denied = await assistantViewRedirectTarget(initPageResult, access);
  if (denied) server.redirect(denied);

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={user ?? req.user!}
      visibleEntities={{
        // Copied, not passed through: React 19 throws on the read-only original.
        collections: visibleEntities?.collections,
        globals: visibleEntities?.globals,
      }}
    >
      <AssistantChat configured={configured} />
    </DefaultTemplate>
  );
};

export default AssistantView;
