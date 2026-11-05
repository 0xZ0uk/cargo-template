import type { CollectionSlug, Payload, PayloadRequest } from "payload";

/**
 * Whether the document's main row is published in every locale. A draft save writes only a
 * version and leaves this row as it was; an unpublish (in one locale or all) flips its
 * `_status`, which Payload 4 keeps per locale when localization is on.
 */
export async function isFullyPublished(
  payload: Payload,
  collection: string,
  id: string | number,
  req: PayloadRequest
): Promise<boolean> {
  const row = (await payload.db.findOne({
    collection: collection as CollectionSlug,
    where: { id: { equals: id } },
    locale: "all",
    req,
  })) as { _status?: unknown } | null;
  if (!row) return false;

  const status = row._status;
  const statuses =
    status && typeof status === "object" ? Object.values(status as Record<string, unknown>) : [status];
  return statuses.length > 0 && statuses.every((s) => s === "published");
}
