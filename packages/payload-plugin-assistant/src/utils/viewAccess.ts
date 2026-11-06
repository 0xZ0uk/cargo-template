import type { AssistantAccess } from "../types/options";
import { defaultAccess } from "./normalizeOptions";

/** Join the admin root with a sub-route without ever producing `//…` (a protocol-relative URL). */
function adminPath(root: string, sub: string): string {
  const base = root.replace(/\/+$/, "");
  const path = sub.startsWith("/") ? sub : `/${sub}`;
  const joined = `${base}${path}`;
  return joined.startsWith("//") ? path : joined;
}

/**
 * Access gate for the admin view, the same question the chat endpoint asks. Pure (no
 * `next/navigation`), so the view keeps its own redirect call and this can be unit tested.
 * Mirrors `seoViewRedirectTarget` in `@cargo/payload-seo-analyzer`.
 *
 * @returns the path to redirect to, or `null` when the caller may render the view.
 */
export async function assistantViewRedirectTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initPageResult: any,
  access: AssistantAccess = defaultAccess
): Promise<string | null> {
  const req = initPageResult?.req;
  const config = req?.payload?.config;
  const root = typeof config?.routes?.admin === "string" ? config.routes.admin : "/admin";
  const routes = config?.admin?.routes ?? {};
  const login = typeof routes.login === "string" ? routes.login : "/login";
  const unauthorized = typeof routes.unauthorized === "string" ? routes.unauthorized : "/unauthorized";

  if (!req?.user) return adminPath(root, login);
  if (!(await access({ user: req.user, req }))) return adminPath(root, unauthorized);
  return null;
}

/**
 * Whether `req.user` may see the assistant (the nav link). Fails closed: no user, a refusal or an
 * `access` that throws all hide it.
 */
export async function canSeeAssistant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  access: AssistantAccess = defaultAccess
): Promise<boolean> {
  if (!req?.user) return false;
  try {
    return Boolean(await access({ user: req.user, req }));
  } catch {
    return false;
  }
}
