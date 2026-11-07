import type { PayloadRequest } from "payload";

/**
 * True for a user of the admin panel's auth collection. `req.user` alone isn't enough: a
 * user of any other auth collection (members, customers…) is "signed in" too. The same gate
 * as the SEO analyzer's, without its role layer (Shipment's `users` have no roles).
 */
export function isAdminPanelUser(req: PayloadRequest): boolean {
  const user = req.user as { collection?: unknown } | null | undefined;
  if (!user) return false;
  const adminCollection = req.payload.config.admin?.user;
  return !adminCollection || user.collection === adminCollection;
}
