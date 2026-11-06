import type { AdminViewServerProps } from "payload";
import { Banner } from "@payloadcms/ui";
import { DefaultTemplate } from "@payloadcms/ui/rsc";

interface AssistantViewProps extends AdminViewServerProps {
  /** From the plugin: `false` when no API key is set. */
  configured?: boolean;
}

/**
 * Placeholder for `/admin/assistant`. Server component, because `DefaultTemplate` is: Payload 4
 * renders custom root views without the admin template, so the view wraps itself. The chat UI
 * (a client component) arrives with #64. Styling rules: see
 * `packages/payload-seo-analyzer/src/ui/README.md`.
 */
export const AssistantView = ({
  initPageResult,
  params,
  searchParams,
  server,
  user,
  configured = true,
}: AssistantViewProps) => {
  const { req, visibleEntities, permissions, locale } = initPageResult;

  // A session on another auth collection also fills `req.user`, and a declared custom view skips
  // Payload's own canAccessAdmin redirect; the chat endpoint enforces `access` either way.
  if (!req.user) {
    const adminRoute = req.payload.config.routes.admin.replace(/\/+$/, "");
    server.redirect(`${adminRoute}${req.payload.config.admin.routes.login}`);
  }

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
      <div className="gutter--left gutter--right">
        <h1>Assistant</h1>
        {configured ? (
          <Banner type="default">The assistant is not wired up yet.</Banner>
        ) : (
          <Banner type="warning">
            The assistant is not configured: no OpenRouter API key is set.
          </Banner>
        )}
      </div>
    </DefaultTemplate>
  );
};

export default AssistantView;
